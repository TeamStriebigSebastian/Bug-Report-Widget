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
      safeParams: [
        'q','query','search','keyword','term','id','pid','post_id','item_id','article_id','slug','path','route',
        'page','p','limit','offset','skip','take','cursor','start','end','per_page','size','index','first','last','next','prev','before','after',
        'sort','order','orderby','sortby','dir','direction','filter','max','min','category','tag','type','status','state','date','year','month','day',
        'view','mode','display','format','layout','theme','tab','panel','step','section','anchor','eventorigin',
        'action','method','module','component','feature','flag','variant','experiment','version','v',
        'lang','locale','language','hl','gl','country','region','currency',
        'ref','source','utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','msclkid','mc_cid','mc_eid'
      ], // These are the default safe params that won't be redacted
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
