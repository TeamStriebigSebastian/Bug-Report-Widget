# Bug Report Capture — Chrome Extension

A Chrome extension for structured bug reporting. Captures user interactions, console logs, JavaScript errors, and network request metadata, then exports them as a sanitized, downloadable HTML report.

> **Looking for the website widget / NPM package?** See [`website/README.md`](website/README.md).

---

## Installation

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked** and select this folder
4. The 🐛 icon appears in the toolbar — pin it via the puzzle-piece menu if needed

---

## Usage

1. Navigate to any page
2. Interact normally (clicks, scrolls, forms, etc.)
3. Click the 🐛 toolbar icon
4. Review the capture summary
5. Click **Download Report** — a `bug_report_<timestamp>.json` file is saved

---

## Testing

### Interaction Capture

Perform clicks, form changes, keyboard events, and scrolls, then generate a report. In the `interactions` array:
- Each entry has `timestamp`, `eventType`, `url`, `selector`, `tagName`
- Click events include `viewportCoordinates`
- Keyboard events show only the key name (`"Enter"`) — **no typed characters**
- **No form field values** appear

### Console Log Capture

```js
console.log("Test log message")
console.warn("Test warning")
console.error("Test error")
```

Check the `consoleLogs` array for entries with `timestamp`, `level`, and `message`. Max 100 entries.

### JS Error Capture

```js
undefinedFunction()                          // runtime error
Promise.reject(new Error("test rejection"))  // unhandled rejection
```

Check `jsErrors` for entries with `timestamp`, `message`, `errorType`. Max 50 entries.

### Network Request Capture

```js
fetch('https://httpbin.org/get')
fetch('https://httpbin.org/status/500')
```

Check `networkRequests` for `timestamp`, `method`, `url`, `statusCode`, `duration`. Max 200 entries. No cookies, auth headers, or bodies are included.

### Privacy & Sanitization

```js
console.log("Contact: user@example.com")
console.log("Token: Bearer eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0IjoxfQ.abc123")
console.log("API key: apikey=sk-12345678abcdef")
```

Verify in the report:
- Emails → `[REDACTED_EMAIL]`
- Bearer tokens → `[REDACTED_TOKEN]`
- API keys → `[REDACTED_API_KEY]`

For URL params, navigate to `https://example.com/search?q=test&page=1&token=secret123` and confirm:
- `q`, `page` → kept (safe allowlist)
- `token` → removed (sensitive blocklist)

---

## Report Structure

```json
{
  "schemaVersion": "1.0.0",
  "reportTimestamp": "...",
  "extensionVersion": "1.0.0",
  "pageMetadata": {
    "url": "...",
    "userAgent": "...",
    "viewportSize": { "width": 0, "height": 0 },
    "screenResolution": { "width": 0, "height": 0 },
    "scrollPosition": { "x": 0, "y": 0 },
    "zoomLevel": 1,
    "browserName": "...",
    "browserVersion": "..."
  },
  "interactions": [],
  "consoleLogs": [],
  "jsErrors": [],
  "networkRequests": [],
  "sanitizationSummary": {
    "totalRedactions": 0,
    "redactionsByType": {}
  },
  "captureLimitations": []
}
```

---

## File Structure

```
Bug-download-button/
├── website/
│   ├── bug-report.js    # Website widget / NPM package
│   ├── README.md        # Widget documentation
│   ├── index.html       # Demo page
│   └── docs.html
├── manifest.json        # Extension manifest (Manifest V3)
├── background.js        # Service worker: network capture, report assembly
├── content.js           # Content script: interactions, console, errors
├── sanitizer.js         # Sanitization module
├── popup.html
├── popup.css
├── popup.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Known Limitations

- Data captured only while the extension is active on the current tab
- Pre-existing console logs, errors, and network requests (before extension load) are not captured
- Browser-internal pages (`chrome://`, `about:`) are not supported
- Cross-origin iframes may not be fully captured
- Network capture uses the `webRequest` API — metadata only, no request/response bodies
