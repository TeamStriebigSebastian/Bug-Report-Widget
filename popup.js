/**
 * popup.js — Popup controller for Bug Report Extension
 *
 * Manages:
 *  - Loading preview counts from background/content script
 *  - Showing summary before download
 *  - Triggering download or cancel
 */

// ── DOM References ───────────────────────────────────────────────

const stateLoading = document.getElementById('stateLoading');
const statePreview = document.getElementById('statePreview');
const stateSuccess = document.getElementById('stateSuccess');
const stateError = document.getElementById('stateError');

const previewUrl = document.getElementById('previewUrl');
const statInteractions = document.getElementById('statInteractions');
const statConsoleLogs = document.getElementById('statConsoleLogs');
const statErrors = document.getElementById('statErrors');
const statNetwork = document.getElementById('statNetwork');
const errorMessage = document.getElementById('errorMessage');

const btnDownload = document.getElementById('btnDownload');
const btnCancel = document.getElementById('btnCancel');
const btnRetry = document.getElementById('btnRetry');

// ── State Management ─────────────────────────────────────────────

function showState(stateEl) {
  [stateLoading, statePreview, stateSuccess, stateError].forEach((el) => {
    el.classList.add('hidden');
  });
  stateEl.classList.remove('hidden');
}

// ── Get Active Tab ───────────────────────────────────────────────

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// ── Load Preview ─────────────────────────────────────────────────

async function loadPreview() {
  showState(stateLoading);

  try {
    const tabId = await getActiveTabId();
    if (!tabId) throw new Error('No active tab found.');

    const preview = await chrome.runtime.sendMessage({
      type: 'GET_REPORT_PREVIEW',
      tabId,
    });

    if (preview.error) throw new Error(preview.error);

    // Populate UI
    const truncatedUrl =
      preview.url.length > 60 ? preview.url.substring(0, 57) + '…' : preview.url;
    previewUrl.textContent = truncatedUrl;
    previewUrl.title = preview.url;

    statInteractions.textContent = preview.interactionCount || 0;
    statConsoleLogs.textContent = preview.consoleLogCount || 0;
    statErrors.textContent = preview.jsErrorCount || 0;
    statNetwork.textContent = preview.networkRequestCount || 0;

    showState(statePreview);
  } catch (err) {
    errorMessage.textContent = err.message || 'Could not load page data.';
    showState(stateError);
  }
}

// ── Download Report ──────────────────────────────────────────────

async function triggerDownload() {
  btnDownload.disabled = true;
  btnDownload.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Generating…';

  try {
    const tabId = await getActiveTabId();
    if (!tabId) throw new Error('No active tab found.');

    const result = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_REPORT',
      tabId,
    });

    if (result.cancelled) {
      // User cancelled the Ist/Soll prompt — reset button and stay on preview
      btnDownload.disabled = false;
      btnDownload.innerHTML = '<span class="btn-icon">📥</span> Download Report';
      return;
    }

    if (!result.success) throw new Error(result.error || 'Download failed.');

    showState(stateSuccess);

    // Auto-close after 2.5 seconds
    setTimeout(() => window.close(), 2500);
  } catch (err) {
    errorMessage.textContent = err.message || 'Failed to generate report.';
    showState(stateError);
  }
}

// ── Event Listeners ──────────────────────────────────────────────

btnDownload.addEventListener('click', triggerDownload);

btnCancel.addEventListener('click', () => {
  window.close();
});

btnRetry.addEventListener('click', () => {
  loadPreview();
});

// ── Init ─────────────────────────────────────────────────────────

loadPreview();
