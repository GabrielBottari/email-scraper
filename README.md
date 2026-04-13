# Email Scraper

A small command-line tool that visits websites and collects email addresses it finds on them. You can either point it at a single website, or give it a spreadsheet (CSV file) with a list of websites and it will work through them and write the emails back into the same spreadsheet.

## What you need before you start

This tool runs on your computer from the **Terminal** (Mac/Linux) or **Command Prompt / PowerShell** (Windows). You do not need to know how to code, but you do need to install two free programs first.

### 1. Install Node.js

Node.js is the program that runs this tool.

1. Go to **https://nodejs.org**
2. Download the version labeled **"LTS"** (Long Term Support) — the big green button.
3. Open the downloaded file and click through the installer, accepting the defaults.
4. Once it finishes, open a new Terminal window and type:
   ```
   node --version
   ```
   You should see something like `v20.11.0`. If you do, Node.js is installed.

### 2. Install Git (only needed if you want to download the code from GitHub)

If you are reading this on GitHub and want to download the project:

- **Mac:** Git is usually already installed. Open Terminal and type `git --version`. If it asks you to install developer tools, click **Install**.
- **Windows:** Download from **https://git-scm.com/download/win** and run the installer with the default options.

If you prefer not to install Git, you can just click the green **"Code"** button on the GitHub page and choose **"Download ZIP"** instead. Unzip the folder somewhere easy to find, like your Desktop.

## Setting up the project

1. **Get the code onto your computer.** Either:
   - Download the ZIP from GitHub and unzip it, **or**
   - Open a Terminal and run:
     ```
     git clone https://github.com/GabrielBottari/email-scraper.git
     ```

2. **Open a Terminal inside the project folder.**
   - **Mac:** Right-click the `email-scraper` folder in Finder and choose **"New Terminal at Folder"**. (If you don't see this option, enable it under *System Settings → Keyboard → Keyboard Shortcuts → Services → New Terminal at Folder*.)
   - **Windows:** Open the `email-scraper` folder in File Explorer, click the address bar, type `cmd`, and press Enter.

3. **Install the tool's dependencies.** In the terminal window you just opened, type:
   ```
   npm install
   ```
   This downloads everything the tool needs to run. It may take a minute or two. You will see a lot of text scroll by — that's normal. When it's done, you'll be back at a blank prompt.

   > **Note:** This also installs a headless web browser (Puppeteer) that the tool uses to load pages that require JavaScript. It's about 200 MB, so make sure you have a decent internet connection.

You only have to do this setup **once**. After that, the tool is ready to use any time.

## How to use it

There are two ways to use the tool.

### Option A: Scrape a single website

In the Terminal, inside the project folder, type:

```
node index.js https://example.com
```

Replace `https://example.com` with the website you want to scan. The tool will visit up to 25 pages on that site and print any emails it finds.

**Controlling how many pages to visit:** Add `--max` followed by a number:

```
node index.js https://example.com --max 50
```

### Option B: Scrape a list of websites from a spreadsheet

1. Create a CSV file (you can export one from Excel, Numbers, or Google Sheets — File → Save As → CSV).
2. The **first column** must contain the website URLs, one per row. You can have any other columns you like after it.
3. The first row is the **header row** (column titles).

Example `urls.csv`:

```
Website,Company Name
example.com,Example Inc
acme.de,Acme GmbH
```

4. Put the CSV file inside the project folder (or anywhere — you'll give the tool its full path).

5. Run the tool:

```
node index.js --csv urls.csv
```

Or with a custom page limit per site:

```
node index.js --csv urls.csv --max 50
```

The tool will visit every website in the list, collect emails, and **update the same CSV file** by adding `Email:`, `Email 2:`, `Email 3:` columns (as many as needed for the site with the most emails).

> **Important:** The CSV is overwritten when the tool finishes. Keep a backup if the original is important.

## What the tool does, in plain terms

- It opens each website and reads the page.
- It follows links on the same website (not links going to other websites) up to the page limit you set.
- It extracts any email addresses it finds in the text or in `mailto:` links.
- It ignores placeholder emails (like `info@example.com`) and emails from common third-party services (like hosting providers or legal pages) so the results stay relevant to the actual business.
- If a page seems to need JavaScript to load, it falls back to a real headless browser to get the content.
- It runs up to 10 sites at the same time to save you time.

## Troubleshooting

**"command not found: node"**
Node.js isn't installed or your terminal was opened before the install finished. Close the terminal, open a new one, and try again.

**"command not found: npm"**
Same fix — `npm` comes with Node.js, so reinstalling Node.js and opening a fresh terminal usually fixes it.

**`npm install` takes forever or fails halfway**
Check your internet connection and run it again. Puppeteer downloads a browser, which is the slowest step.

**Puppeteer errors about Chrome or Chromium**
Try running:
```
npx puppeteer browsers install chrome
```

**The tool says "skipped" a lot**
Many websites block automated visitors, redirect to login pages, or are simply offline. This is normal — the tool moves on to the next page.

**I don't see any emails for a site**
Not every site publishes emails. Some use contact forms only, or hide emails behind CAPTCHAs that this tool won't bypass.

## Files in this project

- `index.js` — the tool itself.
- `package.json` — lists the libraries the tool depends on.
- `package-lock.json` — records exact library versions so installs are reproducible.
- `README.md` — this file.
- `LICENSE` — the license this project is released under.

## License

See the [LICENSE](LICENSE) file.
