/**
 * background.js — Service Worker for Bug Report Extension (v2.0.0)
 *
 * Responsibilities:
 *  - Capture network request metadata via webRequest API (per-tab, max 200)
 *  - Orchestrate Ist/Soll user prompts via content script
 *  - Assemble report from content script data + network data
 *  - Apply final sanitization via sanitizer.js
 *  - Generate HTML dashboard via report-template.js
 *  - Trigger HTML file download
 */

importScripts('sanitizer.js', 'report-template.js');

const EXTENSION_VERSION = '2.0.0';

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
  'Visual capture renders a simplified DOM geometry, not a pixel-perfect screenshot.',
];

/**
 * Prompt the user for Ist/Soll descriptions via the content script.
 * Returns { cancelled, actual, expected } or throws on error.
 */
async function promptIstSoll(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'PROMPT_IST_SOLL' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function assembleReport(tabId, userDescription) {
  // Get data from content script (including screenshot)
  const contentData = await chrome.tabs.sendMessage(tabId, {
    type: 'GET_BUG_REPORT_DATA',
  });

  // Get network data for this tab
  const tabBuffer = networkBuffers.get(tabId);
  const networkRequests = tabBuffer ? [...tabBuffer.entries] : [];

  // Build the raw report
  const rawReport = {
    schemaVersion: '2.0.0',
    reportTimestamp: new Date().toISOString(),
    extensionVersion: EXTENSION_VERSION,
    pageMetadata: contentData.pageMetadata,
    userDescription: userDescription,
    screenshotBase64: contentData.screenshotBase64,
    interactions: contentData.interactions,
    consoleLogs: contentData.consoleLogs,
    jsErrors: contentData.jsErrors,
    networkRequests: networkRequests,
  };

  // Apply deep sanitization (Layer 4)
  // Note: screenshotBase64 is a data URL, not user text — exclude from text sanitization
  const screenshotBackup = rawReport.screenshotBase64;
  rawReport.screenshotBase64 = '__SCREENSHOT_PLACEHOLDER__';

  const redactions = {};
  const sanitizedReport = Sanitizer.sanitizeDeep(rawReport, redactions);

  // Restore screenshot
  sanitizedReport.screenshotBase64 = screenshotBackup;

  // Add sanitization summary
  sanitizedReport.sanitizationSummary = Sanitizer.buildSummary(redactions);

  // Add capture limitations
  sanitizedReport.captureLimitations = CAPTURE_LIMITATIONS;

  // Final validation (Layer 5)
  // Temporarily remove screenshot for validation (it's binary data, not user text)
  const reportForValidation = { ...sanitizedReport, screenshotBase64: undefined };
  const validation = Sanitizer.validateFinalReport(reportForValidation);
  if (!validation.passed) {
    // If validation finds issues, do another sanitization pass
    const reRaw = { ...sanitizedReport, screenshotBase64: '__SCREENSHOT_PLACEHOLDER__' };
    const reSanitized = Sanitizer.sanitizeDeep(reRaw, redactions);
    reSanitized.screenshotBase64 = screenshotBackup;
    reSanitized.sanitizationSummary = Sanitizer.buildSummary(redactions);
    reSanitized.sanitizationSummary.validationIssues = validation.issues;
    reSanitized.captureLimitations = CAPTURE_LIMITATIONS;
    return reSanitized;
  }

  return sanitizedReport;
}

async function downloadReport(tabId) {
  // Step 1: Prompt user for Ist/Soll descriptions
  const userInput = await promptIstSoll(tabId);

  // Check if user cancelled the prompt flow
  if (userInput.cancelled) {
    return { cancelled: true };
  }

  const userDescription = {
    actual: userInput.actual || 'Keine Angabe',
    expected: userInput.expected || 'Keine Angabe',
  };

  // Step 2: Assemble the report with sanitization
  const report = await assembleReport(tabId, userDescription);

  // Step 3: Build HTML dashboard
  const htmlStr = ReportTemplate.build(report);
  const blob = new Blob([htmlStr], { type: 'text/html' });

  // Convert blob to data URL for download
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onloadend = () => {
      const dataUrl = reader.result;
      const filename = `bug_report_${Date.now()}.html`;

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
      .then((result) => {
        if (result.cancelled) {
          sendResponse({ success: false, cancelled: true });
        } else {
          sendResponse({ success: true, ...result });
        }
      })
      .catch((error) => sendResponse({ success: false, error: String(error) }));

    return true; // async response
  }
});
