'use strict';

const $ = id => document.getElementById(id);

// ── Elements ──────────────────────────────────────────────────────────────────
const urlInput = $('urlInput');
const fetchBtn = $('fetchBtn');
const errorMsg = $('errorMsg');
const previewCard = $('previewCard');
const progressCard  = $('progressCard');
const progressLabel = $('progressLabel');
const progressPct   = $('progressPct');
const progressFill  = $('progressFill');
const progressMeta  = $('progressMeta');
const queueSection  = $('queueSection');
const queueList     = $('queueList');
const doneCard      = $('doneCard');
const downloadBtn = $('downloadBtn');
const downloadLink = $('downloadLink');
const openFolderBtn = $('openFolderBtn');
const resetBtn = $('resetBtn');
const formatToggle = $('formatToggle');
const settingsBtn = $('settingsBtn');
const settingsMenu = $('settingsMenu');
const qualityBtn = $('qualityBtn');
const qualityMenu = $('qualityMenu');
const qualityLabel = $('qualityLabel');
const qualityOptions = $('qualityOptions');
const themeBtn = $('themeBtn');
const historyBtn = $('historyBtn');
const historyMenu = $('historyMenu');
const historyList = $('historyList');
const historyEmpty = $('historyEmpty');
const filenameInput = $('filenameInput');
const recentSection = $('recentSection');
const recentList = $('recentList');

// ── State ─────────────────────────────────────────────────────────────────────
const IS_ELECTRON = typeof window.electronAPI !== 'undefined';
let selectedFormat = 'video';
let selectedQuality = 'best';
let lastSavedFolder = null;
let videoTitle = '';
let currentPlatform = null;

// Quality presets per format
const QUALITY_PRESETS = {
  video: [
    { label: 'Best available', value: 'best' },
    { label: '4K (2160p)', value: '2160' },
    { label: '1080p', value: '1080' },
    { label: '720p', value: '720' },
    { label: '480p', value: '480' },
    { label: '360p', value: '360' },
  ],
  audio: [
    { label: 'Best available', value: 'best' },
    { label: '320 kbps', value: '320K' },
    { label: '192 kbps', value: '192K' },
    { label: '128 kbps', value: '128K' },
  ],
};

// ── Utilities ─────────────────────────────────────────────────────────────────
const show = (...els) => els.forEach(e => e.classList.remove('hidden'));
const hide = (...els) => els.forEach(e => e.classList.add('hidden'));

function showError(msg) { errorMsg.textContent = msg; show(errorMsg); }
function clearError() { errorMsg.textContent = ''; hide(errorMsg); }

function fmtCount(n) {
  if (!n) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
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
    catch { }
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
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
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
const IMAGE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
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
  /youtube\.com\/watch/i, /youtu\.be\//i,
  /spotify\.com\/(track|album|playlist)/i,
  /soundcloud\.com\//i, /tiktok\.com\//i,
  /instagram\.com\/(p|reel|tv)\//i,
  /(twitter|x)\.com\/.+\/status\//i,
  /vimeo\.com\/\d/i, /twitch\.tv\//i,
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
  } catch { }
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

// ── Playlist ──────────────────────────────────────────────────────────────────
const PLAYLIST_RE = [
  /[?&]list=[A-Za-z0-9_-]+/,          // YouTube ?list=
  /youtube\.com\/(playlist|watch\?.*list=)/i,
  /soundcloud\.com\/[^/]+\/sets\//i,
  /spotify\.com\/(album|playlist)\//i,
];

function looksLikePlaylist(url) {
  try { return PLAYLIST_RE.some(r => r.test(url)); } catch { return false; }
}

let playlistEntries = [];

