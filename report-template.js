/**
 * report-template.js — Shared HTML Report Template Generator
 *
 * Builds a self-contained, styled HTML developer dashboard for bug reports.
 * Used by both background.js (extension) and bug-report.js (widget).
 *
 * @param {Object} reportData - The sanitized report data object
 * @returns {string} Complete HTML document string
 */

const ReportTemplate = (() => {

  /**
   * Escape HTML special characters to prevent XSS in the report.
   */
  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return str || '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Format JSON with syntax highlighting spans.
   */
  function syntaxHighlight(json) {
    if (typeof json !== 'string') {
      json = JSON.stringify(json, null, 2);
    }
    json = escapeHtml(json);
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function (match) {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'json-key';
          } else {
            cls = 'json-string';
          }
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      }
    );
  }

  /**
   * Build the complete HTML report.
   */
  function build(data) {
    const {
      schemaVersion,
      reportTimestamp,
      extensionVersion,
      widgetVersion,
      pageMetadata,
      userDescription,
      screenshotBase64,
      interactions,
      consoleLogs,
      jsErrors,
      networkRequests,
      sanitizationSummary,
      captureLimitations,
    } = data;

    const toolVersion = extensionVersion || widgetVersion || 'unknown';
    const reportTime = reportTimestamp ? new Date(reportTimestamp).toLocaleString('de-DE', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }) : 'N/A';

    const actual = userDescription?.actual || 'Keine Angabe';
    const expected = userDescription?.expected || 'Keine Angabe';

    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bug Report — ${escapeHtml(reportTime)}</title>
  <style>
    /* ═══════════════════════════════════════════════════════════════
       Bug Report HTML Dashboard — Styles
       ═══════════════════════════════════════════════════════════════ */

    :root {
      --bg-primary: #0f1117;
      --bg-secondary: #1a1d27;
      --bg-card: #222636;
      --bg-card-hover: #2a2f42;
      --border: #2d3348;
      --text-primary: #e8eaf0;
      --text-secondary: #9096a8;
      --text-muted: #636882;
      --accent: #6366f1;
      --accent-hover: #7577f5;
      --accent-glow: rgba(99, 102, 241, 0.15);
      --danger: #ef4444;
      --success: #22c55e;
      --warning: #f59e0b;
      --info: #3b82f6;
      --radius: 12px;
      --radius-sm: 8px;
      --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-sans);
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: 32px 24px 64px;
    }

    /* ── Header ─────────────────────────────────────────────────── */

    .report-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .report-logo { font-size: 32px; }

    .report-title {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.03em;
      flex: 1;
    }

    .report-badge {
      font-size: 11px;
      color: var(--text-muted);
      background: var(--bg-secondary);
      padding: 4px 10px;
      border-radius: 20px;
      border: 1px solid var(--border);
      font-weight: 500;
    }

    .report-sub {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }

    /* ── Sections ───────────────────────────────────────────────── */

    .section {
      margin-bottom: 24px;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 14px 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: all 0.2s ease;
      user-select: none;
    }

    .section-header:hover {
      background: var(--bg-card);
      border-color: var(--accent);
    }

    .section-icon { font-size: 18px; }

    .section-title {
      font-size: 14px;
      font-weight: 700;
      flex: 1;
      letter-spacing: -0.01em;
    }

    .section-count {
      font-size: 11px;
      background: var(--accent-glow);
      color: var(--accent);
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
    }

    .section-chevron {
      font-size: 12px;
      color: var(--text-muted);
      transition: transform 0.2s ease;
    }

    .section-body {
      margin-top: 8px;
      padding: 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      display: none;
      animation: slideDown 0.2s ease;
    }

    .section.open .section-body { display: block; }
    .section.open .section-chevron { transform: rotate(90deg); }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ── Metadata Grid ──────────────────────────────────────────── */

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
      margin-bottom: 24px;
    }

    .meta-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 12px 14px;
    }

    .meta-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-bottom: 4px;
      font-weight: 600;
    }

    .meta-value {
      font-size: 13px;
      font-weight: 600;
      word-break: break-all;
    }

    .meta-value.mono {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 500;
    }

    /* ── User Description ───────────────────────────────────────── */

    .user-desc {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 24px;
    }

    @media (max-width: 600px) {
      .user-desc { grid-template-columns: 1fr; }
    }

    .desc-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
    }

    .desc-card.actual { border-left: 3px solid var(--danger); }
    .desc-card.expected { border-left: 3px solid var(--success); }

    .desc-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .desc-card.actual .desc-label { color: var(--danger); }
    .desc-card.expected .desc-label { color: var(--success); }

    .desc-text {
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-secondary);
      white-space: pre-wrap;
    }

    /* ── Screenshot ──────────────────────────────────────────────── */

    .screenshot-container {
      margin-bottom: 24px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--bg-secondary);
    }

    .screenshot-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 700;
      color: var(--text-muted);
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .screenshot-container img {
      width: 100%;
      display: block;
    }

    /* ── JSON Display ───────────────────────────────────────────── */

    .json-block {
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 14px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 500px;
      overflow-y: auto;
    }

    .json-key { color: #93c5fd; }
    .json-string { color: #86efac; }
    .json-number { color: #fbbf24; }
    .json-boolean { color: #c084fc; }
    .json-null { color: #f87171; }

    /* ── Limitations / Summary ──────────────────────────────────── */

    .limitations-list {
      list-style: none;
      padding: 0;
    }

    .limitations-list li {
      font-size: 12.5px;
      color: var(--text-secondary);
      padding: 6px 0;
      border-bottom: 1px solid rgba(45, 51, 72, 0.5);
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .limitations-list li:last-child { border-bottom: none; }

    .limitations-list li::before {
      content: '⚠️';
      font-size: 12px;
      flex-shrink: 0;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    }

    .summary-item {
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      text-align: center;
    }

    .summary-item-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .summary-item-value {
      font-size: 18px;
      font-weight: 700;
      color: var(--accent);
    }

    /* ── Footer ──────────────────────────────────────────────────── */

    .report-footer {
      text-align: center;
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
    }

    /* ── Scrollbar ───────────────────────────────────────────────── */

    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
  </style>
</head>
<body>
  <div class="container">

    <!-- Header -->
    <div class="report-header">
      <div class="report-logo">🐛</div>
      <div class="report-title">Bug Report</div>
      <div class="report-badge">Schema v${escapeHtml(schemaVersion || '2.0.0')}</div>
      <div class="report-badge">Tool v${escapeHtml(toolVersion)}</div>
    </div>
    <div class="report-sub">
      Erstellt am ${escapeHtml(reportTime)}
    </div>

    <!-- User Description: Ist / Soll -->
    <div class="user-desc">
      <div class="desc-card actual">
        <div class="desc-label">Ist-Zustand (Actual)</div>
        <div class="desc-text">${escapeHtml(actual)}</div>
      </div>
      <div class="desc-card expected">
        <div class="desc-label">Soll-Zustand (Expected)</div>
        <div class="desc-text">${escapeHtml(expected)}</div>
      </div>
    </div>

    <!-- Screenshot -->
    ${screenshotBase64 ? `
    <div class="screenshot-container">
      <div class="screenshot-label">📸 Annotated Screenshot (DOM Capture via layout2vector)</div>
      <img src="${screenshotBase64}" alt="Annotated screenshot of the page at time of bug report">
    </div>
    ` : `
    <div class="screenshot-container">
      <div class="screenshot-label">📸 Screenshot not available</div>
    </div>
    `}

    <!-- Page Metadata -->
    <div class="meta-grid">
      <div class="meta-card">
        <div class="meta-label">URL</div>
        <div class="meta-value mono">${escapeHtml(pageMetadata?.url || 'N/A')}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Browser</div>
        <div class="meta-value">${escapeHtml((pageMetadata?.browserName || 'Unknown') + ' ' + (pageMetadata?.browserVersion || ''))}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Viewport</div>
        <div class="meta-value">${pageMetadata?.viewportSize ? pageMetadata.viewportSize.width + ' × ' + pageMetadata.viewportSize.height : 'N/A'}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Screen Resolution</div>
        <div class="meta-value">${pageMetadata?.screenResolution ? pageMetadata.screenResolution.width + ' × ' + pageMetadata.screenResolution.height : 'N/A'}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Scroll Position</div>
        <div class="meta-value">${pageMetadata?.scrollPosition ? 'X: ' + pageMetadata.scrollPosition.x + '  Y: ' + pageMetadata.scrollPosition.y : 'N/A'}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Zoom Level</div>
        <div class="meta-value">${pageMetadata?.zoomLevel != null ? pageMetadata.zoomLevel : 'N/A'}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">User Agent</div>
        <div class="meta-value mono" style="font-size:10px;">${escapeHtml(pageMetadata?.userAgent || 'N/A')}</div>
      </div>
    </div>

    <!-- Interactions -->
    <div class="section open" id="sectionInteractions">
      <div class="section-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="section-icon">👆</span>
        <span class="section-title">User Interactions</span>
        <span class="section-count">${(interactions || []).length}</span>
        <span class="section-chevron">▶</span>
      </div>
      <div class="section-body">
        <div class="json-block">${syntaxHighlight(interactions || [])}</div>
      </div>
    </div>

    <!-- Console Logs -->
    <div class="section" id="sectionConsole">
      <div class="section-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="section-icon">📋</span>
        <span class="section-title">Console Logs</span>
        <span class="section-count">${(consoleLogs || []).length}</span>
        <span class="section-chevron">▶</span>
      </div>
      <div class="section-body">
        <div class="json-block">${syntaxHighlight(consoleLogs || [])}</div>
      </div>
    </div>

    <!-- JS Errors -->
    <div class="section" id="sectionErrors">
      <div class="section-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="section-icon">⚠️</span>
        <span class="section-title">JavaScript Errors</span>
        <span class="section-count">${(jsErrors || []).length}</span>
        <span class="section-chevron">▶</span>
      </div>
      <div class="section-body">
        <div class="json-block">${syntaxHighlight(jsErrors || [])}</div>
      </div>
    </div>

    <!-- Network Requests -->
    <div class="section" id="sectionNetwork">
      <div class="section-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="section-icon">🌐</span>
        <span class="section-title">Network Requests</span>
        <span class="section-count">${(networkRequests || []).length}</span>
        <span class="section-chevron">▶</span>
      </div>
      <div class="section-body">
        <div class="json-block">${syntaxHighlight(networkRequests || [])}</div>
      </div>
    </div>

    <!-- Sanitization Summary -->
    <div class="section" id="sectionSanitization">
      <div class="section-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="section-icon">🔒</span>
        <span class="section-title">Sanitization Summary</span>
        <span class="section-count">${sanitizationSummary?.totalRedactions || 0} redactions</span>
        <span class="section-chevron">▶</span>
      </div>
      <div class="section-body">
        ${sanitizationSummary?.redactionsByType && Object.keys(sanitizationSummary.redactionsByType).length > 0 ? `
        <div class="summary-grid">
          ${Object.entries(sanitizationSummary.redactionsByType).map(([type, count]) => `
          <div class="summary-item">
            <div class="summary-item-label">${escapeHtml(type)}</div>
            <div class="summary-item-value">${count}</div>
          </div>
          `).join('')}
        </div>
        ` : '<p style="color:var(--text-muted);font-size:13px;">No redactions were necessary.</p>'}
        ${sanitizationSummary?.validationIssues && sanitizationSummary.validationIssues.length > 0 ? `
        <div style="margin-top:12px;">
          <p style="color:var(--warning);font-size:12px;font-weight:600;margin-bottom:6px;">Validation Issues:</p>
          <ul class="limitations-list">
            ${sanitizationSummary.validationIssues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
      </div>
    </div>

    <!-- Capture Limitations -->
    <div class="section" id="sectionLimitations">
      <div class="section-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="section-icon">ℹ️</span>
        <span class="section-title">Capture Limitations</span>
        <span class="section-chevron">▶</span>
      </div>
      <div class="section-body">
        <ul class="limitations-list">
          ${(captureLimitations || []).map(l => `<li>${escapeHtml(l)}</li>`).join('')}
        </ul>
      </div>
    </div>

    <!-- Embedded JSON (stable, versioned, for automated extraction) -->
    <script type="application/json" id="bug-report-json">
${escapeHtml(JSON.stringify(data, null, 2))}
    </script>

    <div class="report-footer">
      Bug Report Dashboard — Schema v${escapeHtml(schemaVersion || '2.0.0')} — Tool v${escapeHtml(toolVersion)}<br>
      Generated ${escapeHtml(reportTime)}
    </div>

  </div>
</body>
</html>`;
  }

  return { build, escapeHtml, syntaxHighlight };

})();

// Make available in different contexts
if (typeof globalThis !== 'undefined') {
  globalThis.ReportTemplate = ReportTemplate;
}
