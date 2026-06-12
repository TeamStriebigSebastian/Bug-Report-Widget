# Bug Report Capture — Browser Extension

A Chrome extension for structured bug reporting. Captures user interactions, console logs, JavaScript errors, and network request metadata — then exports them as a sanitized, downloadable JSON file.

## Installation & Testing

### 1. Load the Extension

1. Open **Google Chrome**
2. Navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **"Load unpacked"**
5. Select the `Bug-download-button` folder
6. The 🐛 bug icon should appear in your browser toolbar

> **Tip:** If the icon isn't visible, click the puzzle-piece icon (Extensions) in the toolbar and pin "Bug Report Capture".

### 2. Basic Test: Generate a Report

1. Navigate to any website (e.g. `https://example.com`)
2. Click several elements on the page
3. Scroll up and down
4. Open the browser console (F12) and type: `console.log("test message")`
5. Click the 🐛 extension icon in the toolbar
6. A popup appears showing:
   - The current page URL
   - Count of captured interactions, console logs, JS errors, and network requests
7. Click **"Download Report"**
8. A `bug_report_<timestamp>.json` file downloads
9. Open the JSON and verify it contains the expected sections

### 3. Test: Cancel Export

1. Click the 🐛 extension icon
2. Review the preview summary
3. Click **"Cancel"**
4. Verify that **no file** is downloaded

### 4. Test: Interaction Capture

1. Navigate to a page with buttons, links, and forms
2. Perform these actions:
   - Click on buttons and links
   - Submit a form
   - Change a dropdown/checkbox
   - Press Enter, Escape, Tab
   - Scroll the page
   - Resize the browser window
3. Generate a report and check the `interactions` array:
   - Each entry should have `timestamp`, `eventType`, `url`, `selector`, `tagName`
   - Click events should include `viewportCoordinates`
   - Keyboard events should only show the key name (e.g. `"Enter"`), **not** typed characters
   - **No form field values** should appear anywhere

### 5. Test: Console Log Capture

1. Open the DevTools console (F12 → Console)
2. Run these commands:
   ```js
   console.log("Test log message")
   console.warn("Test warning")
   console.error("Test error")
   ```
3. Generate a report and check the `consoleLogs` array:
   - Should contain entries with `timestamp`, `level`, and `message`
   - Maximum 100 entries

### 6. Test: JS Error Capture

1. In the DevTools console, run:
   ```js
   // Trigger a runtime error
   undefinedFunction()
   
   // Trigger an unhandled promise rejection
   Promise.reject(new Error("test rejection"))
   ```
2. Generate a report and check the `jsErrors` array:
   - Should contain entries with `timestamp`, `message`, `errorType`
   - May include `stack`, `sourceFile`, `line`, `column`
   - Maximum 50 entries

### 7. Test: Network Request Capture

1. Navigate to a page that makes API calls (e.g. any modern web app)
2. Or trigger requests manually:
   ```js
   fetch('https://httpbin.org/get')
   fetch('https://httpbin.org/status/500')
   ```
3. Generate a report and check the `networkRequests` array:
   - Should contain `timestamp`, `method`, `url`, `statusCode`, `duration`
   - Maximum 200 entries
   - **No cookies, auth headers, request/response bodies** should appear

### 8. Test: Privacy & Sanitization

1. Navigate to a page that contains email addresses (or log one):
   ```js
   console.log("Contact: user@example.com")
   console.log("Token: Bearer eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0IjoxfQ.abc123")
   console.log("API key: apikey=sk-12345678abcdef")
   ```
2. Generate a report and verify:
   - Emails are replaced with `[REDACTED_EMAIL]`
   - Bearer tokens are replaced with `[REDACTED_TOKEN]`
   - API keys are replaced with `[REDACTED_API_KEY]`
   - The `sanitizationSummary` shows counts of redactions
3. Navigate to a URL with query parameters:
   ```
   https://example.com/search?q=test&page=1&token=secret123&userId=42
   ```
4. Generate a report and check URLs in the metadata and network entries:
   - `q` and `page` → kept as-is (safe allowlist)
   - `token` and `userId` → removed entirely (sensitive blocklist)
   - Unknown params → value replaced with `[PARAM_REMOVED]`

### 9. Test: Report Structure

Open a generated JSON file and verify it contains all top-level fields:

```json
{
  "schemaVersion": "1.0.0",
  "reportTimestamp": "...",
  "extensionVersion": "1.0.0",
  "pageMetadata": {
    "url": "...",
    "userAgent": "...",
    "viewportSize": { "width": ..., "height": ... },
    "screenResolution": { "width": ..., "height": ... },
    "scrollPosition": { "x": ..., "y": ... },
    "zoomLevel": ...,
    "browserName": "...",
    "browserVersion": "..."
  },
  "interactions": [ ... ],
  "consoleLogs": [ ... ],
  "jsErrors": [ ... ],
  "networkRequests": [ ... ],
  "sanitizationSummary": {
    "totalRedactions": ...,
    "redactionsByType": { ... }
  },
  "captureLimitations": [ ... ]
}
```

### 10. Test: Performance

1. Browse normally for a few minutes with the extension loaded
2. Verify there is **no noticeable slowdown** in page loading or interactions
3. Check that scroll and resize events are throttled (not flooding the buffer)

## File Structure

```
Bug-download-button/
├── manifest.json       # Extension manifest (Manifest V3)
├── background.js       # Service worker: network capture, report assembly
├── content.js          # Content script: interactions, console, errors
├── sanitizer.js        # Shared sanitization module
├── popup.html          # Popup UI
├── popup.css           # Popup styles
├── popup.js            # Popup controller
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Known Limitations

- Only captures data while the extension is active on the current page
- Pre-existing console logs, errors, and network requests (before extension load) are not captured
- Browser-internal pages (`chrome://`, `about:`) and restricted pages are not supported
- Cross-origin iframes with limited extension access may not be fully captured
- Network capture uses `webRequest` API (metadata only — no bodies, no headers)
