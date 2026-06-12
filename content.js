/**
 * content.js — Content Script for Bug Report Extension
 *
 * Captures:
 *  - User interactions (ring buffer, max 50 / 5 min)
 *  - Console logs (max 100)
 *  - JS errors (max 50)
 *  - Page metadata
 *
 * Communicates with background.js via chrome.runtime messaging.
 */

const EXTENSION_VERSION = '1.0.0';

// ═══════════════════════════════════════════════════════════════════
//  RING BUFFER — User Interactions
// ═══════════════════════════════════════════════════════════════════

const InteractionBuffer = (() => {
  const MAX_ENTRIES = 50;
  const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
  const buffer = [];

  function evictStale() {
    const cutoff = Date.now() - MAX_AGE_MS;
    while (buffer.length > 0 && buffer[0]._ts < cutoff) {
      buffer.shift();
    }
  }

  function add(entry) {
    evictStale();
    entry._ts = Date.now();
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) {
      buffer.shift();
    }
  }

  function getAll() {
    evictStale();
    return buffer.map(({ _ts, ...rest }) => rest);
  }

  return { add, getAll };
})();

// ═══════════════════════════════════════════════════════════════════
//  CONSOLE LOG BUFFER
// ═══════════════════════════════════════════════════════════════════

const ConsoleBuffer = (() => {
  const MAX_ENTRIES = 100;
  const buffer = [];

  function add(entry) {
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) {
      buffer.shift();
    }
  }

  function getAll() {
    return [...buffer];
  }

  return { add, getAll };
})();

// ═══════════════════════════════════════════════════════════════════
//  JS ERROR BUFFER
// ═══════════════════════════════════════════════════════════════════

const ErrorBuffer = (() => {
  const MAX_ENTRIES = 50;
  const buffer = [];

  function add(entry) {
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) {
      buffer.shift();
    }
  }

  function getAll() {
    return [...buffer];
  }

  return { add, getAll };
})();

// ═══════════════════════════════════════════════════════════════════
//  HELPER UTILITIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a sanitized CSS selector for an element.
 * Uses tag name, safe class names, and structural position.
 * Avoids raw IDs that could contain PII.
 */
function buildSelector(el) {
  if (!el || !el.tagName) return '';

  const parts = [];
  let current = el;
  let depth = 0;

  while (current && current !== document.body && depth < 4) {
    const tag = current.tagName.toLowerCase();
    let selector = tag;

    // Add safe class names (skip anything that looks dynamic/PII-ish)
    const safeClasses = Array.from(current.classList || [])
      .filter(cls =>
        cls.length < 40 &&
        !/[0-9a-f]{8,}/i.test(cls) &&       // skip hash-like classes
        !/@/.test(cls) &&                    // skip email-like
        !/^user|^customer|^email/i.test(cls) // skip PII-prefixed
      )
      .slice(0, 3);

    if (safeClasses.length > 0) {
      selector += '.' + safeClasses.join('.');
    }

    // Add nth-child for disambiguation
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children).filter(
        c => c.tagName === current.tagName
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${idx})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
    depth++;
  }

  return parts.join(' > ');
}

/**
 * Get a sanitized visible label from an element.
 * Truncated and only for explicitly allowed element types.
 */
function getVisibleLabel(el) {
  if (!el) return undefined;

  const ALLOWED_TAGS = new Set([
    'BUTTON', 'A', 'LABEL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'SUMMARY', 'LEGEND', 'CAPTION', 'TH',
  ]);

  if (!ALLOWED_TAGS.has(el.tagName)) return undefined;

  const text = (el.textContent || '').trim().substring(0, 50);
  return text || undefined;
}

/**
 * Throttle a function to execute at most once per `delay` ms.
 */