async function downloadPlaylist(url) {
  closeAllModals();
  const banner = $('playlistBanner');
  // Show loading state in banner
  $('playlistCount').textContent = 'Loading…';

  try {
    const res  = await fetch('/api/playlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok || data.error) { showError(data.error || 'Could not load playlist.'); return; }

    playlistEntries = data.entries || [];
    playlistEntries.forEach(e => addToQueue({
      url:      e.url,
      title:    e.title,
      thumbnail: e.thumbnail,
      platform: currentPlatform,
      format:   selectedFormat,
      quality:  selectedQuality,
    }));

    // Reset
    urlInput.value = ''; videoTitle = '';
    $('playlistToggle').checked = false;
    hide(previewCard, banner);
    clearError();
    refreshRecent();
  } catch {
    showError('Network error loading playlist.');
  }
}

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
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) { showError(data.error || 'Could not fetch info.'); return; }

    videoTitle = data.title || 'download';
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
    else { hide($('duration')); }

    // Title & uploader
    $('videoTitle').textContent = data.title || 'Untitled';
    const up = $('uploaderName');
    if (data.uploader) { up.textContent = `@${data.uploader}`; show(up); }
    else { hide(up); }

    // Playlist detection
    const playlistBanner = $('playlistBanner');
    const playlistToggle = $('playlistToggle');
    if (looksLikePlaylist(url)) {
      // Peek at playlist count in background (non-blocking)
      $('playlistCount').textContent = '';
      playlistBanner.classList.remove('hidden');
      playlistToggle.checked = false;
      fetch('/api/playlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }).then(r => r.json()).then(d => {
        if (d.count > 1) $('playlistCount').textContent = `· ${d.count} videos`;
      }).catch(() => {});
    } else {
      playlistBanner.classList.add('hidden');
      playlistToggle.checked = false;
    }

    show(previewCard);
  } catch {
    showError('Network error — is the server running?');
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Fetch';
  }
}

// ── Queue ─────────────────────────────────────────────────────────────────────
// Each item: { qid, url, title, thumbnail, platform, format, quality, status,
//              progress?, result?, error? }
const dlQueue = [];
let queueBusy = false;

function genQid() { return Math.random().toString(36).slice(2, 10); }

function sanitizeName(t) { return (t || 'download').replace(/[^\w\s.\-()]/g, '').trim() || 'download'; }

function addToQueue(item) {
  dlQueue.push({ ...item, qid: genQid(), status: 'waiting' });
  renderQueue();
  drainQueue();
}

async function drainQueue() {
  if (queueBusy) return;
  const item = dlQueue.find(i => i.status === 'waiting');
  if (!item) return;

  queueBusy    = true;
  item.status  = 'downloading';
  item.progress = null;
  renderQueue();

  try {
    const res  = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: item.url, format: item.format, quality: item.quality }),
    });
    const body = await res.json();

    if (!res.ok || body.error) {
      item.status = 'error'; item.error = body.error || 'Download failed.';
      renderQueue(); queueBusy = false; drainQueue(); return;
    }

    await streamJob(body.jobId, item);

  } catch {
    item.status = 'error'; item.error = 'Network error.';
    renderQueue();
  }
  queueBusy = false;
  renderQueue();
  drainQueue();
}

function streamJob(jobId, item) {
  return new Promise(resolve => {
    const es = new EventSource(`/api/stream/${jobId}`);

    es.addEventListener('progress', e => {
      item.progress = JSON.parse(e.data);
      renderQueueItem(item);
    });

    es.addEventListener('done', async e => {
      es.close();
      const data = JSON.parse(e.data);
      // Auto-save to Downloads; don't block the queue with a per-item dialog
      if (IS_ELECTRON) {
        const ext  = data.filename.split('.').pop();
        const name = `${sanitizeName(item.title)}.${ext}`;
        try {
          const result = await window.electronAPI.saveFileAuto({ serverPath: data.server_path, suggestedName: name });
          item.result = { ...data, folderPath: result.folderPath };
        } catch {
          item.result = data;
        }
      } else {
        item.result = data;
      }
      item.status = 'done';
      await addHistoryEntry({
        title:      item.title || 'Video',
        platform:   item.platform,
        format:     item.format,
        savedAt:    Date.now(),
        folderPath: item.result?.folderPath || null,
      });
      refreshRecent();
      resolve();
    });

    es.addEventListener('fail', e => {
      es.close();
      try { item.error = JSON.parse(e.data).error; } catch { item.error = 'Download failed.'; }
      item.status = 'error';
      resolve();
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED && item.status === 'downloading') {
        item.status = 'error'; item.error = 'Connection lost.';
        resolve();
      }
    };
  });
}

function renderQueue() {
  if (dlQueue.length === 0) { hide(queueSection); return; }
  show(queueSection);
  queueList.innerHTML = dlQueue.map(renderQueueItemHTML).join('');
  // Wire up folder-open buttons
  queueList.querySelectorAll('[data-qi-folder]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (IS_ELECTRON) window.electronAPI.openFolder(btn.dataset.qiFolder);
    });
  });
}

