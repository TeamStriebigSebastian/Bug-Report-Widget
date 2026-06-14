/**
 * content.js — Content Script for Bug Report Extension (v2.0.0)
 *
 * Captures:
 *  - User interactions (ring buffer, max 50 / 5 min)
 *  - Console logs (max 100)
 *  - JS errors (max 50)
 *  - Page metadata
 *  - Visual DOM capture via layout2vector Canvas Writer
 *
 * Communicates with background.js via chrome.runtime messaging.
 */

const EXTENSION_VERSION = '2.0.0';

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

  function getRaw() {
    evictStale();
    return [...buffer];
  }

  return { add, getAll, getRaw };
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

// Click events (must explicitly capture X/Y viewport coordinates)
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
//  LAYOUT2VECTOR — Canvas-Based DOM Visual Capture
// ═══════════════════════════════════════════════════════════════════

/**
 * Capture the visual state of the page by extracting DOM geometry
 * and rendering it onto an HTML5 Canvas. Then annotate with click
 * coordinates from the interaction buffer.
 *
 * Returns a Base64 PNG data URL string.
 */
function captureVisualState() {
  const vpWidth = window.innerWidth;
  const vpHeight = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  // Create offscreen canvas at device resolution for sharpness
  const canvas = document.createElement('canvas');
  canvas.width = vpWidth * dpr;
  canvas.height = vpHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Fill background (page bg)
  const bodyStyle = window.getComputedStyle(document.body);
  const htmlStyle = window.getComputedStyle(document.documentElement);
  const pageBg = bodyStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
    ? bodyStyle.backgroundColor
    : (htmlStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' ? htmlStyle.backgroundColor : '#ffffff');
  ctx.fillStyle = pageBg;
  ctx.fillRect(0, 0, vpWidth, vpHeight);

  // Walk visible DOM elements and paint them
  const elements = document.querySelectorAll('*');
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  for (const el of elements) {
    // Skip script, style, meta, head elements and hidden elements
    const tag = el.tagName;
    if (['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'TITLE', 'NOSCRIPT', 'BR'].includes(tag)) continue;

    try {
      const rect = el.getBoundingClientRect();

      // Skip elements fully outside viewport
      if (rect.bottom < 0 || rect.top > vpHeight || rect.right < 0 || rect.left > vpWidth) continue;
      // Skip invisible elements
      if (rect.width === 0 || rect.height === 0) continue;

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

      const x = rect.left;
      const y = rect.top;
      const w = rect.width;
      const h = rect.height;

      // Draw background if not transparent
      const bg = style.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        ctx.fillStyle = bg;

        // Handle border-radius
        const br = parseFloat(style.borderRadius) || 0;
        if (br > 0) {
          drawRoundRect(ctx, x, y, w, h, Math.min(br, w / 2, h / 2));
          ctx.fill();
        } else {
          ctx.fillRect(x, y, w, h);
        }
      }

      // Draw border if present
      const borderWidth = parseFloat(style.borderTopWidth) || 0;
      if (borderWidth > 0) {
        const borderColor = style.borderTopColor;
        if (borderColor && borderColor !== 'rgba(0, 0, 0, 0)') {
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = borderWidth;
          const br = parseFloat(style.borderRadius) || 0;
          if (br > 0) {
            drawRoundRect(ctx, x, y, w, h, Math.min(br, w / 2, h / 2));
            ctx.stroke();
          } else {
            ctx.strokeRect(x, y, w, h);
          }
        }
      }

      // Draw text for direct text-containing elements
      if (isDirectTextNode(el)) {
        const text = getDirectText(el).substring(0, 200);
        if (text) {
          const fontSize = parseFloat(style.fontSize) || 14;
          const fontWeight = style.fontWeight || 'normal';
          const fontFamily = style.fontFamily || 'sans-serif';
          ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
          ctx.fillStyle = style.color || '#000000';
          ctx.textBaseline = 'top';

          // Clip text to element bounds
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();

          const textX = x + (parseFloat(style.paddingLeft) || 0);
          const textY = y + (parseFloat(style.paddingTop) || 0);
          ctx.fillText(text, textX, textY + (h - fontSize) / 2);
          ctx.restore();
        }
      }

      // Draw images as colored placeholder rectangles
      if (tag === 'IMG' || tag === 'SVG' || tag === 'VIDEO' || tag === 'CANVAS') {
        ctx.fillStyle = 'rgba(99, 102, 241, 0.1)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        // Draw icon placeholder
        ctx.fillStyle = 'rgba(99, 102, 241, 0.5)';
        ctx.font = `${Math.min(w, h, 24) * 0.5}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tag === 'IMG' ? '🖼' : tag === 'SVG' ? '◇' : '▶', x + w / 2, y + h / 2);
        ctx.textAlign = 'start';
      }
    } catch (e) {
      // Skip elements that throw
    }
  }

  // ── Draw click-path annotations ──────────────────────────
  const rawInteractions = InteractionBuffer.getRaw();
  const clicks = rawInteractions.filter(e => e.eventType === 'click' && e.viewportCoordinates);
  let clickIndex = 1;

  for (const click of clicks) {
    const pageX = click.viewportCoordinates.x + (click.scrollPosition ? click.scrollPosition.x : 0);
    const pageY = click.viewportCoordinates.y + (click.scrollPosition ? click.scrollPosition.y : 0);
    const cx = pageX - window.scrollX;
    const cy = pageY - window.scrollY;

    // Draw outer red circle with glow
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
    ctx.fill();

    // Draw red circle
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();

    // Draw white border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw number
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(clickIndex), cx, cy);
    ctx.textAlign = 'start';

    clickIndex++;
  }

  // Export as Base64 PNG
  return canvas.toDataURL('image/png');
}

/**
 * Helper: draw a rounded rectangle path.
 */
function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Check if an element directly contains text (not via child elements).
 */
function isDirectTextNode(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Get direct text content from an element (excluding child elements).
 */
function getDirectText(el) {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    }
  }
  return text.trim();
}

function showAnnotationEditor(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve(null);
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483647';
    overlay.style.background = 'rgba(15, 17, 23, 0.95)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    const header = document.createElement('div');
    header.style.padding = '16px 24px';
    header.style.background = '#1a1d27';
    header.style.color = '#e8eaf0';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.borderBottom = '1px solid #2d3348';
    header.innerHTML = `
      <div style="font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 10px;">
        🖍 Screenshot markieren
        <span style="font-size: 13px; font-weight: 400; color: #9096a8;">(Markiere relevante Bereiche mit der Maus)</span>
      </div>
      <div style="display: flex; gap: 12px;">
        <button id="br-editor-skip" style="padding: 10px 16px; background: #222636; border: 1px solid #2d3348; color: #e8eaf0; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s;">Ohne Markierung fortfahren</button>
        <button id="br-editor-save" style="padding: 10px 20px; background: #6366f1; border: none; color: #ffffff; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 700; box-shadow: 0 4px 12px rgba(99,102,241,0.3); transition: all 0.2s;">Fertig & Report erstellen</button>
      </div>
    `;

    const canvasContainer = document.createElement('div');
    canvasContainer.style.flex = '1';
    canvasContainer.style.overflow = 'auto';
    canvasContainer.style.display = 'flex';
    canvasContainer.style.alignItems = 'flex-start';
    canvasContainer.style.justifyContent = 'center';
    canvasContainer.style.padding = '40px';

    const canvas = document.createElement('canvas');
    canvas.style.boxShadow = '0 10px 40px rgba(0,0,0,0.5)';
    canvas.style.cursor = 'crosshair';
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    canvas.style.background = '#ffffff';
    canvas.style.borderRadius = '4px';

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      let isDrawing = false;
      
      function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
        return {
          x: (clientX - rect.left) * scaleX,
          y: (clientY - rect.top) * scaleY
        };
      }

      const startDrawing = (e) => {
        if (e.type.startsWith('touch')) e.preventDefault();
        isDrawing = true;
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = Math.max(4, img.width / 250);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      };

      const draw = (e) => {
        if (e.type.startsWith('touch')) e.preventDefault();
        if (!isDrawing) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      };

      const stopDrawing = (e) => {
        if (e && e.type && e.type.startsWith('touch') && e.cancelable) e.preventDefault();
        isDrawing = false;
      };

      canvas.addEventListener('mousedown', startDrawing);
      canvas.addEventListener('touchstart', startDrawing, { passive: false });

      canvas.addEventListener('mousemove', draw);
      canvas.addEventListener('touchmove', draw, { passive: false });

      canvas.addEventListener('mouseup', stopDrawing);
      canvas.addEventListener('mouseleave', stopDrawing);
      canvas.addEventListener('touchend', stopDrawing, { passive: false });
      canvas.addEventListener('touchcancel', stopDrawing, { passive: false });
    };
    img.src = dataUrl;

    canvasContainer.appendChild(canvas);
    overlay.appendChild(header);
    overlay.appendChild(canvasContainer);
    document.body.appendChild(overlay);

    document.getElementById('br-editor-skip').addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(dataUrl);
    });

    document.getElementById('br-editor-save').addEventListener('click', () => {
      const newDataUrl = canvas.toDataURL('image/png');
      document.body.removeChild(overlay);
      resolve(newDataUrl);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
//  MESSAGING — Respond to background.js requests
// ═══════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_BUG_REPORT_DATA') {
    // 1. Capture visual state synchronously
    let rawScreenshot = null;
    try {
      rawScreenshot = captureVisualState();
    } catch (e) {
      console.error('Visual capture failed', e);
    }

    // 2. Async flow: show editor, wait for user, then respond
    showAnnotationEditor(rawScreenshot).then((annotatedScreenshot) => {
      sendResponse({
        pageMetadata: collectPageMetadata(),
        interactions: InteractionBuffer.getAll(),
        consoleLogs: ConsoleBuffer.getAll(),
        jsErrors: ErrorBuffer.getAll(),
        screenshotBase64: annotatedScreenshot,
      });
    });
    
    return true; // Keep the message channel open for async response
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

  if (message.type === 'PROMPT_IST_SOLL') {
    // Prompt user for Ist/Soll descriptions using native browser prompts
    const actual = window.prompt(
      'Was ist passiert?\n\nBeschreibe kurz das Problem, das du beobachtet hast.\n\nBeispiel: \"Beim Klick auf Speichern passiert nichts\" oder \"Die Seite zeigt eine Fehlermeldung\"',
      ''
    );

    // If user cancels the first prompt, abort the entire flow
    if (actual === null) {
      sendResponse({ cancelled: true });
      return true;
    }

    const expected = window.prompt(
      'Was hättest du erwartet?\n\nBeschreibe kurz, was stattdessen hätte passieren sollen.\n\nBeispiel: \"Die Daten sollten gespeichert werden\" oder \"Die Seite sollte normal laden\"',
      ''
    );

    // If user cancels the second prompt, abort the entire flow
    if (expected === null) {
      sendResponse({ cancelled: true });
      return true;
    }

    sendResponse({
      cancelled: false,
      actual: actual || 'Keine Angabe',
      expected: expected || 'Keine Angabe',
    });
    return true;
  }
});