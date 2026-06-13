/**
 * Bug Report Widget — Website Edition (v2.0.0)
 * Drop-in script for any website. No extension needed.
 * Usage: <script src="bug-report.js"></script>
 *
 * v2.0.0 Changes:
 *  - Ist/Soll user prompts before report generation
 *  - Visual capture via layout2vector Canvas Writer with click-path annotations
 *  - HTML dashboard export instead of JSON
 */
(function () {
  'use strict';
  if (window.__BugReportLoaded) return;
  window.__BugReportLoaded = true;

  const VERSION = '2.0.0';
  const MAX_INTERACTIONS = 50;
  const MAX_AGE_MS = 5 * 60 * 1000;
  const MAX_CONSOLE = 100;
  const MAX_ERRORS = 50;
  const MAX_NETWORK = 200;

  // ═══════════════════════════════════════════════════════════════
  //  SANITIZER
  // ═══════════════════════════════════════════════════════════════

  const SAFE_PARAMS = new Set([
    'page','p','per_page','limit','offset','sort','order','orderby','sortby','dir','direction',
    'filter','q','query','search','tab','view','mode','display','lang','locale','language','hl',
    'feature','flag','variant','experiment','category','type','status','state',
    'ref','source','utm_source','utm_medium','utm_campaign','step','section','anchor','eventorigin',
  ]);
  const SENSITIVE_PARAMS = new Set([
    'token','access_token','refresh_token','id_token','auth_token',
    'session','sessionid','session_id','sid','apikey','api_key','key','client_secret','secret',
    'password','passwd','pwd','email','mail','e-mail',
    'userid','user_id','uid','customerid','customer_id','orderid','order_id',
    'ssn','credit_card','cc','cvv','auth','authorization','bearer',
    'code','otp','verification','reset_token','nonce','csrf','xsrf',
  ]);
  const PATTERNS = [
    { name:'email', p:/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, r:'[REDACTED_EMAIL]' },
    { name:'phone', p:/(?<![a-zA-Z0-9])(?:\+?\d{1,4}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,5}(?![a-zA-Z0-9])/g, r:'[REDACTED_PHONE]' },
    { name:'bearer_token', p:/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, r:'Bearer [REDACTED_TOKEN]' },
    { name:'jwt', p:/eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]*/g, r:'[REDACTED_JWT]' },
    { name:'api_key', p:/(?:api[_\-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{8,}["']?/gi, r:'[REDACTED_API_KEY]' },
    { name:'generic_secret', p:/(?:secret|private[_\-]?key|client[_\-]?secret)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{8,}["']?/gi, r:'[REDACTED_SECRET]' },
    { name:'password_field', p:/(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"',}{]{1,}["']?/gi, r:'[REDACTED_PASSWORD]' },
    { name:'session_id', p:/(?:session[_\-]?id|sid|jsessionid|phpsessid)\s*[:=]\s*["']?[A-Za-z0-9\-._]{8,}["']?/gi, r:'[REDACTED_SESSION]' },
    { name:'cookie', p:/(?:cookie|set-cookie)\s*[:=]\s*["']?[^\n"']{8,}["']?/gi, r:'[REDACTED_COOKIE]' },
    { name:'authorization', p:/(?:authorization)\s*[:=]\s*["']?[^\n"']{8,}["']?/gi, r:'[REDACTED_AUTH]' },
  ];

  function sanitizeUrl(u) {
    if (!u || typeof u !== 'string') return u;
    try {
      const url = new URL(u);
      const sp = new URLSearchParams();
      for (const [k, v] of url.searchParams) {
        const kl = k.toLowerCase();
        if (SENSITIVE_PARAMS.has(kl)) continue;
        else if (SAFE_PARAMS.has(kl)) sp.set(k, v);
        else sp.set(k, '[PARAM_REMOVED]');
      }
      url.search = sp.toString();
      if (url.hash && url.hash.length > 100) url.hash = '';
      return url.toString();
    } catch { return sanitizeText(u); }
  }

  function sanitizeText(t, rd) {
    if (!t || typeof t !== 'string') return t;
    let r = t;
    for (const { name, p, r: rpl } of PATTERNS) {
      p.lastIndex = 0;
      const before = r;
      r = r.replace(p, rpl);
      if (rd && r !== before) { p.lastIndex = 0; rd[name] = (rd[name]||0) + (before.match(p)||[]).length; }
    }
    return r;
  }

  function sanitizeDeep(obj, rd) {
    if (obj == null) return obj;
    if (typeof obj === 'string') return sanitizeText(obj, rd);
    if (Array.isArray(obj)) return obj.map(i => sanitizeDeep(i, rd));
    if (typeof obj === 'object') {
      const res = {};
      for (const [k, v] of Object.entries(obj)) {
        const kl = k.toLowerCase();
        if (kl === 'url' || kl.endsWith('url') || kl === 'href')
          res[k] = typeof v === 'string' ? sanitizeUrl(v) : sanitizeDeep(v, rd);
        else res[k] = sanitizeDeep(v, rd);
      }
      return res;
    }
    return obj;
  }

  // ═══════════════════════════════════════════════════════════════
  //  BUFFERS
  // ═══════════════════════════════════════════════════════════════

  const interactions = [];
  const consoleLogs = [];
  const jsErrors = [];
  const networkRequests = [];

  function addInteraction(e) {
    const cutoff = Date.now() - MAX_AGE_MS;
    while (interactions.length && interactions[0]._ts < cutoff) interactions.shift();
    e._ts = Date.now();
    interactions.push(e);
    if (interactions.length > MAX_INTERACTIONS) interactions.shift();
  }
  function addConsole(e) { consoleLogs.push(e); if (consoleLogs.length > MAX_CONSOLE) consoleLogs.shift(); }
  function addError(e) { jsErrors.push(e); if (jsErrors.length > MAX_ERRORS) jsErrors.shift(); }
  function addNetwork(e) { networkRequests.push(e); if (networkRequests.length > MAX_NETWORK) networkRequests.shift(); }

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════════

  function throttle(fn, d) {
    let last = 0, tid = null;
    return function (...a) {
      const now = Date.now(), rem = d - (now - last);
      if (rem <= 0) { last = now; fn.apply(this, a); }
      else if (!tid) { tid = setTimeout(() => { last = Date.now(); tid = null; fn.apply(this, a); }, rem); }
    };
  }

  function buildSelector(el) {
    if (!el || !el.tagName) return '';
    const parts = []; let cur = el, depth = 0;
    while (cur && cur !== document.body && depth < 4) {
      const tag = cur.tagName.toLowerCase();
      let sel = tag;
      const cls = Array.from(cur.classList || [])
        .filter(c => c.length < 40 && !/[0-9a-f]{8,}/i.test(c) && !/@/.test(c) && !/^user|^customer|^email/i.test(c))
        .slice(0, 3);
      if (cls.length) sel += '.' + cls.join('.');
      if (cur.parentElement) {
        const sibs = Array.from(cur.parentElement.children).filter(c => c.tagName === cur.tagName);
        if (sibs.length > 1) sel += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(sel); cur = cur.parentElement; depth++;
    }
    return parts.join(' > ');
  }

  const LABEL_TAGS = new Set(['BUTTON','A','LABEL','H1','H2','H3','H4','H5','H6','SUMMARY','LEGEND','CAPTION','TH']);
  function getLabel(el) {
    if (!el || !LABEL_TAGS.has(el.tagName)) return undefined;
    const t = (el.textContent || '').trim().substring(0, 50);
    return t || undefined;
  }

  function baseEntry(type, el) {
    return {
      timestamp: new Date().toISOString(), eventType: type, url: location.href,
      selector: buildSelector(el), tagName: el ? el.tagName : undefined,
      ariaRole: el ? (el.getAttribute('role') || undefined) : undefined,
      visibleLabel: getLabel(el),
      scrollPosition: { x: Math.round(scrollX), y: Math.round(scrollY) },
    };
  }

  function parseBrowser() {
    const ua = navigator.userAgent;
    let n = 'Unknown', v = '';
    if (ua.includes('Firefox/')) { n='Firefox'; v=ua.match(/Firefox\/([\d.]+)/)?.[1]||''; }
    else if (ua.includes('Edg/')) { n='Edge'; v=ua.match(/Edg\/([\d.]+)/)?.[1]||''; }
    else if (ua.includes('Chrome/') && !ua.includes('Edg/')) { n='Chrome'; v=ua.match(/Chrome\/([\d.]+)/)?.[1]||''; }
    else if (ua.includes('Safari/') && !ua.includes('Chrome/')) { n='Safari'; v=ua.match(/Version\/([\d.]+)/)?.[1]||''; }
    return { browserName: n, browserVersion: v };
  }

  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return str || '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERACTION TRACKING
  // ═══════════════════════════════════════════════════════════════

  document.addEventListener('click', e => {
    const entry = baseEntry('click', e.target);
    entry.viewportCoordinates = { x: Math.round(e.clientX), y: Math.round(e.clientY) };
    addInteraction(entry);
  }, true);
  document.addEventListener('submit', e => addInteraction(baseEntry('submit', e.target)), true);
  document.addEventListener('change', e => addInteraction(baseEntry('change', e.target)), true);

  const ALLOWED_KEYS = new Set(['Enter','Escape','Tab','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12']);
  document.addEventListener('keydown', e => {
    if (!ALLOWED_KEYS.has(e.key)) return;
    const entry = baseEntry('keyboard', e.target);
    entry.key = e.key;
    entry.modifiers = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
    addInteraction(entry);
  }, true);

  window.addEventListener('scroll', throttle(() => {
    addInteraction({ timestamp: new Date().toISOString(), eventType:'scroll', url: location.href,
      scrollPosition: { x: Math.round(scrollX), y: Math.round(scrollY) } });
  }, 500), { passive: true });

  window.addEventListener('resize', throttle(() => {
    addInteraction({ timestamp: new Date().toISOString(), eventType:'resize', url: location.href,
      viewportSize: { width: innerWidth, height: innerHeight } });
  }, 500));

  let lastUrl = location.href;
  const navObs = new MutationObserver(() => {
    if (location.href !== lastUrl) { const old = lastUrl; lastUrl = location.href;
      addInteraction({ timestamp: new Date().toISOString(), eventType:'navigation', url: lastUrl, previousUrl: old }); }
  });
  navObs.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', () => {
    if (location.href !== lastUrl) { const old = lastUrl; lastUrl = location.href;
      addInteraction({ timestamp: new Date().toISOString(), eventType:'navigation', url: lastUrl, previousUrl: old }); }
  });

  // ═══════════════════════════════════════════════════════════════
  //  CONSOLE & ERROR CAPTURE
  // ═══════════════════════════════════════════════════════════════

  const origConsole = {};
  ['log','warn','error','info','debug'].forEach(level => {
    origConsole[level] = console[level];
    console[level] = function (...args) {
      try {
        const msg = args.map(a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(' ').substring(0, 500);
        addConsole({ timestamp: new Date().toISOString(), level, message: msg });
      } catch {}
      origConsole[level].apply(console, args);
    };
  });

  window.addEventListener('error', e => {
    try {
      addError({ timestamp: new Date().toISOString(), message: (e.message||'').substring(0,500),
        errorType: e.error ? e.error.constructor.name : 'Error',
        stack: e.error?.stack?.substring(0,1000), sourceFile: e.filename, line: e.lineno, column: e.colno });
    } catch {}
  });
  window.addEventListener('unhandledrejection', e => {
    try {
      const r = e.reason || {};
      addError({ timestamp: new Date().toISOString(),
        message: (typeof r === 'string' ? r : r.message || 'Unhandled Promise Rejection').substring(0,500),
        errorType: r.constructor ? r.constructor.name : 'UnhandledRejection', stack: r.stack?.substring(0,1000) });
    } catch {}
  });

  // ═══════════════════════════════════════════════════════════════
  //  NETWORK CAPTURE (fetch + XHR monkey-patch)
  // ═══════════════════════════════════════════════════════════════

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || 'unknown';
    const method = args[1]?.method || (args[0]?.method) || 'GET';
    const start = Date.now();
    try {
      const res = await origFetch.apply(this, args);
      addNetwork({ timestamp: new Date().toISOString(), method, url, type:'fetch',
        statusCode: res.status, duration: Date.now()-start, error: false });
      return res;
    } catch (err) {
      addNetwork({ timestamp: new Date().toISOString(), method, url, type:'fetch',
        duration: Date.now()-start, error: true, errorDescription: err.message });
      throw err;
    }
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._br = { method, url, start: 0 };
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this._br) {
      this._br.start = Date.now();
      this.addEventListener('loadend', () => {
        addNetwork({ timestamp: new Date().toISOString(), method: this._br.method, url: this._br.url,
          type:'xhr', statusCode: this.status || undefined, duration: Date.now()-this._br.start,
          error: this.status === 0 || this.status >= 400 });
      }, { once: true });
    }
    return origSend.apply(this, args);
  };

  // ═══════════════════════════════════════════════════════════════
  //  LAYOUT2VECTOR — Canvas-Based DOM Visual Capture
  // ═══════════════════════════════════════════════════════════════

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

  function isDirectTextNode(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) return true;
    }
    return false;
  }

  function getDirectText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    }
    return text.trim();
  }

  /**
   * Capture the visual state of the page via layout2vector Canvas Writer.
   * Draws DOM geometry onto an HTML5 Canvas and annotates click coordinates.
   * Returns a Base64 PNG data URL string.
   */
  function captureVisualState() {
    const vpW = innerWidth;
    const vpH = innerHeight;
    const dpr = devicePixelRatio || 1;

    const canvas = document.createElement('canvas');
    canvas.width = vpW * dpr;
    canvas.height = vpH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Page background
    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);
    const pageBg = bodyStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
      ? bodyStyle.backgroundColor
      : (htmlStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' ? htmlStyle.backgroundColor : '#ffffff');
    ctx.fillStyle = pageBg;
    ctx.fillRect(0, 0, vpW, vpH);

    // Walk visible DOM elements
    const elements = document.querySelectorAll('*');
    for (const el of elements) {
      const tag = el.tagName;
      if (['SCRIPT','STYLE','META','LINK','HEAD','TITLE','NOSCRIPT','BR'].includes(tag)) continue;
      // Skip our own widget elements
      if (el.id === 'br-widget-btn' || el.id === 'br-widget-overlay' || el.closest('#br-widget-overlay')) continue;

      try {
        const rect = el.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > vpH || rect.right < 0 || rect.left > vpW) continue;
        if (rect.width === 0 || rect.height === 0) continue;

        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

        const x = rect.left, y = rect.top, w = rect.width, h = rect.height;

        // Background
        const bg = style.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          ctx.fillStyle = bg;
          const br = parseFloat(style.borderRadius) || 0;
          if (br > 0) { drawRoundRect(ctx, x, y, w, h, Math.min(br, w/2, h/2)); ctx.fill(); }
          else ctx.fillRect(x, y, w, h);
        }

        // Border
        const bw = parseFloat(style.borderTopWidth) || 0;
        if (bw > 0) {
          const bc = style.borderTopColor;
          if (bc && bc !== 'rgba(0, 0, 0, 0)') {
            ctx.strokeStyle = bc; ctx.lineWidth = bw;
            const br = parseFloat(style.borderRadius) || 0;
            if (br > 0) { drawRoundRect(ctx, x, y, w, h, Math.min(br, w/2, h/2)); ctx.stroke(); }
            else ctx.strokeRect(x, y, w, h);
          }
        }

        // Text
        if (isDirectTextNode(el)) {
          const text = getDirectText(el).substring(0, 200);
          if (text) {
            const fontSize = parseFloat(style.fontSize) || 14;
            ctx.font = `${style.fontWeight || 'normal'} ${fontSize}px ${style.fontFamily || 'sans-serif'}`;
            ctx.fillStyle = style.color || '#000';
            ctx.textBaseline = 'top';
            ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
            const tx = x + (parseFloat(style.paddingLeft) || 0);
            ctx.fillText(text, tx, y + (h - fontSize) / 2);
            ctx.restore();
          }
        }

        // Image / media placeholders
        if (['IMG','SVG','VIDEO','CANVAS'].includes(tag)) {
          ctx.fillStyle = 'rgba(99, 102, 241, 0.1)';
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, w, h);
          ctx.fillStyle = 'rgba(99, 102, 241, 0.5)';
          ctx.font = `${Math.min(w, h, 24) * 0.5}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(tag === 'IMG' ? '🖼' : tag === 'SVG' ? '◇' : '▶', x + w/2, y + h/2);
          ctx.textAlign = 'start';
        }
      } catch {}
    }

    // ── Draw click-path annotations ──────────────────────────
    const clicks = interactions.filter(e => e.eventType === 'click' && e.viewportCoordinates);
    let idx = 1;
    for (const click of clicks) {
      const cx = click.viewportCoordinates.x, cy = click.viewportCoordinates.y;

      // Outer glow
      ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)'; ctx.fill();

      // Red circle
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444'; ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();

      // Number
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(idx), cx, cy);
      ctx.textAlign = 'start';
      idx++;
    }

    return canvas.toDataURL('image/png');
  }

  // ═══════════════════════════════════════════════════════════════
  //  HTML REPORT TEMPLATE (inline for widget — no external deps)
  // ═══════════════════════════════════════════════════════════════

  function syntaxHighlight(json) {
    if (typeof json !== 'string') json = JSON.stringify(json, null, 2);
    json = escapeHtml(json);
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function (match) {
        let cls = 'json-number';
        if (/^"/.test(match)) { cls = /:$/.test(match) ? 'json-key' : 'json-string'; }
        else if (/true|false/.test(match)) cls = 'json-boolean';
        else if (/null/.test(match)) cls = 'json-null';
        return '<span class="' + cls + '">' + match + '</span>';
      }
    );
  }

  function buildHtmlReport(data) {
    const toolVersion = data.widgetVersion || data.extensionVersion || 'unknown';
    const reportTime = data.reportTimestamp ? new Date(data.reportTimestamp).toLocaleString('de-DE', {
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'
    }) : 'N/A';
    const actual = data.userDescription?.actual || 'Keine Angabe';
    const expected = data.userDescription?.expected || 'Keine Angabe';
    const pm = data.pageMetadata || {};

    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bug Report — ${escapeHtml(reportTime)}</title>
<style>
:root{--bg-primary:#0f1117;--bg-secondary:#1a1d27;--bg-card:#222636;--bg-card-hover:#2a2f42;--border:#2d3348;--text-primary:#e8eaf0;--text-secondary:#9096a8;--text-muted:#636882;--accent:#6366f1;--accent-glow:rgba(99,102,241,0.15);--danger:#ef4444;--success:#22c55e;--warning:#f59e0b;--radius:12px;--radius-sm:8px;--font-mono:'SF Mono','Fira Code','Cascadia Code','Consolas',monospace;--font-sans:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font-sans);background:var(--bg-primary);color:var(--text-primary);line-height:1.6;-webkit-font-smoothing:antialiased}
.container{max-width:960px;margin:0 auto;padding:32px 24px 64px}
.report-header{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.report-logo{font-size:32px}
.report-title{font-size:24px;font-weight:800;letter-spacing:-0.03em;flex:1}
.report-badge{font-size:11px;color:var(--text-muted);background:var(--bg-secondary);padding:4px 10px;border-radius:20px;border:1px solid var(--border);font-weight:500}
.report-sub{font-size:13px;color:var(--text-muted);margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--border)}
.section{margin-bottom:24px}
.section-header{display:flex;align-items:center;gap:8px;cursor:pointer;padding:14px 16px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius);transition:all .2s;user-select:none}
.section-header:hover{background:var(--bg-card);border-color:var(--accent)}
.section-icon{font-size:18px}
.section-title{font-size:14px;font-weight:700;flex:1}
.section-count{font-size:11px;background:var(--accent-glow);color:var(--accent);padding:2px 8px;border-radius:12px;font-weight:600}
.section-chevron{font-size:12px;color:var(--text-muted);transition:transform .2s}
.section-body{margin-top:8px;padding:16px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius);display:none;animation:slideDown .2s}
.section.open .section-body{display:block}
.section.open .section-chevron{transform:rotate(90deg)}
@keyframes slideDown{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.meta-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:24px}
.meta-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px}
.meta-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;font-weight:600}
.meta-value{font-size:13px;font-weight:600;word-break:break-all}
.meta-value.mono{font-family:var(--font-mono);font-size:12px;font-weight:500}
.user-desc{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}
@media(max-width:600px){.user-desc{grid-template-columns:1fr}}
.desc-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.desc-card.actual{border-left:3px solid var(--danger)}
.desc-card.expected{border-left:3px solid var(--success)}
.desc-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:8px}
.desc-card.actual .desc-label{color:var(--danger)}
.desc-card.expected .desc-label{color:var(--success)}
.desc-text{font-size:14px;line-height:1.6;color:var(--text-secondary);white-space:pre-wrap}
.screenshot-container{margin-bottom:24px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--bg-secondary)}
.screenshot-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:var(--text-muted);padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px}
.screenshot-container img{width:100%;display:block}
.json-block{background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;overflow-x:auto;font-family:var(--font-mono);font-size:11.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;max-height:500px;overflow-y:auto}
.json-key{color:#93c5fd}.json-string{color:#86efac}.json-number{color:#fbbf24}.json-boolean{color:#c084fc}.json-null{color:#f87171}
.limitations-list{list-style:none;padding:0}
.limitations-list li{font-size:12.5px;color:var(--text-secondary);padding:6px 0;border-bottom:1px solid rgba(45,51,72,.5);display:flex;align-items:flex-start;gap:8px}
.limitations-list li:last-child{border-bottom:none}
.limitations-list li::before{content:'⚠️';font-size:12px;flex-shrink:0}
.summary-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.summary-item{background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;text-align:center}
.summary-item-label{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:4px}
.summary-item-value{font-size:18px;font-weight:700;color:var(--accent)}
.report-footer{text-align:center;font-size:11px;color:var(--text-muted);margin-top:40px;padding-top:20px;border-top:1px solid var(--border)}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}::-webkit-scrollbar-thumb:hover{background:var(--text-muted)}
</style>
</head>
<body>
<div class="container">
<div class="report-header">
<div class="report-logo">🐛</div>
<div class="report-title">Bug Report</div>
<div class="report-badge">Schema v${escapeHtml(data.schemaVersion||'2.0.0')}</div>
<div class="report-badge">Tool v${escapeHtml(toolVersion)}</div>
</div>
<div class="report-sub">Erstellt am ${escapeHtml(reportTime)}</div>

<div class="user-desc">
<div class="desc-card actual"><div class="desc-label">Ist-Zustand (Actual)</div><div class="desc-text">${escapeHtml(actual)}</div></div>
<div class="desc-card expected"><div class="desc-label">Soll-Zustand (Expected)</div><div class="desc-text">${escapeHtml(expected)}</div></div>
</div>

${data.screenshotBase64 ? `<div class="screenshot-container"><div class="screenshot-label">📸 Annotated Screenshot (DOM Capture via layout2vector)</div><img src="${data.screenshotBase64}" alt="Annotated screenshot"></div>` : `<div class="screenshot-container"><div class="screenshot-label">📸 Screenshot not available</div></div>`}

<div class="meta-grid">
<div class="meta-card"><div class="meta-label">URL</div><div class="meta-value mono">${escapeHtml(pm.url||'N/A')}</div></div>
<div class="meta-card"><div class="meta-label">Browser</div><div class="meta-value">${escapeHtml((pm.browserName||'Unknown')+' '+(pm.browserVersion||''))}</div></div>
<div class="meta-card"><div class="meta-label">Viewport</div><div class="meta-value">${pm.viewportSize?pm.viewportSize.width+' × '+pm.viewportSize.height:'N/A'}</div></div>
<div class="meta-card"><div class="meta-label">Screen Resolution</div><div class="meta-value">${pm.screenResolution?pm.screenResolution.width+' × '+pm.screenResolution.height:'N/A'}</div></div>
<div class="meta-card"><div class="meta-label">Scroll Position</div><div class="meta-value">${pm.scrollPosition?'X: '+pm.scrollPosition.x+'  Y: '+pm.scrollPosition.y:'N/A'}</div></div>
<div class="meta-card"><div class="meta-label">Zoom Level</div><div class="meta-value">${pm.zoomLevel!=null?pm.zoomLevel:'N/A'}</div></div>
<div class="meta-card"><div class="meta-label">User Agent</div><div class="meta-value mono" style="font-size:10px">${escapeHtml(pm.userAgent||'N/A')}</div></div>
</div>

<div class="section open" id="sectionInteractions"><div class="section-header" onclick="this.parentElement.classList.toggle('open')"><span class="section-icon">👆</span><span class="section-title">User Interactions</span><span class="section-count">${(data.interactions||[]).length}</span><span class="section-chevron">▶</span></div><div class="section-body"><div class="json-block">${syntaxHighlight(data.interactions||[])}</div></div></div>

<div class="section" id="sectionConsole"><div class="section-header" onclick="this.parentElement.classList.toggle('open')"><span class="section-icon">📋</span><span class="section-title">Console Logs</span><span class="section-count">${(data.consoleLogs||[]).length}</span><span class="section-chevron">▶</span></div><div class="section-body"><div class="json-block">${syntaxHighlight(data.consoleLogs||[])}</div></div></div>

<div class="section" id="sectionErrors"><div class="section-header" onclick="this.parentElement.classList.toggle('open')"><span class="section-icon">⚠️</span><span class="section-title">JavaScript Errors</span><span class="section-count">${(data.jsErrors||[]).length}</span><span class="section-chevron">▶</span></div><div class="section-body"><div class="json-block">${syntaxHighlight(data.jsErrors||[])}</div></div></div>

<div class="section" id="sectionNetwork"><div class="section-header" onclick="this.parentElement.classList.toggle('open')"><span class="section-icon">🌐</span><span class="section-title">Network Requests</span><span class="section-count">${(data.networkRequests||[]).length}</span><span class="section-chevron">▶</span></div><div class="section-body"><div class="json-block">${syntaxHighlight(data.networkRequests||[])}</div></div></div>

<div class="section" id="sectionSanitization"><div class="section-header" onclick="this.parentElement.classList.toggle('open')"><span class="section-icon">🔒</span><span class="section-title">Sanitization Summary</span><span class="section-count">${data.sanitizationSummary?.totalRedactions||0} redactions</span><span class="section-chevron">▶</span></div><div class="section-body">
${data.sanitizationSummary?.redactionsByType && Object.keys(data.sanitizationSummary.redactionsByType).length > 0 ? `<div class="summary-grid">${Object.entries(data.sanitizationSummary.redactionsByType).map(([t,c])=>`<div class="summary-item"><div class="summary-item-label">${escapeHtml(t)}</div><div class="summary-item-value">${c}</div></div>`).join('')}</div>` : '<p style="color:var(--text-muted);font-size:13px">No redactions were necessary.</p>'}
</div></div>

<div class="section" id="sectionLimitations"><div class="section-header" onclick="this.parentElement.classList.toggle('open')"><span class="section-icon">ℹ️</span><span class="section-title">Capture Limitations</span><span class="section-chevron">▶</span></div><div class="section-body"><ul class="limitations-list">${(data.captureLimitations||[]).map(l=>`<li>${escapeHtml(l)}</li>`).join('')}</ul></div></div>

<script type="application/json" id="bug-report-json">${escapeHtml(JSON.stringify(data,null,2))}</script>

<div class="report-footer">Bug Report Dashboard — Schema v${escapeHtml(data.schemaVersion||'2.0.0')} — Tool v${escapeHtml(toolVersion)}<br>Generated ${escapeHtml(reportTime)}</div>
</div>
</body>
</html>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  REPORT GENERATION
  // ═══════════════════════════════════════════════════════════════

  const LIMITATIONS = [
    'Only captures events after this script was loaded.',
    'Cannot capture network requests made before script initialization.',
    'Network capture is limited to fetch() and XMLHttpRequest (no image/script loads).',
    'Form field values and typed characters are not captured.',
    'Console logs and errors before script load are not included.',
    'Visual capture renders a simplified DOM geometry, not a pixel-perfect screenshot.',
  ];

  function generateReport(userDescription, screenshotBase64) {
    const { browserName, browserVersion } = parseBrowser();
    const raw = {
      schemaVersion: '2.0.0', reportTimestamp: new Date().toISOString(), widgetVersion: VERSION,
      pageMetadata: {
        url: location.href, userAgent: navigator.userAgent,
        viewportSize: { width: innerWidth, height: innerHeight },
        screenResolution: { width: screen.width, height: screen.height },
        scrollPosition: { x: Math.round(scrollX), y: Math.round(scrollY) },
        zoomLevel: Math.round(devicePixelRatio * 100) / 100, browserName, browserVersion,
      },
      userDescription,
      screenshotBase64: '__SCREENSHOT_PLACEHOLDER__',
      interactions: interactions.map(({ _ts, ...r }) => r),
      consoleLogs: [...consoleLogs], jsErrors: [...jsErrors], networkRequests: [...networkRequests],
    };
    const rd = {};
    const report = sanitizeDeep(raw, rd);
    report.screenshotBase64 = screenshotBase64;
    report.sanitizationSummary = { totalRedactions: Object.values(rd).reduce((a,b)=>a+b,0), redactionsByType: rd };
    report.captureLimitations = LIMITATIONS;
    return report;
  }

  function downloadReport(userDescription) {
    // Capture visual state
    let screenshotBase64 = null;
    try {
      screenshotBase64 = captureVisualState();
    } catch (e) {
      // Visual capture failed; continue without screenshot
    }

    const report = generateReport(userDescription, screenshotBase64);
    const htmlStr = buildHtmlReport(report);
    const blob = new Blob([htmlStr], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bug_report_' + Date.now() + '.html';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ═══════════════════════════════════════════════════════════════
  //  UI — Floating Button + Modal
  // ═══════════════════════════════════════════════════════════════

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #br-widget-btn {
        position:fixed; bottom:20px; right:20px; z-index:2147483647;
        width:52px; height:52px; border-radius:50%; border:none; cursor:pointer;
        background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff;
        font-size:24px; display:flex; align-items:center; justify-content:center;
        box-shadow:0 4px 20px rgba(99,102,241,0.4); transition:all .2s ease;
      }
      #br-widget-btn:hover { transform:scale(1.1); box-shadow:0 6px 28px rgba(99,102,241,0.55); }
      #br-widget-overlay {
        position:fixed; inset:0; z-index:2147483646; background:rgba(0,0,0,0.5);
        display:none; align-items:center; justify-content:center;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      }
      #br-widget-overlay.open { display:flex; }
      #br-widget-modal {
        background:#0f1117; color:#e8eaf0; border-radius:14px; padding:24px;
        width:380px; max-width:90vw; box-shadow:0 20px 60px rgba(0,0,0,0.6);
        animation:br-fade-in .2s ease;
      }
      @keyframes br-fade-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      .br-header { display:flex; align-items:center; gap:8px; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid #2d3348; }
      .br-header-logo { font-size:22px; }
      .br-header-title { font-size:16px; font-weight:700; flex:1; }
      .br-header-ver { font-size:11px; color:#636882; background:#1a1d27; padding:2px 7px; border-radius:20px; border:1px solid #2d3348; }
      .br-info { font-size:12.5px; color:#9096a8; line-height:1.5; margin-bottom:12px; }
      .br-url { font-size:11.5px; color:#6366f1; background:#1a1d27; padding:8px 10px; border-radius:6px;
        border:1px solid #2d3348; margin-bottom:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        font-family:'SF Mono','Fira Code',Consolas,monospace; }
      .br-stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px; }
      .br-stat { background:#222636; border:1px solid #2d3348; border-radius:10px; padding:10px; text-align:center; transition:all .15s; }
      .br-stat:hover { background:#2a2f42; border-color:#6366f1; }
      .br-stat-icon { font-size:16px; margin-bottom:4px; }
      .br-stat-val { font-size:20px; font-weight:700; letter-spacing:-0.03em; }
      .br-stat-lbl { font-size:10.5px; color:#636882; text-transform:uppercase; letter-spacing:0.04em; margin-top:2px; }
      .br-privacy { font-size:11px; color:#636882; background:rgba(34,197,94,0.06); border:1px solid rgba(34,197,94,0.15);
        border-radius:6px; padding:8px 10px; margin-bottom:16px; line-height:1.5; }
      .br-actions { display:flex; gap:8px; }
      .br-btn { flex:1; padding:10px 14px; border:none; border-radius:10px; font-size:13px; font-weight:600;
        cursor:pointer; transition:all .15s; font-family:inherit; display:flex; align-items:center; justify-content:center; gap:6px; }
      .br-btn-primary { background:#6366f1; color:#fff; box-shadow:0 2px 8px rgba(99,102,241,0.2); }
      .br-btn-primary:hover { background:#7577f5; box-shadow:0 4px 16px rgba(99,102,241,0.3); transform:translateY(-1px); }
      .br-btn-secondary { background:#222636; color:#9096a8; border:1px solid #2d3348; }
      .br-btn-secondary:hover { background:#2a2f42; color:#e8eaf0; }
    `;
    document.head.appendChild(style);
  }

  function createUI() {
    injectStyles();

    // Floating button
    const btn = document.createElement('button');
    btn.id = 'br-widget-btn';
    btn.innerHTML = '🐛';
    btn.title = 'Bug Report erstellen';
    document.body.appendChild(btn);

    // Overlay + Modal
    const overlay = document.createElement('div');
    overlay.id = 'br-widget-overlay';
    overlay.innerHTML = `
      <div id="br-widget-modal">
        <div class="br-header">
          <div class="br-header-logo">🐛</div>
          <div class="br-header-title">Bug Report</div>
          <div class="br-header-ver">v${VERSION}</div>
        </div>
        <p class="br-info">The following information will be included in the bug report:</p>
        <div class="br-url" id="br-url"></div>
        <div class="br-stats">
          <div class="br-stat"><div class="br-stat-icon">👆</div><div class="br-stat-val" id="br-s-int">0</div><div class="br-stat-lbl">Interactions</div></div>
          <div class="br-stat"><div class="br-stat-icon">📋</div><div class="br-stat-val" id="br-s-con">0</div><div class="br-stat-lbl">Console Logs</div></div>
          <div class="br-stat"><div class="br-stat-icon">⚠️</div><div class="br-stat-val" id="br-s-err">0</div><div class="br-stat-lbl">JS Errors</div></div>
          <div class="br-stat"><div class="br-stat-icon">🌐</div><div class="br-stat-val" id="br-s-net">0</div><div class="br-stat-lbl">Network Req.</div></div>
        </div>
        <p class="br-privacy">🔒 Sensitive data (emails, tokens, passwords, API keys) will be automatically redacted.</p>
        <div class="br-actions">
          <button class="br-btn br-btn-primary" id="br-dl">📥 Download Report</button>
          <button class="br-btn br-btn-secondary" id="br-cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Event handlers
    btn.addEventListener('click', () => {
      const url = location.href;
      document.getElementById('br-url').textContent = url.length > 55 ? url.substring(0,52) + '…' : url;
      document.getElementById('br-url').title = url;
      document.getElementById('br-s-int').textContent = interactions.length;
      document.getElementById('br-s-con').textContent = consoleLogs.length;
      document.getElementById('br-s-err').textContent = jsErrors.length;
      document.getElementById('br-s-net').textContent = networkRequests.length;
      overlay.classList.add('open');
    });

    document.getElementById('br-cancel').addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

    document.getElementById('br-dl').addEventListener('click', () => {
      overlay.classList.remove('open');

      // Prompt for Ist/Soll descriptions
      const actual = window.prompt(
        'Was ist passiert?\n\nBeschreibe kurz das Problem, das du beobachtet hast.\n\nBeispiel: \"Beim Klick auf Speichern passiert nichts\" oder \"Die Seite zeigt eine Fehlermeldung\"',
        ''
      );
      if (actual === null) return; // User cancelled

      const expected = window.prompt(
        'Was hättest du erwartet?\n\nBeschreibe kurz, was stattdessen hätte passieren sollen.\n\nBeispiel: \"Die Daten sollten gespeichert werden\" oder \"Die Seite sollte normal laden\"',
        ''
      );
      if (expected === null) return; // User cancelled

      const userDescription = {
        actual: actual || 'Keine Angabe',
        expected: expected || 'Keine Angabe',
      };

      downloadReport(userDescription);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════════

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
  else createUI();

})();
