import fs from "node:fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAX_PAGES = 25;
const CONCURRENCY = 10;

const PRIMARY_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FALLBACK_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0";

// Placeholder / example domains
const PLACEHOLDER_DOMAINS = new Set([
  "example.com",
  "example.de",
  "ihredomain.de",
  "meinedomain.de",
  "eigenen-mail.de",
  "mysite.com",
  "ex.com",
  "deinserver.de",
]);

// Third-party service domains (hosting, platforms, legal, analytics, etc.)
const THIRD_PARTY_DOMAINS = new Set([
  // Hosting / web agencies
  "webgo.de",
  "vicotec.de",
  "grow-werbeagentur.de",
  "3pixelhoch.de",
  "hubit.de",
  "ins-blaue.com",
  "marketing-schreiber.de",
  // Privacy / legal / arbitration
  "datenschutz.bremen.de",
  "bih.bund.de",
  "lbb.bremen.de",
  "bifd.bund.de",
  "lda.bayern.de",
  "lfd.niedersachsen.de",
  "lfd.bwl.de",
  "ldi.nrw.de",
  "sdtb.sachsen.de",
  "schlichtungsstelle-bgg.de",
  "mlbf-barrierefrei.de",
  "secjur.com",
  "kijuda.de",
  "dso-datenschutz.de",
  // Delivery / reservation platforms
  "opentable.com",
  "lieferando.de",
  "wolt.com",
  "uber.com",
  "restablo.de",
  "get-sides.de",
  // Marketing / analytics / consent
  "social-wave.com",
  "socialwave.de",
  "brevo.com",
  "consentmanager.net",
  "innocraft.com",
  // Social media
  "support.facebook.com",
]);

function ensureProtocol(url) {
  url = url.trim();
  if (!url) return null;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  return url;
}

function normalizeUrl(href, base) {
  try {
    const url = new URL(href, base);
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.href;
  } catch {
    return null;
  }
}

async function fetchWithUa(url, ua) {
  return fetch(url, {
    headers: { "User-Agent": ua },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
}

async function fetchPage(url) {
  let res;
  try {
    res = await fetchWithUa(url, PRIMARY_UA);
  } catch (err) {
    // If HTTPS fails, retry with HTTP
    if (url.startsWith("https://")) {
      const httpUrl = url.replace("https://", "http://");
      res = await fetchWithUa(httpUrl, PRIMARY_UA);
    } else {
      throw err;
    }
  }

  // Some servers block the Chrome UA; retry once with a Firefox UA on 403.
  if (res.status === 403) {
    try {
      const retry = await fetchWithUa(url, FALLBACK_UA);
      if (retry.ok) res = retry;
    } catch {
      // keep original 403
    }
  }

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    throw new Error(`Not HTML (${contentType})`);
  }

  return res.text();
}

function extractLinks($, pageUrl, baseOrigin) {
  const links = new Set();

  // Follow <a href>, <frame src>, and <iframe src>
  $("a[href], frame[src], iframe[src]").each((_, el) => {
    const href = $(el).attr("href") || $(el).attr("src");
    if (!href || href.startsWith("mailto:") || href.startsWith("javascript:")) {
      return;
    }

    const resolved = normalizeUrl(href, pageUrl);
    if (!resolved) return;

    try {
      const parsed = new URL(resolved);
      if (parsed.origin === baseOrigin) {
        links.add(resolved);
      }
    } catch {
      // ignore malformed
    }
  });

  return links;
}

function isValidEmail(email) {
  const domain = email.split("@")[1];
  if (!domain) return false;

  // Filter placeholder domains
  if (PLACEHOLDER_DOMAINS.has(domain)) return false;

  // Filter third-party service domains
  if (THIRD_PARTY_DOMAINS.has(domain)) return false;

  // Filter if TLD is too long (likely has words appended, e.g. ".devertretungsberechtigter")
  const tld = domain.split(".").pop();
  if (tld.length > 6) return false;

  return true;
}

function decodeCfEmail(hex) {
  if (!hex || hex.length < 4 || hex.length % 2 !== 0) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let email = "";
  for (let i = 2; i < hex.length; i += 2) {
    email += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return email;
}

function extractEmails($) {
  $("script, style").remove();

  const emails = new Set();

  // Cloudflare email obfuscation: <a data-cfemail="..."> or any [data-cfemail]
  $("[data-cfemail]").each((_, el) => {
    const decoded = decodeCfEmail($(el).attr("data-cfemail"));
    if (decoded) emails.add(decoded.toLowerCase());
  });

  $('a[href^="mailto:"]').each((_, el) => {
    const mailto = $(el).attr("href");
    const email = mailto.replace("mailto:", "").split("?")[0].trim();
    emails.add(email.toLowerCase());
  });

  // Insert spaces at tag boundaries so adjacent elements don't merge
  $("*").each((_, el) => {
    $(el).prepend(" ").append(" ");
  });

  const text = $.text();
  const textMatches = text.match(EMAIL_REGEX) || [];
  for (const email of textMatches) {
    emails.add(email.toLowerCase());
  }

  // Filter out invalid / irrelevant emails
  const filtered = new Set();
  for (const email of emails) {
    if (isValidEmail(email)) {
      filtered.add(email);
    }
  }

  return filtered;
}

// ── Puppeteer (shared browser instance) ──

let _browser = null;

async function getBrowser() {
  if (!_browser) {
    _browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  }
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

async function fetchPageWithBrowser(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(PRIMARY_UA);

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    } catch (err) {
      // If HTTPS fails in the browser, retry with HTTP
      if (url.startsWith("https://")) {
        const httpUrl = url.replace("https://", "http://");
        await page.goto(httpUrl, { waitUntil: "networkidle2", timeout: 30000 });
      } else {
        throw err;
      }
    }

    // Wait a bit and follow any JS/meta-refresh redirects
    try {
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 8000 });
    } catch {
      // No redirect happened — that's fine
    }

    const finalUrl = page.url();
    return { html: await page.content(), finalUrl };
  } finally {
    await page.close();
  }
}