function throttle(fn, delay) {
  let lastCall = 0;
  let timeoutId = null;
  return function (...args) {
    const now = Date.now();
    const remaining = delay - (now - lastCall);
    if (remaining <= 0) {
      lastCall = now;
      fn.apply(this, args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
//  INTERACTION TRACKING
// ═══════════════════════════════════════════════════════════════════

function buildBaseEntry(type, el) {
  return {
    timestamp: new Date().toISOString(),
    eventType: type,
    url: window.location.href,
    selector: buildSelector(el),
    tagName: el ? el.tagName : undefined,
    ariaRole: el ? (el.getAttribute('role') || undefined) : undefined,
    visibleLabel: getVisibleLabel(el),
    scrollPosition: {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY),
    },
  };
}

// Click events
document.addEventListener('click', (e) => {
  const entry = buildBaseEntry('click', e.target);
  entry.viewportCoordinates = {
    x: Math.round(e.clientX),
    y: Math.round(e.clientY),
  };
  InteractionBuffer.add(entry);
}, true);

// Submit events
document.addEventListener('submit', (e) => {
  InteractionBuffer.add(buildBaseEntry('submit', e.target));
}, true);

// Change events (no field values stored)
document.addEventListener('change', (e) => {
  InteractionBuffer.add(buildBaseEntry('change', e.target));
}, true);

// High-level keyboard actions (no typed characters)
const ALLOWED_KEYS = new Set([
  'Enter', 'Escape', 'Tab', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

document.addEventListener('keydown', (e) => {
  if (!ALLOWED_KEYS.has(e.key)) return;

  const entry = buildBaseEntry('keyboard', e.target);
  entry.key = e.key;
  entry.modifiers = {
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
  };
  InteractionBuffer.add(entry);
}, true);

// Scroll position snapshots (throttled 500ms)
const handleScroll = throttle(() => {
  InteractionBuffer.add({
    timestamp: new Date().toISOString(),
    eventType: 'scroll',
    url: window.location.href,
    scrollPosition: {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY),
    },
  });
}, 500);
window.addEventListener('scroll', handleScroll, { passive: true });

// Viewport resize events (throttled 500ms)
const handleResize = throttle(() => {
  InteractionBuffer.add({
    timestamp: new Date().toISOString(),
    eventType: 'resize',
    url: window.location.href,
    viewportSize: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  });
}, 500);
window.addEventListener('resize', handleResize);

// Navigation / route changes
let lastUrl = window.location.href;
const navigationObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    const oldUrl = lastUrl;
    lastUrl = window.location.href;
    InteractionBuffer.add({
      timestamp: new Date().toISOString(),
      eventType: 'navigation',
      url: lastUrl,
      previousUrl: oldUrl,
    });
  }
});
navigationObserver.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('popstate', () => {
  if (window.location.href !== lastUrl) {
    const oldUrl = lastUrl;
    lastUrl = window.location.href;
    InteractionBuffer.add({
      timestamp: new Date().toISOString(),
      eventType: 'navigation',
      url: lastUrl,
      previousUrl: oldUrl,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  CONSOLE LOG & ERROR CAPTURE (via page-level injection)
// ═══════════════════════════════════════════════════════════════════

const CHANNEL_ID = '__bugreport_ext_' + Math.random().toString(36).slice(2);

const injectedCode = `
(function() {
  const CHANNEL = '${CHANNEL_ID}';

  // ── Console Interception ──────────────────────────────────
  const originalConsole = {};
  ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
    originalConsole[level] = console[level];
    console[level] = function(...args) {
      try {
        const message = args
          .map(a => {
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a); } catch { return String(a); }
          })
          .join(' ')
          .substring(0, 500);

        window.postMessage({
          channel: CHANNEL,
          type: 'CONSOLE_LOG',
          data: {
            timestamp: new Date().toISOString(),
            level: level,
            message: message,
          }
        }, '*');
      } catch {}
      originalConsole[level].apply(console, args);
    };
  });

  // ── Error Capture ─────────────────────────────────────────
  window.addEventListener('error', (e) => {
    try {
      window.postMessage({
        channel: CHANNEL,
        type: 'JS_ERROR',
        data: {
          timestamp: new Date().toISOString(),
          message: (e.message || '').substring(0, 500),
          errorType: e.error ? e.error.constructor.name : 'Error',
          stack: e.error && e.error.stack ? e.error.stack.substring(0, 1000) : undefined,
          sourceFile: e.filename || undefined,
          line: e.lineno || undefined,
          column: e.colno || undefined,
        }
      }, '*');
    } catch {}
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason = e.reason || {};
      window.postMessage({
        channel: CHANNEL,
        type: 'JS_ERROR',
        data: {
          timestamp: new Date().toISOString(),
          message: (typeof reason === 'string' ? reason : reason.message || 'Unhandled Promise Rejection').substring(0, 500),
          errorType: reason.constructor ? reason.constructor.name : 'UnhandledRejection',
          stack: reason.stack ? reason.stack.substring(0, 1000) : undefined,
        }
      }, '*');
    } catch {}
  });
})();
`;

// Inject the page-level script
const scriptEl = document.createElement('script');
scriptEl.textContent = injectedCode;
(document.head || document.documentElement).appendChild(scriptEl);
scriptEl.remove();

// Listen for relayed messages from the page-level script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.channel !== CHANNEL_ID) return;

  if (event.data.type === 'CONSOLE_LOG') {
    ConsoleBuffer.add(event.data.data);
  } else if (event.data.type === 'JS_ERROR') {
    ErrorBuffer.add(event.data.data);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  PAGE METADATA COLLECTION
// ═══════════════════════════════════════════════════════════════════

function parseBrowserInfo() {
  const ua = navigator.userAgent;
  let browserName = 'Unknown';
  let browserVersion = '';

  if (ua.includes('Firefox/')) {
    browserName = 'Firefox';
    browserVersion = ua.match(/Firefox\/([\d.]+)/)?.[1] || '';
  } else if (ua.includes('Edg/')) {
    browserName = 'Edge';
    browserVersion = ua.match(/Edg\/([\d.]+)/)?.[1] || '';
  } else if (ua.includes('Chrome/') && !ua.includes('Edg/')) {
    browserName = 'Chrome';
    browserVersion = ua.match(/Chrome\/([\d.]+)/)?.[1] || '';
  } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
    browserName = 'Safari';
    browserVersion = ua.match(/Version\/([\d.]+)/)?.[1] || '';
  }

  return { browserName, browserVersion };
}

function collectPageMetadata() {
  const { browserName, browserVersion } = parseBrowserInfo();

  return {
    url: window.location.href,
    userAgent: navigator.userAgent,
    viewportSize: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    screenResolution: {
      width: window.screen.width,
      height: window.screen.height,
    },
    scrollPosition: {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY),
    },
    zoomLevel: Math.round(window.devicePixelRatio * 100) / 100,
    browserName,
    browserVersion,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  MESSAGING — Respond to background.js requests
// ═══════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_BUG_REPORT_DATA') {
    sendResponse({
      pageMetadata: collectPageMetadata(),
      interactions: InteractionBuffer.getAll(),
      consoleLogs: ConsoleBuffer.getAll(),
      jsErrors: ErrorBuffer.getAll(),
    });
    return true; // Keep the message channel open
  }

  if (message.type === 'GET_PREVIEW_COUNTS') {
    sendResponse({
      url: window.location.href,
      interactionCount: InteractionBuffer.getAll().length,
      consoleLogCount: ConsoleBuffer.getAll().length,
      jsErrorCount: ErrorBuffer.getAll().length,
    });
    return true;
  }
});