# Bug Report Widget

A drop-in JavaScript widget for structured bug reporting. Users click a floating button, describe what happened, and download a self-contained HTML report with an annotated screenshot, interactions, console logs, JS errors, and network requests — all sanitized.

---

## Installation

```bash
npm install bug-report-widget
```

---

## Quick Start

**Via script tag:**

```html
<script src="node_modules/bug-report-widget/website/bug-report.js"></script>
```

The widget auto-initializes and auto-detects the browser language. A floating button appears bottom-right.

**Via import (bundler):**

```js
import BugReportWidget from 'bug-report-widget';

BugReportWidget.init({
  language: 'en',
  primaryColor: '#6366f1',
});
```

---

## Branding / Corporate Identity

### Colors

```js
BugReportWidget.init({
  primaryColor: '#E63946',       // buttons, hover borders, scrollbars, report accent
  primaryColorHover: '#C1121F',  // hover state (defaults to primaryColor if omitted)
});
```

### Icon

The `icon` value is rendered as `innerHTML` — use an emoji or an inline SVG:

```js
// Emoji
BugReportWidget.init({ icon: '🚨' });

// Inline SVG (e.g. your logo)
BugReportWidget.init({
  icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white">
    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
  </svg>`
});
```

### Onboarding Tooltip

An optional speech-bubble tooltip above the button, auto-hides after 8 seconds. Use `{icon}` as a placeholder for the configured icon. Supports HTML:

```js
BugReportWidget.init({
  tooltipMessage: '<strong>Found a bug?</strong><br>Click {icon} to report it.',
});
```

### Full Branding Example

```js
BugReportWidget.init({
  icon: '🚨',
  primaryColor: '#0052CC',
  primaryColorHover: '#0747A6',
  tooltipMessage: '<strong>Found a bug?</strong><br>Click {icon} to send a report.',
  language: 'en',
});
```

---

## Language & i18n

The widget auto-detects the browser language (`navigator.language`). Built-in translations: `en`, `de`.

**Force a language:**

```js
BugReportWidget.init({ language: 'en' });
```

**Add a new language:**

```js
BugReportWidget.init({
  language: 'fr',
  translations: {
    fr: {
      btnTitle: 'Signaler un bug',
      modalTitle: 'Rapport de bug',
      actualPrompt: 'Que s\'est-il passé ?',
      actualPlaceholder: 'État actuel…',
      expectedPrompt: 'Qu\'est-ce que vous attendiez ?',
      expectedPlaceholder: 'État attendu…',
      cancel: 'Annuler',
      download: 'Télécharger le rapport',
      // see Translation Keys table for all keys
    }
  }
});
```

**Override individual strings in an existing language:**

```js
BugReportWidget.init({
  translations: {
    en: { btnTitle: 'Report an Issue' }
  }
});
```

### Translation Keys

| Key | Default (en) | What it controls |
|-----|-------------|-----------------|
| `btnTitle` | `Create Bug Report` | Floating button tooltip |
| `modalTitle` | `Bug Report` | Report title |
| `actualPrompt` | `What happened?` | "Actual state" field heading |
| `actualDesc` | `Briefly describe the problem…` | "Actual state" field description |
| `actualPlaceholder` | `Actual state…` | "Actual state" textarea placeholder |
| `expectedPrompt` | `What did you expect?` | "Expected state" field heading |
| `expectedDesc` | `Describe the expected behavior…` | "Expected state" field description |
| `expectedPlaceholder` | `Expected state…` | "Expected state" textarea placeholder |
| `drawTitle` | `Mark Screenshot` | Screenshot annotation modal title |
| `drawDesc` | `You can draw on the screenshot…` | Screenshot annotation modal description |
| `drawInstruction` | `Draw on the screenshot…` | Instruction inside the annotation view |
| `cancel` | `Cancel` | Cancel button |
| `download` | `Download Report` | Download button |
| `actualLabel` | `Actual state` | Label in the downloaded report |
| `expectedLabel` | `Expected state` | Label in the downloaded report |
| `screenshotTitle` | `Annotated Screenshot…` | Screenshot section heading in report |
| `screenshotNA` | `Screenshot not available` | Shown when capture fails |
| `interactions` | `User Interactions` | Section heading in report |
| `consoleLogs` | `Console Logs` | Section heading in report |
| `jsErrors` | `JavaScript Errors` | Section heading in report |
| `networkRequests` | `Network Requests` | Section heading in report |
| `sanitizationSummary` | `Sanitization Summary` | Section heading in report |
| `redactions` | `redactions` | Counter label ("3 redactions") |
| `noRedactions` | `No redactions were necessary.` | Shown when nothing was redacted |
| `limitations` | `Capture Limitations` | Section heading in report |
| `reportTitle` | `Bug Report` | `<title>` and heading of the HTML report file |
| `createdAt` | `Created on` | Date prefix in report header |
| `metaUrl` | `URL` | Metadata card label |
| `metaBrowser` | `Browser` | Metadata card label |
| `metaViewport` | `Viewport` | Metadata card label |
| `metaScreenResolution` | `Screen Resolution` | Metadata card label |
| `metaScrollPosition` | `Scroll Position` | Metadata card label |
| `metaZoomLevel` | `Zoom Level` | Metadata card label |
| `metaUserAgent` | `User Agent` | Metadata card label |
| `noInfo` | `No information provided` | Fallback when user skips a field |
| `unknown` | `Unknown` | Fallback for undetected browser name |
| `generatedAt` | `Generated` | Footer prefix |
| `reportFooter` | `Bug Report Dashboard` | Footer label |

---

## Capture Limits

```js
BugReportWidget.init({
  limits: {
    interactions: 50,  // default: 50
    console: 100,      // default: 100
    errors: 50,        // default: 50
    network: 200,      // default: 200
  }
});
```

---

## Sanitization

Sensitive data is automatically redacted from URLs and console logs. You can extend or replace the built-in rules.

> Setting any of these fields **replaces** the built-in list for that field.

**Extend the URL parameter allowlist** (values kept as-is):

```js
BugReportWidget.init({
  sanitization: {
    safeParams: ['q', 'page', 'sort', 'my_custom_param'],
  }
});
```

**Extend the sensitive parameter blocklist** (removed entirely from URLs):

```js
BugReportWidget.init({
  sanitization: {
    sensitiveParams: ['token', 'api_key', 'my_internal_id'],
  }
});
```

**Add custom regex redaction patterns:**

```js
BugReportWidget.init({
  sanitization: {
    patterns: [
      { name: 'invoice_id', p: /INV-\d{6}/g, r: '[REDACTED_INVOICE]' },
    ]
  }
});
```

---

## Full `init()` Reference

```js
BugReportWidget.init({
  // Appearance
  icon: '🐛',                    // emoji or inline SVG string
  primaryColor: '#6366f1',       // hex color
  primaryColorHover: '#7577f5',  // hex color (defaults to primaryColor)
  tooltipMessage: null,          // HTML string, or null to disable

  // Language
  language: 'en',                // 'en' | 'de' | any key added via translations
  translations: {                // add languages or override individual strings
    en: { btnTitle: 'Report Issue' }
  },

  // Capture limits (ring buffer sizes)
  limits: {
    interactions: 50,
    console: 100,
    errors: 50,
    network: 200,
  },

  // Sanitization
  sanitization: {
    safeParams: [...],      // URL params whose values are kept
    sensitiveParams: [...], // URL params removed entirely
    patterns: [...],        // { name, p: RegExp, r: string }
  },
});
```

---

## Extension vs. Widget

| Feature | Chrome Extension | Website Widget |
|---------|-----------------|----------------|
| Network capture | All requests via `webRequest` API | `fetch()` + `XHR` only |
| Installation | Chrome Extensions page | Single `<script>` tag or NPM |
| Scope | Any website | Only the site that includes it |
| Script/image requests | ✅ Captured | ❌ Not captured |

---

## Local Demo

```bash
cd website
python3 -m http.server 8080
# open http://localhost:8080
```