function renderQueueItem(item) {
  const el = queueList.querySelector(`[data-qid="${item.qid}"]`);
  if (el) el.outerHTML = renderQueueItemHTML(item);
}

function renderQueueItemHTML(item) {
  const pct = item.progress ? parseFloat(item.progress.percent) : null;
  const statusHTML = {
    waiting:     `<span class="qi-badge qi-wait">Waiting</span>`,
    downloading: `<span class="qi-badge qi-dl">${pct != null ? Math.round(pct) + '%' : '…'}</span>`,
    done:        `<span class="qi-badge qi-done">✓ Done</span>`,
    error:       `<span class="qi-badge qi-err">✕ Error</span>`,
  }[item.status] || '';

  const folderBtn = item.status === 'done' && item.result?.folderPath
    ? `<button class="qi-folder" data-qi-folder="${item.result.folderPath}" title="Open folder">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </button>` : '';

  const webLink = item.status === 'done' && !IS_ELECTRON && item.result?.download_url
    ? `<a class="btn-link" href="${item.result.download_url}" download="${item.result.filename}">Save</a>` : '';

  const progressBar = item.status === 'downloading' && pct != null
    ? `<div class="qi-track"><div class="qi-fill" style="width:${pct}%"></div></div>` : '';

  return `
    <div class="queue-item" data-qid="${item.qid}">
      ${item.thumbnail
        ? `<img class="qi-thumb" src="${item.thumbnail}" alt="" />`
        : `<div class="qi-thumb qi-thumb-ph"></div>`}
      <div class="qi-body">
        <p class="qi-title">${item.title || 'Untitled'}</p>
        <p class="qi-sub">${[item.platform, item.format, item.quality !== 'best' ? item.quality : null].filter(Boolean).join(' · ')}</p>
        ${progressBar}
        ${item.status === 'error' && item.error ? `<p class="qi-err-msg">${item.error}</p>` : ''}
      </div>
      <div class="qi-right">${statusHTML}${folderBtn}${webLink}</div>
    </div>`;
}

$('clearDoneBtn').addEventListener('click', () => {
  const active = dlQueue.filter(i => i.status !== 'done');
  dlQueue.length = 0; dlQueue.push(...active);
  renderQueue();
});

// ── Download ──────────────────────────────────────────────────────────────────
downloadBtn.addEventListener('click', startDownload);
$('addToQueueBtn').addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url) return;
  addToQueue({
    url,
    title:    videoTitle,
    thumbnail: $('thumbnail').src || null,
    platform: currentPlatform,
    format:   selectedFormat,
    quality:  selectedQuality,
  });
  // Reset UI so user can add another URL right away
  urlInput.value = '';
  videoTitle = '';
  clearError();
  hide(previewCard, $('playlistBanner'));
  refreshRecent();
  urlInput.focus();
});

async function startDownload() {
  const url = urlInput.value.trim();
  if (!url) return;

  // Playlist mode: load entries and add all to queue
  if ($('playlistToggle').checked) {
    await downloadPlaylist(url);
    return;
  }

  closeAllModals();
  hide(previewCard, recentSection);

  // Start job on server
  let jobId;
  try {
    const res  = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: selectedFormat, quality: selectedQuality }),
    });
    const body = await res.json();
    if (!res.ok || body.error) {
      show(previewCard); showError(body.error || 'Download failed.'); return;
    }
    jobId = body.jobId;
  } catch {
    show(previewCard); showError('Network error.'); return;
  }

  // Show progress card with real progress via SSE
  progressLabel.textContent = selectedFormat === 'audio' ? 'Downloading audio…' : 'Downloading video…';
  progressPct.textContent   = '';
  progressFill.className    = 'fill indeterminate';
  progressFill.style.width  = '';
  hide(progressMeta);
  show(progressCard);

  await new Promise(resolve => {
    const es = new EventSource(`/api/stream/${jobId}`);

    es.addEventListener('progress', e => {
      const p   = JSON.parse(e.data);
      const pct = parseFloat(p.percent);
      if (!isNaN(pct)) {
        progressFill.className   = 'fill';
        progressFill.style.width = pct + '%';
        progressPct.textContent  = Math.round(pct) + '%';
      }
      const meta = [p.currentSpeed, p.eta ? 'ETA ' + p.eta : null].filter(Boolean).join('  ·  ');
      if (meta) { progressMeta.textContent = meta; show(progressMeta); }
    });

    es.addEventListener('done', async e => {
      es.close();
      hide(progressCard);
      await handleSave(JSON.parse(e.data));
      show(doneCard);
      resolve();
    });

    es.addEventListener('fail', e => {
      es.close();
      hide(progressCard); show(previewCard);
      let msg = 'Download failed.';
      try { msg = JSON.parse(e.data).error || msg; } catch {}
      showError(msg);
      resolve();
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        if (!doneCard.classList.contains('hidden') || !previewCard.classList.contains('hidden')) {
          resolve(); return;
        }
        hide(progressCard); show(previewCard);
        showError('Connection lost.');
        resolve();
      }
    };
  });
}

