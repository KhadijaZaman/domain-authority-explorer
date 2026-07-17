# Packaging — Chrome Extension & Google Sheets

Both integrations call the app's public JSON API (`/api/domain/{domain}`), so
they work against the **published** app URL. Publish the app first, then use
that URL below.

## Chrome extension (`chrome-extension/`)

1. In Chrome: `chrome://extensions` → enable **Developer mode** → **Load
   unpacked** → select the `chrome-extension/` folder. (Or use the prebuilt
   `chrome-extension.zip`. For Chrome Web Store distribution, add proper icons
   to the manifest first.)
2. Click the extension icon → **Settings** → paste your published app URL.
3. Visiting any site and clicking the icon shows its Authority and Popularity
   scores, with a link to the full report.

## Google Sheets (`google-sheets/Code.gs`)

1. In a Google Sheet: **Extensions → Apps Script**.
2. Paste the contents of `Code.gs`, set `APP_URL` at the top to your published
   app URL, save.
3. Use in cells:
   - `=DOMAIN_AUTHORITY("example.com")` — Authority Score
   - `=DOMAIN_POPULARITY(A2:A50)` — works on ranges
   - `=DOMAIN_AUTHORITY_FULL("example.com")` — authority, popularity, ranks, release
