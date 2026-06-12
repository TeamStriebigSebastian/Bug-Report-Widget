/**
 * background.js — Service Worker for Bug Report Extension
 *
 * Responsibilities:
 *  - Capture network request metadata via webRequest API (per-tab, max 200)
 *  - Orchestrate report assembly from content script data + network data
 *  - Apply final sanitization via sanitizer.js
 *  - Trigger JSON file download
 */

importScripts('sanitizer.js');

const EXTENSION_VERSION = '1.0.0';

// ═══════════════════════════════════════════════════════════════════
//  NETWORK REQUEST BUFFER (per-tab)
// ═══════════════════════════════════════════════════════════════════

const MAX_NETWORK_ENTRIES = 200;
const networkBuffers = new Map(); // tabId → { entries: [], pendingRequests: Map }

function getTabBuffer(tabId) {
  if (!networkBuffers.has(tabId)) {
    networkBuffers.set(tabId, {
      entries: [],
      pendingRequests: new Map(),
    });
  }
  return networkBuffers.get(tabId);
}

function addNetworkEntry(tabId, entry) {
  const buf = getTabBuffer(tabId);
  buf.entries.push(entry);
  if (buf.entries.length > MAX_NETWORK_ENTRIES) {
    buf.entries.shift();
  }
}

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  networkBuffers.delete(tabId);
});

// Clean up when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Don't clear completely on navigation, keep buffer for SPA-like apps
    // But do clear pending requests
    const buf = networkBuffers.get(tabId);
    if (buf) {
      buf.pendingRequests.clear();
    }
  }
});

// ── Network Request Tracking ─────────────────────────────────────

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return; // Skip non-tab requests

    const buf = getTabBuffer(details.tabId);
    buf.pendingRequests.set(details.requestId, {
      startTime: details.timeStamp,
      method: details.method,
      url: details.url,
      type: details.type,
    });
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const buf = getTabBuffer(details.tabId);
    const pending = buf.pendingRequests.get(details.requestId);
    buf.pendingRequests.delete(details.requestId);

    addNetworkEntry(details.tabId, {
      timestamp: new Date(details.timeStamp).toISOString(),
      method: pending?.method || details.method || 'UNKNOWN',
      url: details.url,
      type: details.type || undefined,
      statusCode: details.statusCode,
      duration: pending ? Math.round(details.timeStamp - pending.startTime) : undefined,
      error: false,
    });
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const buf = getTabBuffer(details.tabId);
    const pending = buf.pendingRequests.get(details.requestId);
    buf.pendingRequests.delete(details.requestId);

    addNetworkEntry(details.tabId, {
      timestamp: new Date(details.timeStamp).toISOString(),
      method: pending?.method || 'UNKNOWN',
      url: details.url,
      type: details.type || undefined,
      statusCode: undefined,
      duration: pending ? Math.round(details.timeStamp - pending.startTime) : undefined,
      error: true,
      errorDescription: details.error || undefined,
    });
  },
  { urls: ['<all_urls>'] }
);

// ═══════════════════════════════════════════════════════════════════
//  REPORT ASSEMBLY & DOWNLOAD
// ═══════════════════════════════════════════════════════════════════

const CAPTURE_LIMITATIONS = [
  'Only captures events while the extension was active on the current page.',
  'Cannot capture data from browser-internal pages (chrome://, about://).',
  'Cannot capture data from restricted pages or cross-origin iframes with limited extension access.',
  'Console logs, JS errors, and network requests that occurred before extension initialization are not included.',
  'Network request/response bodies and headers are not captured.',
  'Form field values and typed characters are not captured.',
];

async function assembleReport(tabId) {
  // Get data from content script
  const contentData = await chrome.tabs.sendMessage(tabId, {
    type: 'GET_BUG_REPORT_DATA',
  });

  // Get network data for this tab
  const tabBuffer = networkBuffers.get(tabId);
  const networkRequests = tabBuffer ? [...tabBuffer.entries] : [];

  // Build the raw report
  const rawReport = {
    schemaVersion: '1.0.0',
    reportTimestamp: new Date().toISOString(),
    extensionVersion: EXTENSION_VERSION,
    pageMetadata: contentData.pageMetadata,
    interactions: contentData.interactions,
    consoleLogs: contentData.consoleLogs,
    jsErrors: contentData.jsErrors,
    networkRequests: networkRequests,
  };

  // Apply deep sanitization (Layer 4)
  const redactions = {};
  const sanitizedReport = Sanitizer.sanitizeDeep(rawReport, redactions);

  // Add sanitization summary
  sanitizedReport.sanitizationSummary = Sanitizer.buildSummary(redactions);

  // Add capture limitations
  sanitizedReport.captureLimitations = CAPTURE_LIMITATIONS;

  // Final validation (Layer 5)
  const validation = Sanitizer.validateFinalReport(sanitizedReport);
  if (!validation.passed) {
    // If validation finds issues, do another sanitization pass
    const reSanitized = Sanitizer.sanitizeDeep(sanitizedReport, redactions);
    reSanitized.sanitizationSummary = Sanitizer.buildSummary(redactions);
    reSanitized.sanitizationSummary.validationIssues = validation.issues;
    reSanitized.captureLimitations = CAPTURE_LIMITATIONS;
    return reSanitized;
  }

  return sanitizedReport;
}

async function downloadReport(tabId) {
  const report = await assembleReport(tabId);
  const jsonStr = JSON.stringify(report, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });

  // Convert blob to data URL for download
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onloadend = () => {
      const dataUrl = reader.result;
      const filename = `bug_report_${Date.now()}.json`;

      chrome.downloads.download(
        {
          url: dataUrl,
          filename: filename,
          saveAs: false,
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError.message);
          } else {
            resolve({ downloadId, filename });
          }
        }
      );
    };
    reader.readAsDataURL(blob);
  });
}

// ═══════════════════════════════════════════════════════════════════
//  MESSAGE HANDLING
// ═══════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_REPORT_PREVIEW') {
    const tabId = message.tabId;

    chrome.tabs.sendMessage(tabId, { type: 'GET_PREVIEW_COUNTS' }, (counts) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }

      const tabBuffer = networkBuffers.get(tabId);
      const networkCount = tabBuffer ? tabBuffer.entries.length : 0;

      sendResponse({
        url: counts.url,
        interactionCount: counts.interactionCount,
        consoleLogCount: counts.consoleLogCount,
        jsErrorCount: counts.jsErrorCount,
        networkRequestCount: networkCount,
      });
    });

    return true; // async response
  }

  if (message.type === 'DOWNLOAD_REPORT') {
    const tabId = message.tabId;

    downloadReport(tabId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));

    return true; // async response
  }
});