async function handleSave(data) {
  // In Electron: use native save flow
  if (IS_ELECTRON) {
    const ext = data.filename.split('.').pop();
    const customName = filenameInput.value.trim();
    const name = `${customName || videoTitle.replace(/[^\w\s.-]/g, '').trim() || 'download'}.${ext}`;

    const result = await window.electronAPI.saveFile({
      serverPath: data.server_path,
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
      title: videoTitle,
      platform: currentPlatform,
      format: selectedFormat,
      savedAt: Date.now(),
      folderPath: result.folderPath,
    });
    refreshRecent();

  } else {
    // Web: plain anchor download
    downloadLink.href = data.download_url;
    downloadLink.download = data.filename;
    show(downloadLink);
    hide(openFolderBtn);
    $('doneSub').textContent = 'Click to save.';

    await addHistoryEntry({
      title: videoTitle,
      platform: currentPlatform,
      format: selectedFormat,
      savedAt: Date.now(),
      folderPath: null,
    });
  }
}

// ── Open folder ───────────────────────────────────────────────────────────────
openFolderBtn.addEventListener('click', () => {
  if (IS_ELECTRON && lastSavedFolder) window.electronAPI.openFolder(lastSavedFolder);
});

// ── Edit tab ──────────────────────────────────────────────────────────────────
let editFile = null;
let editDuration = 0;
let editObjectURL = null;

const editDropZone = $('editDropZone');
const editPickBtn = $('editPickBtn');
const editFileInput = $('editFileInput');
const editPanel = $('editPanel');
const editMediaEl = $('editMediaEl');
const editPreviewWrap = $('editPreviewWrap');
const editPreviewPlayer = $('editPreviewPlayer');
const editPreviewOverlay = $('editPreviewOverlay');
const editPlayIcon = $('editPlayIcon');
const editPauseIcon = $('editPauseIcon');
const editDoneCard = $('editDoneCard');
const etWrap = $('etWrap');
const etRegion = $('etRegion');
const etHandleS = $('etHandleS');
const etHandleE = $('etHandleE');
const etPlayhead = $('etPlayhead');
const trimStartInput = $('trimStartInput');
const trimEndInput = $('trimEndInput');

let trimStart = 0;
let trimEnd = 1;
const editTrimBtn = $('editTrimBtn');
const editErrorMsg = $('editErrorMsg');

// ── Preview player controls ────────────────────────────────────────────────────
function setPreviewPlaying(playing) {
  editPreviewOverlay.classList.toggle('playing', playing);
  editPreviewPlayer.classList.toggle('playing', playing);
  editPlayIcon.classList.toggle('hidden', playing);
  editPauseIcon.classList.toggle('hidden', !playing);
}

function updatePreviewHead() {
  if (!editDuration) return;
  const pct = (editMediaEl.currentTime / editDuration) * 100;
  etPlayhead.style.left = pct + '%';
}

function updateTrimUI() {
  if (!editDuration) return;
  const sPct = (trimStart / editDuration) * 100;
  const ePct = (trimEnd / editDuration) * 100;

  etHandleS.style.left = sPct + '%';
  etHandleE.style.left = ePct + '%';
  etRegion.style.left = sPct + '%';
  etRegion.style.width = (ePct - sPct) + '%';
}

editPreviewPlayer.addEventListener('click', () => {
  if (editMediaEl.paused) editMediaEl.play();
  else editMediaEl.pause();
});

