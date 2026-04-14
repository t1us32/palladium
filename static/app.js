'use strict';

const $ = id => document.getElementById(id);

// ── Elements ──────────────────────────────────────────────────────────────────
const urlInput      = $('urlInput');
const fetchBtn      = $('fetchBtn');
const errorMsg      = $('errorMsg');
const previewCard   = $('previewCard');
const progressCard  = $('progressCard');
const progressLabel = $('progressLabel');
const doneCard      = $('doneCard');
const downloadBtn   = $('downloadBtn');
const downloadLink  = $('downloadLink');
const openFolderBtn = $('openFolderBtn');
const resetBtn      = $('resetBtn');
const formatToggle  = $('formatToggle');
const settingsBtn   = $('settingsBtn');
const settingsMenu  = $('settingsMenu');
const qualityBtn    = $('qualityBtn');
const qualityMenu   = $('qualityMenu');
const qualityLabel  = $('qualityLabel');
const qualityOptions= $('qualityOptions');
const themeBtn       = $('themeBtn');
const historyBtn     = $('historyBtn');
const historyMenu    = $('historyMenu');
const historyList    = $('historyList');
const historyEmpty   = $('historyEmpty');
const filenameInput  = $('filenameInput');
const recentSection  = $('recentSection');
const recentList     = $('recentList');

// ── State ─────────────────────────────────────────────────────────────────────
const IS_ELECTRON = typeof window.electronAPI !== 'undefined';
let selectedFormat   = 'video';
let selectedQuality  = 'best';
let lastSavedFolder  = null;
let videoTitle       = '';
let currentPlatform  = null;

// Quality presets per format
const QUALITY_PRESETS = {
  video: [
    { label: 'Best available', value: 'best' },
    { label: '4K (2160p)',     value: '2160' },
    { label: '1080p',          value: '1080' },
    { label: '720p',           value: '720'  },
    { label: '480p',           value: '480'  },
    { label: '360p',           value: '360'  },
  ],
  audio: [
    { label: 'Best available', value: 'best' },
    { label: '320 kbps',       value: '320K' },
    { label: '192 kbps',       value: '192K' },
    { label: '128 kbps',       value: '128K' },
  ],
};

// ── Utilities ─────────────────────────────────────────────────────────────────
const show = (...els) => els.forEach(e => e.classList.remove('hidden'));
const hide = (...els) => els.forEach(e => e.classList.add('hidden'));

function showError(msg) { errorMsg.textContent = msg; show(errorMsg); }
function clearError()   { errorMsg.textContent = ''; hide(errorMsg); }

function fmtCount(n) {
  if (!n) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1)     + 'K';
  return String(n);
}

