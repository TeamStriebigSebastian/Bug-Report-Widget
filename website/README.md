# Bug Report Widget — Website Version

A self-contained JavaScript widget you can embed in any website. No browser extension needed.

## Integration

### Via Script Tag

Add a single `<script>` tag to your website:

```html
<script src="bug-report.js"></script>
```

By default, this will automatically initialize the widget in German (`de`). 
To override the configuration, you can initialize it manually:

```html
<script src="bug-report.js"></script>
<script>
  BugReportWidget.init({
    language: 'en', // 'de' or 'en'
    icon: '💬', // Customize the floating button icon
    tooltipMessage: 'Click the <strong>{icon} Button</strong> to report an issue!', // Native onboarding tooltip (use {icon} variable)
    primaryColor: '#e11d48', // Main CI color (e.g. rose-600)
    primaryColorHover: '#be123c', // Hover state
    limits: {
      interactions: 50, // Max number of clicks/scrolls to capture
      network: 200      // Max number of network requests to capture
    },
    sanitization: {
      safeParams: ['q', 'page', 'limit'], // URL query params that are NOT redacted
      sensitiveParams: ['token', 'password', 'apikey'] // URL query params to aggressively strip
      // You can also override the full regex pattern list: `patterns: [{ name: 'email', p: /.../g, r: '[REDACTED]' }]`
    },
    translations: {
      en: {
        btnTitle: 'Report an Issue' // Override specific strings
      }
    }
  });
</script>
```

### Via NPM

You can also install the widget via NPM:

```bash
npm install bug-report-widget
```

And import it in your application:

```javascript
import BugReportWidget from 'bug-report-widget';

BugReportWidget.init({ language: 'en' });
```
## How It Works

1. The script runs in the background, capturing interactions, console logs, JS errors, and network requests
2. When a user clicks the 🐛 button, a modal shows a preview of what will be included
3. The user can download the report as JSON or cancel
4. All data is sanitized (emails, tokens, passwords, API keys are redacted)

## Differences from the Extension Version

| Feature | Extension | Website Widget |
|---------|-----------|----------------|
| Network capture | `webRequest` API (all requests) | `fetch()` + `XMLHttpRequest` only |
| Installation | Chrome Extensions page | Single `<script>` tag |
| Scope | All websites | Only the website that includes it |
| Script/image loads | ✅ Captured | ❌ Not captured |

## Testing the Demo

```bash
# From the website/ directory, start a local server:
python3 -m http.server 8080

# Then open http://localhost:8080
```

Click the demo buttons, fill in the form, scroll, then click the 🐛 button to generate a report.