editMediaEl.addEventListener('play', () => setPreviewPlaying(true));
editMediaEl.addEventListener('pause', () => setPreviewPlaying(false));
editMediaEl.addEventListener('ended', () => setPreviewPlaying(false));
editMediaEl.addEventListener('timeupdate', updatePreviewHead);

function parseSecs(str) {
  const parts = String(str).trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function fmtSecs(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function loadEditFile(file) {
  editFile = file;
  if (editObjectURL) URL.revokeObjectURL(editObjectURL);
  editObjectURL = URL.createObjectURL(file);

  const isImage = file.type.startsWith('image/');
  const isAudio = file.type.startsWith('audio/');

  $('editFileName').textContent = file.name;
  $('editFileIcon').innerHTML = isImage ? IMAGE_ICON : (isAudio ? AUDIO_ICON : VIDEO_ICON);

  if (isImage) {
    editDuration = 0;
    $('editFileDuration').textContent = '';
    $('editImgPreview').src = editObjectURL;
    setPreviewPlaying(false);
    hide(editDropZone, editDoneCard, editErrorMsg, editPreviewWrap, $('editTimeline'), editTrimBtn);
    show($('editImgPreviewWrap'), $('editUpscaleBtn'), editPanel);
    return;
  }

  editMediaEl.src = editObjectURL;
  editMediaEl.addEventListener('loadedmetadata', () => {
    editDuration = Math.floor(editMediaEl.duration);
    $('editFileDuration').textContent = fmtSecs(editDuration);

    trimStart = 0;
    trimEnd = editDuration;
    trimStartInput.value = '0:00';
    trimEndInput.value = fmtSecs(editDuration);

    editPreviewPlayer.classList.toggle('audio-mode', isAudio);
    $('editUpscaleBtn').classList.toggle('hidden', isAudio);
    setPreviewPlaying(false);
    hide($('editImgPreviewWrap'));
    show(editPreviewWrap, $('editTimeline'), editTrimBtn);

    updateTrimUI();
    updatePreviewHead();

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

// Unified timeline interaction mapping
let activeDrag = null;

etWrap.addEventListener('pointerdown', e => {
  if (!editDuration) return;
  e.preventDefault();
  etWrap.setPointerCapture(e.pointerId);

  const rect = etWrap.getBoundingClientRect();
  const clickPct = (e.clientX - rect.left) / rect.width;
  const clickTime = clickPct * editDuration;

  if (e.target === etHandleS) {
    activeDrag = 'start';
    etHandleS.classList.add('active');
  } else if (e.target === etHandleE) {
    activeDrag = 'end';
    etHandleE.classList.add('active');
  } else {
    // Seek
    activeDrag = 'seek';
    editMediaEl.currentTime = Math.max(0, Math.min(editDuration, clickTime));
  }
});

etWrap.addEventListener('pointermove', e => {
  if (!activeDrag || !editDuration) return;

  const rect = etWrap.getBoundingClientRect();
  let pct = (e.clientX - rect.left) / rect.width;
  pct = Math.max(0, Math.min(1, pct));
  const time = pct * editDuration;

  if (activeDrag === 'start') {
    trimStart = Math.min(time, trimEnd - 1);
    trimStart = Math.max(0, trimStart);
    trimStartInput.value = fmtSecs(trimStart);
    editMediaEl.currentTime = trimStart;
    updateTrimUI();
  } else if (activeDrag === 'end') {
    trimEnd = Math.max(time, trimStart + 1);
    trimEnd = Math.min(editDuration, trimEnd);
    trimEndInput.value = fmtSecs(trimEnd);
    editMediaEl.currentTime = trimEnd;
    updateTrimUI();
  } else if (activeDrag === 'seek') {
    editMediaEl.currentTime = time;
  }
});

etWrap.addEventListener('pointerup', endDrag);
etWrap.addEventListener('pointercancel', endDrag);

function endDrag() {
  activeDrag = null;
  etHandleS.classList.remove('active');
  etHandleE.classList.remove('active');
}

// Text inputs → UI + preview seek
trimStartInput.addEventListener('change', () => {
  let v = parseSecs(trimStartInput.value);
  v = Math.max(0, Math.min(v, editDuration - 1));
  if (v >= trimEnd) { trimEnd = v + 1; trimEndInput.value = fmtSecs(trimEnd); }
  trimStart = v;
  trimStartInput.value = fmtSecs(v);
  updateTrimUI();
  editMediaEl.currentTime = v;
});

trimEndInput.addEventListener('change', () => {
  let v = parseSecs(trimEndInput.value);
  v = Math.min(Math.max(v, 1), editDuration);
  if (v <= trimStart) { trimStart = v - 1; trimStartInput.value = fmtSecs(trimStart); }
  trimEnd = v;
  trimEndInput.value = fmtSecs(v);
  updateTrimUI();
  editMediaEl.currentTime = v;
});

// Clear file
$('editClearBtn').addEventListener('click', () => {
  editMediaEl.pause();
  setPreviewPlaying(false);
  editFile = null;
  hide(editPanel, editDoneCard, editPreviewWrap, $('editImgPreviewWrap'));
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
  const end = parseSecs(trimEndInput.value);

  const fd = new FormData();
  fd.append('file', editFile);
  fd.append('start', String(start));
  fd.append('end', String(end));

  try {
    const res = await fetch('/api/trim', { method: 'POST', body: fd });
    const data = await res.json();

    if (!res.ok) { editErrorMsg.textContent = data.error || 'Trim failed.'; show(editErrorMsg); return; }

    if (IS_ELECTRON) {
      const ext = editFile.name.split('.').pop();
      const name = editFile.name.replace(/\.[^.]+$/, '') + `_trim_${fmtSecs(start).replace(/:/g, '-')}-${fmtSecs(end).replace(/:/g, '-')}.${ext}`;
      const result = await window.electronAPI.saveFile({ serverPath: data.server_path, suggestedName: name });
      if (result.canceled) return;
      $('editOpenFolderBtn').classList.remove('hidden');
      $('editOpenFolderBtn').onclick = () => window.electronAPI.openFolder(result.folderPath);
      $('editDownloadLink').classList.add('hidden');
      $('editDoneSub').textContent = 'Saved to ' + result.filePath;
    } else {
      $('editDownloadLink').href = data.download_url;
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

$('editUpscaleBtn').addEventListener('click', async () => {
  if (!editFile) return;
  editErrorMsg.classList.add('hidden');
  const btn = $('editUpscaleBtn');
  btn.disabled = true;
  btn.textContent = 'Upscaling…';

  const fd = new FormData();
  fd.append('file', editFile);

  try {
    const res = await fetch('/api/upscale', { method: 'POST', body: fd });
    const data = await res.json();

    if (!res.ok) {
      editErrorMsg.textContent = data.error || 'Upscale failed.';
      show(editErrorMsg);
      return;
    }

    if (IS_ELECTRON) {
      const ext = editFile.name.split('.').pop();
      const name = editFile.name.replace(/\.[^.]+$/, '') + `_2x.${ext}`;
      const result = await window.electronAPI.saveFile({ serverPath: data.server_path, suggestedName: name });
      if (result.canceled) return;
      $('editOpenFolderBtn').classList.remove('hidden');
      $('editOpenFolderBtn').onclick = () => window.electronAPI.openFolder(result.folderPath);
      $('editDownloadLink').classList.add('hidden');
      $('editDoneSub').textContent = 'Saved to ' + result.filePath;
    } else {
      $('editDownloadLink').href = data.download_url;
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
    btn.disabled = false;
    btn.textContent = 'Upscale 2×';
  }
});

$('editResetBtn').addEventListener('click', () => {
  editMediaEl.pause();
  setPreviewPlaying(false);
  editFile = null;
  if (editObjectURL) { URL.revokeObjectURL(editObjectURL); editObjectURL = null; }
  editFileInput.value = '';
  hide(editDoneCard, editPanel, editPreviewWrap, $('editImgPreviewWrap'), editErrorMsg);
  show(editDropZone);
});

// ── Reset ─────────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  urlInput.value = '';
  lastSavedFolder = null;
  videoTitle = '';
  filenameInput.value = '';
  clearError();
  hide(previewCard, progressCard, doneCard, openFolderBtn, filenameInput, $('playlistBanner'));
  $('playlistToggle').checked = false;
  show(downloadLink); // restore for web mode
  refreshRecent();
  urlInput.focus();
});