// ── Crawl ──

async function crawl(startUrl, maxPages, label) {
  const baseOrigin = new URL(startUrl).origin;
  const visited = new Set();
  const queue = [startUrl];
  const allEmails = new Set();

  while (queue.length > 0 && visited.size < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    if (label) {
      process.stdout.write(`  [${label}] [${visited.size}/${maxPages}] ${url}`);
    } else {
      process.stdout.write(`[${visited.size}/${maxPages}] ${url}`);
    }

    try {
      let html = await fetchPage(url);
      let $ = cheerio.load(html);

      let links = extractLinks($, url, baseOrigin);
      let emails = extractEmails($);

      // If cheerio found nothing, the page likely needs JS rendering
      if (emails.size === 0 && links.size === 0) {
        process.stdout.write(" [JS]");
        const result = await fetchPageWithBrowser(url);
        html = result.html;
        $ = cheerio.load(html);

        // Use the final URL's origin for link extraction (handles redirects to different domains)
        const effectiveOrigin = new URL(result.finalUrl).origin;
        links = extractLinks($, result.finalUrl, effectiveOrigin);
        emails = extractEmails($);
      }

      for (const email of emails) {
        allEmails.add(email);
      }

      if (emails.size > 0) {
        process.stdout.write(` — ${emails.size} email(s)\n`);
      } else {
        process.stdout.write("\n");
      }

      for (const link of links) {
        if (!visited.has(link)) {
          queue.push(link);
        }
      }
    } catch (err) {
      process.stdout.write(` — skipped (${err.message})\n`);
    }
  }

  return [...allEmails];
}

// ── CSV helpers ──

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function escapeCsvField(value) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

