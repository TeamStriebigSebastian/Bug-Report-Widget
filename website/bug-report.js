/**
 * Bug Report Widget — Website Edition
 * Drop-in script for any website. No extension needed.
 * Usage: <script src="bug-report.js"></script>
 */
(function () {
  'use strict';
  if (window.__BugReportLoaded) return;
  window.__BugReportLoaded = true;

  const VERSION = '1.0.0';
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
  //  REPORT GENERATION
  // ═══════════════════════════════════════════════════════════════

  const LIMITATIONS = [
    'Only captures events after this script was loaded.',
    'Cannot capture network requests made before script initialization.',
    'Network capture is limited to fetch() and XMLHttpRequest (no image/script loads).',
    'Form field values and typed characters are not captured.',
    'Console logs and errors before script load are not included.',
  ];

  function generateReport() {
    const { browserName, browserVersion } = parseBrowser();
    const raw = {
      schemaVersion: '1.0.0', reportTimestamp: new Date().toISOString(), widgetVersion: VERSION,
      pageMetadata: {
        url: location.href, userAgent: navigator.userAgent,
        viewportSize: { width: innerWidth, height: innerHeight },
        screenResolution: { width: screen.width, height: screen.height },
        scrollPosition: { x: Math.round(scrollX), y: Math.round(scrollY) },
        zoomLevel: Math.round(devicePixelRatio * 100) / 100, browserName, browserVersion,
      },
      interactions: interactions.map(({ _ts, ...r }) => r),
      consoleLogs: [...consoleLogs], jsErrors: [...jsErrors], networkRequests: [...networkRequests],
    };
    const rd = {};
    const report = sanitizeDeep(raw, rd);
    report.sanitizationSummary = { totalRedactions: Object.values(rd).reduce((a,b)=>a+b,0), redactionsByType: rd };
    report.captureLimitations = LIMITATIONS;
    return report;
  }

  function downloadReport() {
    const report = generateReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bug_report_' + Date.now() + '.json';
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
      downloadReport();
      overlay.classList.remove('open');
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════════

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
  else createUI();

})();