function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${m}:${String(s).padStart(2,'0')}`;
}

function closeAllModals() {
  settingsMenu.classList.add('hidden');
  qualityMenu.classList.add('hidden');
  historyMenu.classList.add('hidden');
}

// Close modals when clicking the backdrop (overlay itself, not the panel)
settingsMenu.addEventListener('click', e => {
  if (e.target === settingsMenu) settingsMenu.classList.add('hidden');
});
qualityMenu.addEventListener('click', e => {
  if (e.target === qualityMenu) qualityMenu.classList.add('hidden');
});

// Close modal buttons
document.getElementById('settingsCloseBtn').addEventListener('click', () =>
  settingsMenu.classList.add('hidden'));
document.getElementById('qualityCloseBtn').addEventListener('click', () =>
  qualityMenu.classList.add('hidden'));

// History modal
historyMenu.addEventListener('click', e => {
  if (e.target === historyMenu) historyMenu.classList.add('hidden');
});
document.getElementById('historyCloseBtn').addEventListener('click', () =>
  historyMenu.classList.add('hidden'));
document.getElementById('clearHistoryBtn').addEventListener('click', async () => {
  if (IS_ELECTRON) await window.electronAPI.clearHistory();
  else localStorage.removeItem('palladium-history');
  renderHistory([]);
  renderRecent([]);
});

// ── Settings ──────────────────────────────────────────────────────────────────
let appSettings = { saveLocation: 'downloads' };

async function loadSettings() {
  if (IS_ELECTRON) {
    appSettings = await window.electronAPI.getSettings();
  } else {
    try { appSettings = { ...appSettings, ...JSON.parse(localStorage.getItem('palladium-settings') || '{}') }; }
    catch {}
  }
  // Sync radio buttons to loaded state
  document.querySelectorAll('input[name="saveLocation"]').forEach(r => {
    r.checked = r.value === appSettings.saveLocation;
  });
}

async function saveSetting(key, value) {
  appSettings[key] = value;
  if (IS_ELECTRON) {
    await window.electronAPI.setSettings(appSettings);
  } else {
    localStorage.setItem('palladium-settings', JSON.stringify(appSettings));
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    $('downloadTab').classList.toggle('hidden', tab !== 'download');
    $('editTab').classList.toggle('hidden', tab !== 'edit');
  });
});

// ── Theme ─────────────────────────────────────────────────────────────────────
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  $('themeMoon').classList.toggle('hidden', isDark);
  $('themeSun').classList.toggle('hidden', !isDark);
}

// Apply system theme immediately to avoid flash
applyTheme(getSystemTheme());

// Follow system changes when user hasn't set a preference
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  if (!appSettings.theme) applyTheme(e.matches ? 'dark' : 'light');
});

themeBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || getSystemTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  saveSetting('theme', next);
});

loadSettings().then(() => {
  if (appSettings.theme) applyTheme(appSettings.theme);
});

refreshRecent();

// Settings button toggle
settingsBtn.addEventListener('click', () => {
  qualityMenu.classList.add('hidden');
  historyMenu.classList.add('hidden');
  settingsMenu.classList.toggle('hidden');
});

// Radio changes
document.querySelectorAll('input[name="saveLocation"]').forEach(r => {
  r.addEventListener('change', () => saveSetting('saveLocation', r.value));
});

// In web mode, hide the "ask each time" option (no native dialog available)
if (!IS_ELECTRON) {
  const askRow = document.querySelector('input[value="ask"]')?.closest('.radio-row');
  if (askRow) askRow.style.display = 'none';
}

// ── Format toggle ─────────────────────────────────────────────────────────────
formatToggle.addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  formatToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedFormat = btn.dataset.fmt;
  selectedQuality = 'best';
  renderQualityOptions();
  qualityLabel.textContent = 'Best';
  $('qualityMenuHeading').textContent = selectedFormat === 'audio' ? 'Audio quality' : 'Video quality';
});

function setFormat(fmt) {
  formatToggle.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.fmt === fmt)
  );
  selectedFormat = fmt;
  selectedQuality = 'best';
  qualityLabel.textContent = 'Best';
}

// ── Quality picker ────────────────────────────────────────────────────────────
function renderQualityOptions() {
  const presets = QUALITY_PRESETS[selectedFormat] || QUALITY_PRESETS.video;
  qualityOptions.innerHTML = presets.map(p => `
    <button class="quality-option ${p.value === selectedQuality ? 'selected' : ''}"
      data-value="${p.value}">
      ${p.label}
      <svg class="q-check" width="13" height="13" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </button>
  `).join('');
}

qualityBtn.addEventListener('click', () => {
  settingsMenu.classList.add('hidden');
  renderQualityOptions();
  qualityMenu.classList.toggle('hidden');
});

qualityOptions.addEventListener('click', e => {
  const opt = e.target.closest('.quality-option');
  if (!opt) return;
  selectedQuality = opt.dataset.value;
  qualityLabel.textContent = opt.textContent.trim().replace(/\s+/g, ' ').split(' ')[0] === 'Best'
    ? 'Best' : opt.textContent.trim().replace(/\s{2,}/g, ' ').split(/\s{2}/)[0].trim();
  // Simpler: just grab the label text before the SVG
  qualityLabel.textContent = QUALITY_PRESETS[selectedFormat]
    .find(p => p.value === selectedQuality)?.label.split(' ')[0] || 'Best';
  qualityMenu.classList.add('hidden');
  renderQualityOptions();
});

// Initial render
renderQualityOptions();

// ── History ───────────────────────────────────────────────────────────────────
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function renderHistory(items) {
  if (!items || items.length === 0) {
    historyList.innerHTML = '';
    show(historyEmpty);
    return;
  }
  hide(historyEmpty);
  historyList.innerHTML = items.map((item, i) => `
    <div class="history-item" data-index="${i}">
      <div class="history-item-meta">
        <span class="history-item-title">${item.title || 'Untitled'}</span>
        <span class="history-item-sub">
          ${item.platform ? `<span class="history-item-platform">${item.platform}</span> ·` : ''}
          <span>${item.format || 'video'}</span> ·
          <span>${timeAgo(item.savedAt)}</span>
        </span>
      </div>
      ${item.folderPath ? `
        <button class="history-open-btn" data-folder="${item.folderPath}" title="Open folder">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </button>` : ''}
    </div>
  `).join('');

  historyList.querySelectorAll('.history-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (IS_ELECTRON) window.electronAPI.openFolder(btn.dataset.folder);
    });
  });
}

async function loadHistory() {
  if (IS_ELECTRON) return window.electronAPI.getHistory();
  try { return JSON.parse(localStorage.getItem('palladium-history') || '[]'); }
  catch { return []; }
}

async function addHistoryEntry(entry) {
  if (IS_ELECTRON) return window.electronAPI.addHistory(entry);
  const list = await loadHistory();
  const updated = [entry, ...list].slice(0, 30);
  localStorage.setItem('palladium-history', JSON.stringify(updated));
  return updated;
}

historyBtn.addEventListener('click', async () => {
  settingsMenu.classList.add('hidden');
  qualityMenu.classList.add('hidden');
  const items = await loadHistory();
  renderHistory(items);
  historyMenu.classList.toggle('hidden');
});

// ── Recent (inline idle-state history) ───────────────────────────────────────
const VIDEO_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
const AUDIO_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const FOLDER_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

function renderRecent(items) {
  const top = (items || []).slice(0, 5);
  if (top.length === 0) { hide(recentSection); return; }
  recentList.innerHTML = top.map((item, i) => `
    <div class="recent-item">
      <div class="recent-item-icon">${item.format === 'audio' ? AUDIO_ICON : VIDEO_ICON}</div>
      <div class="recent-item-meta">
        <span class="recent-item-title">${item.title || 'Untitled'}</span>
        <span class="recent-item-sub">${[item.platform, timeAgo(item.savedAt)].filter(Boolean).join(' · ')}</span>
      </div>
      ${item.folderPath ? `<button class="recent-open-btn" data-folder="${item.folderPath}" title="Open folder">${FOLDER_ICON}</button>` : ''}
    </div>
  `).join('');
  recentList.querySelectorAll('.recent-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (IS_ELECTRON) window.electronAPI.openFolder(btn.dataset.folder);
    });
  });
  show(recentSection);
}

async function refreshRecent() {
  const items = await loadHistory();
  renderRecent(items);
}

// ── Clipboard auto-detect ─────────────────────────────────────────────────────
const PLATFORM_RE = [
  /youtube\.com\/watch/i,  /youtu\.be\//i,
  /spotify\.com\/(track|album|playlist)/i,
  /soundcloud\.com\//i,    /tiktok\.com\//i,
  /instagram\.com\/(p|reel|tv)\//i,
  /(twitter|x)\.com\/.+\/status\//i,
  /vimeo\.com\/\d/i,       /twitch\.tv\//i,
  /reddit\.com\/r\/.+\/comments\//i,
];

function looksLikeMedia(text) {
  try {
    const u = new URL(text.trim());
    return PLATFORM_RE.some(r => r.test(u.href));
  } catch { return false; }
}

async function checkClipboard() {
  if (urlInput.value.trim()) return; // don't overwrite existing input
  try {
    const text = IS_ELECTRON
      ? await window.electronAPI.readClipboard()
      : await navigator.clipboard.readText();
    if (text && looksLikeMedia(text)) {
      urlInput.value = text.trim();
    }
  } catch {}
}

window.addEventListener('focus', checkClipboard);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkClipboard();
});

// ── Drag & drop ───────────────────────────────────────────────────────────────
const appEl = document.querySelector('.app');

appEl.addEventListener('dragover', e => {
  e.preventDefault();
  appEl.classList.add('drag-over');
});
appEl.addEventListener('dragleave', e => {
  if (!appEl.contains(e.relatedTarget)) appEl.classList.remove('drag-over');
});
appEl.addEventListener('drop', e => {
  e.preventDefault();
  appEl.classList.remove('drag-over');
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (text) {
    urlInput.value = text.trim().split('\n')[0];
    fetchInfo();
  }
});

// ── Fetch info ────────────────────────────────────────────────────────────────
fetchBtn.addEventListener('click', fetchInfo);
urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchInfo(); });

async function fetchInfo() {
  const url = urlInput.value.trim();
  if (!url) { showError('Paste a URL to get started.'); return; }

  clearError();
  fetchBtn.disabled = true;
  fetchBtn.textContent = 'Fetching…';
  hide(previewCard, progressCard, doneCard, recentSection);

  try {
    const res  = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) { showError(data.error || 'Could not fetch info.'); return; }

    videoTitle      = data.title || 'download';
    currentPlatform = data.platform ? data.platform.label : null;

    // Filename input — pre-fill with sanitized title
    filenameInput.value = videoTitle.replace(/[^\w\s.\-()]/g, '').trim();
    show(filenameInput);

    // Platform-specific format handling
    if (data.platform) {
      const audioOnly = ['spotify', 'soundcloud'].includes(data.platform.id);
      formatToggle.querySelector('[data-fmt="video"]').style.display = audioOnly ? 'none' : '';
      setFormat(data.platform.defaultFormat || 'video');
      $('qualityMenuHeading').textContent = selectedFormat === 'audio' ? 'Audio quality' : 'Video quality';
    }

    // Thumbnail
    const thumb = $('thumbnail');
    thumb.src = data.thumbnail || '';
    thumb.style.display = data.thumbnail ? '' : 'none';

    // Duration
    const durText = fmtDuration(data.duration);
    if (durText) { $('duration').textContent = durText; show($('duration')); }
    else          { hide($('duration')); }

    // Title & uploader
    $('videoTitle').textContent = data.title || 'Untitled';
    const up = $('uploaderName');
    if (data.uploader) { up.textContent = `@${data.uploader}`; show(up); }
    else { hide(up); }

    show(previewCard);
  } catch {
    showError('Network error — is the server running?');
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Fetch';
  }
}

// ── Download ──────────────────────────────────────────────────────────────────
downloadBtn.addEventListener('click', startDownload);

async function startDownload() {
  const url = urlInput.value.trim();
  if (!url) return;

  closeAllModals();
  hide(previewCard, recentSection);
  progressLabel.textContent = selectedFormat === 'audio' ? 'Downloading audio…' : 'Downloading video…';
  show(progressCard);

  try {
    const res  = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: selectedFormat, quality: selectedQuality }),
    });
    const data = await res.json();

    if (!res.ok) {
      hide(progressCard);
      show(previewCard);
      showError(data.error || 'Download failed.');
      return;
    }

    hide(progressCard);
    await handleSave(data);
    show(doneCard);

  } catch {
    hide(progressCard);
    show(previewCard);
    showError('Network error during download.');
  }
}

async function handleSave(data) {
  // In Electron: use native save flow
  if (IS_ELECTRON) {
    const ext  = data.filename.split('.').pop();
    const customName = filenameInput.value.trim();
    const name = `${customName || videoTitle.replace(/[^\w\s.-]/g, '').trim() || 'download'}.${ext}`;

    const result = await window.electronAPI.saveFile({
      serverPath:    data.server_path,
      suggestedName: name,
    });

    if (result.canceled) {
      // User dismissed dialog — go back to preview
      hide(doneCard);
      show(previewCard);
      return;
    }

    lastSavedFolder = result.folderPath;
    show(openFolderBtn);
    hide(downloadLink);

    const subEl = $('doneSub');
    subEl.textContent = appSettings.saveLocation === 'ask'
      ? result.filePath
      : 'Saved to Downloads.';

    await addHistoryEntry({
      title:      videoTitle,
      platform:   currentPlatform,
      format:     selectedFormat,
      savedAt:    Date.now(),
      folderPath: result.folderPath,
    });
    refreshRecent();

  } else {
    // Web: plain anchor download
    downloadLink.href     = data.download_url;
    downloadLink.download = data.filename;
    show(downloadLink);
    hide(openFolderBtn);
    $('doneSub').textContent = 'Click to save.';

    await addHistoryEntry({
      title:      videoTitle,
      platform:   currentPlatform,
      format:     selectedFormat,
      savedAt:    Date.now(),
      folderPath: null,
    });
  }
}

// ── Open folder ───────────────────────────────────────────────────────────────
openFolderBtn.addEventListener('click', () => {
  if (IS_ELECTRON && lastSavedFolder) window.electronAPI.openFolder(lastSavedFolder);
});

// ── Edit tab ──────────────────────────────────────────────────────────────────
let editFile       = null;
let editDuration   = 0;
let editObjectURL  = null;

const editDropZone    = $('editDropZone');
const editPickBtn     = $('editPickBtn');
const editFileInput   = $('editFileInput');
const editPanel       = $('editPanel');
const editMediaEl     = $('editMediaEl');
const editDoneCard    = $('editDoneCard');
const trimStartRange  = $('trimStartRange');
const trimEndRange    = $('trimEndRange');
const trimFill        = $('trimFill');
const trimStartInput  = $('trimStartInput');
const trimEndInput    = $('trimEndInput');
const editTrimBtn     = $('editTrimBtn');
const editErrorMsg    = $('editErrorMsg');

function parseSecs(str) {
  const parts = String(str).trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60  + parts[1];
  return parts[0] || 0;
}

function fmtSecs(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function updateTrimFill() {
  const start = parseFloat(trimStartRange.value);
  const end   = parseFloat(trimEndRange.value);
  const max   = parseFloat(trimStartRange.max) || 1;
  trimFill.style.left  = `${(start / max) * 100}%`;
  trimFill.style.width = `${((end - start) / max) * 100}%`;
}

function loadEditFile(file) {
  editFile = file;
  if (editObjectURL) URL.revokeObjectURL(editObjectURL);
  editObjectURL = URL.createObjectURL(file);
  editMediaEl.src = editObjectURL;
  editMediaEl.addEventListener('loadedmetadata', () => {
    editDuration = Math.floor(editMediaEl.duration);
    $('editFileName').textContent     = file.name;
    $('editFileDuration').textContent = fmtSecs(editDuration);

    // icon: video vs audio
    const isAudio = file.type.startsWith('audio');
    $('editFileIcon').innerHTML = isAudio ? AUDIO_ICON : VIDEO_ICON;

    trimStartRange.max   = editDuration;
    trimEndRange.max     = editDuration;
    trimStartRange.value = 0;
    trimEndRange.value   = editDuration;
    trimStartInput.value = '0:00';
    trimEndInput.value   = fmtSecs(editDuration);
    updateTrimFill();

    hide(editDropZone, editDoneCard, editErrorMsg);
    show(editPanel);
  }, { once: true });
}

// Drag & drop on edit drop zone
editDropZone.addEventListener('dragover', e => { e.preventDefault(); editDropZone.classList.add('drag-active'); });
editDropZone.addEventListener('dragleave', e => { if (!editDropZone.contains(e.relatedTarget)) editDropZone.classList.remove('drag-active'); });
editDropZone.addEventListener('drop', e => {
  e.preventDefault();
  editDropZone.classList.remove('drag-active');
  const f = e.dataTransfer.files[0];
  if (f) loadEditFile(f);
});
editDropZone.addEventListener('click', e => {
  if (e.target !== editPickBtn) editFileInput.click();
});
editPickBtn.addEventListener('click', e => { e.stopPropagation(); editFileInput.click(); });
editFileInput.addEventListener('change', () => {
  if (editFileInput.files[0]) loadEditFile(editFileInput.files[0]);
});

// Sliders → text inputs + fill
trimStartRange.addEventListener('input', () => {
  if (parseFloat(trimStartRange.value) >= parseFloat(trimEndRange.value))
    trimStartRange.value = parseFloat(trimEndRange.value) - 1;
  trimStartInput.value = fmtSecs(trimStartRange.value);
  updateTrimFill();
});
trimEndRange.addEventListener('input', () => {
  if (parseFloat(trimEndRange.value) <= parseFloat(trimStartRange.value))
    trimEndRange.value = parseFloat(trimStartRange.value) + 1;
  trimEndInput.value = fmtSecs(trimEndRange.value);
  updateTrimFill();
});

// Text inputs → sliders + fill
trimStartInput.addEventListener('change', () => {
  const v = Math.min(parseSecs(trimStartInput.value), editDuration - 1);
  trimStartInput.value = fmtSecs(v);
  trimStartRange.value = v;
  if (v >= parseFloat(trimEndRange.value)) { trimEndRange.value = v + 1; trimEndInput.value = fmtSecs(v + 1); }
  updateTrimFill();
});
trimEndInput.addEventListener('change', () => {
  const v = Math.min(Math.max(parseSecs(trimEndInput.value), 1), editDuration);
  trimEndInput.value = fmtSecs(v);
  trimEndRange.value = v;
  if (v <= parseFloat(trimStartRange.value)) { trimStartRange.value = v - 1; trimStartInput.value = fmtSecs(v - 1); }
  updateTrimFill();
});

// Clear file
$('editClearBtn').addEventListener('click', () => {
  editFile = null;
  hide(editPanel, editDoneCard);
  show(editDropZone);
  editFileInput.value = '';
});

// Trim
editTrimBtn.addEventListener('click', async () => {
  if (!editFile) return;
  editErrorMsg.classList.add('hidden');
  editTrimBtn.disabled = true;
  editTrimBtn.textContent = 'Trimming…';

  const start = parseSecs(trimStartInput.value);
  const end   = parseSecs(trimEndInput.value);

  const fd = new FormData();
  fd.append('file', editFile);
  fd.append('start', String(start));
  fd.append('end',   String(end));

  try {
    const res  = await fetch('/api/trim', { method: 'POST', body: fd });
    const data = await res.json();

    if (!res.ok) { editErrorMsg.textContent = data.error || 'Trim failed.'; show(editErrorMsg); return; }

    if (IS_ELECTRON) {
      const ext    = editFile.name.split('.').pop();
      const name   = editFile.name.replace(/\.[^.]+$/, '') + `_trim_${fmtSecs(start).replace(/:/g,'-')}-${fmtSecs(end).replace(/:/g,'-')}.${ext}`;
      const result = await window.electronAPI.saveFile({ serverPath: data.server_path, suggestedName: name });
      if (result.canceled) return;
      $('editOpenFolderBtn').classList.remove('hidden');
      $('editOpenFolderBtn').onclick = () => window.electronAPI.openFolder(result.folderPath);
      $('editDownloadLink').classList.add('hidden');
      $('editDoneSub').textContent = 'Saved to ' + result.filePath;
    } else {
      $('editDownloadLink').href     = data.download_url;
      $('editDownloadLink').download = data.filename;
      $('editDownloadLink').classList.remove('hidden');
      $('editOpenFolderBtn').classList.add('hidden');
      $('editDoneSub').textContent = 'Click to save.';
    }

    hide(editPanel);
    show(editDoneCard);
  } catch {
    editErrorMsg.textContent = 'Network error.';
    show(editErrorMsg);
  } finally {
    editTrimBtn.disabled = false;
    editTrimBtn.textContent = 'Trim';
  }
});

$('editResetBtn').addEventListener('click', () => {
  editFile = null;
  if (editObjectURL) { URL.revokeObjectURL(editObjectURL); editObjectURL = null; }
  editFileInput.value = '';
  hide(editDoneCard, editPanel, editErrorMsg);
  show(editDropZone);
});

// ── Reset ─────────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  urlInput.value = '';
  lastSavedFolder = null;
  videoTitle = '';
  filenameInput.value = '';
  clearError();
  hide(previewCard, progressCard, doneCard, openFolderBtn, filenameInput);
  show(downloadLink); // restore for web mode
  refreshRecent();
  urlInput.focus();
});