async function runWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function processCsv(csvPath, maxPages) {
  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());

  if (lines.length < 2) {
    console.error("CSV file is empty or has no data rows.");
    process.exit(1);
  }

  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => parseCsvLine(line));

  // Find the URL column (first column)
  const urlColIdx = 0;

  console.log(`Loaded ${rows.length} URLs from ${csvPath}`);
  console.log(`Processing with concurrency=${CONCURRENCY}, max ${maxPages} pages per site\n`);

  // Build crawl tasks
  const tasks = rows.map((row, i) => {
    return async () => {
      const rawUrl = row[urlColIdx]?.trim();
      if (!rawUrl) return [];

      const url = ensureProtocol(rawUrl);
      if (!url) return [];

      const shortLabel = new URL(url).hostname;
      console.log(`\n── Starting ${shortLabel} (${i + 1}/${rows.length}) ──`);

      try {
        return await crawl(url, maxPages, shortLabel);
      } catch (err) {
        console.error(`  [${shortLabel}] Fatal error: ${err.message}`);
        return [];
      }
    };
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);

  // Determine max emails found for any single row
  const maxEmails = Math.max(1, ...results.map((emails) => emails.length));

  // Build email column headers
  const emailHeaders = [];
  for (let i = 0; i < maxEmails; i++) {
    emailHeaders.push(i === 0 ? "Email:" : `Email ${i + 1}:`);
  }

  // Build new header: original columns (minus old Email:) + email columns
  // Find existing email column index if any
  const existingEmailIdx = header.findIndex(
    (h) => h.trim().toLowerCase() === "email:"
  );

  let newHeader;
  if (existingEmailIdx !== -1) {
    // Replace the existing Email: column and insert additional email columns after it
    newHeader = [...header];
    newHeader.splice(existingEmailIdx, 1, ...emailHeaders);
  } else {
    // Append email columns at the end
    newHeader = [...header, ...emailHeaders];
  }

  // Build new rows
  const newRows = rows.map((row, i) => {
    const emails = results[i];
    const emailCells = [];
    for (let j = 0; j < maxEmails; j++) {
      emailCells.push(emails[j] || "");
    }

    let newRow;
    if (existingEmailIdx !== -1) {
      newRow = [...row];
      newRow.splice(existingEmailIdx, 1, ...emailCells);
    } else {
      newRow = [...row, ...emailCells];
    }

    return newRow;
  });

  // Write CSV
  const outputLines = [
    newHeader.map(escapeCsvField).join(","),
    ...newRows.map((row) => row.map(escapeCsvField).join(",")),
  ];

  fs.writeFileSync(csvPath, outputLines.join("\n") + "\n", "utf-8");

  // Summary
  const totalEmails = results.reduce((sum, emails) => sum + emails.length, 0);
  const sitesWithEmails = results.filter((emails) => emails.length > 0).length;

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Done. Found ${totalEmails} total email(s) across ${sitesWithEmails}/${rows.length} sites.`);
  console.log(`Updated ${csvPath}`);
}

// ── Single-URL mode ──

async function singleUrlMode(baseUrl, maxPages) {
  baseUrl = ensureProtocol(baseUrl);
  console.log(`Crawling ${baseUrl} (max ${maxPages} pages)\n`);

  const emails = await crawl(baseUrl, maxPages);

  console.log(`\n${"=".repeat(50)}`);
  if (emails.length === 0) {
    console.log("No emails found.");
  } else {
    console.log(`Found ${emails.length} unique email(s):\n`);
    for (const email of emails) {
      console.log(`  ${email}`);
    }
  }
}

// ── CLI ──

async function main() {
  const args = process.argv.slice(2);
  let maxPages = MAX_PAGES;
  let csvPath = null;
  let baseUrl = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max" && args[i + 1]) {
      maxPages = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--csv" && args[i + 1]) {
      csvPath = args[i + 1];
      i++;
    } else if (!baseUrl) {
      baseUrl = args[i];
    }
  }

  if (!csvPath && !baseUrl) {
    console.log("Usage:");
    console.log("  node index.js <url> [--max <pages>]         Crawl a single site");
    console.log("  node index.js --csv <file> [--max <pages>]  Process a CSV of URLs");
    console.log("");
    console.log("Examples:");
    console.log("  node index.js https://example.com --max 50");
    console.log("  node index.js --csv urls.csv --max 20");
    process.exit(1);
  }

  try {
    if (csvPath) {
      await processCsv(csvPath, maxPages);
    } else {
      await singleUrlMode(baseUrl, maxPages);
    }
  } finally {
    await closeBrowser();
  }
}

main();
