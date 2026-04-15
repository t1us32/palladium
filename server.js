'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const net       = require('net');
const crypto    = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const YTDlpWrap     = require('yt-dlp-wrap').default;
const multer        = require('multer');
const ffmpegStatic  = require('ffmpeg-static');

const execFileAsync = promisify(execFile);

// ── Paths (work in both dev and packaged Electron) ────────────────────────────

function getElectronApp() {
  try { return require('electron').app; } catch { return null; }
}

// Downloads dir — must be writable; in packaged app __dirname is inside asar
function getDownloadsDir() {
  const app = getElectronApp();
  return app
    ? path.join(app.getPath('userData'), 'downloads')
    : path.join(__dirname, 'downloads');
}

// yt-dlp binary: prefer bundled extraResources, fall back to userData on first run
function getYtDlpPath() {
  const exe = os.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const app = getElectronApp();
  if (app) {
    const bundled = path.join(process.resourcesPath, 'bin', exe);
    if (fs.existsSync(bundled)) return bundled;
    return path.join(app.getPath('userData'), 'bin', exe);
  }
  return path.join(__dirname, 'bin', exe);
}

// ffmpeg: bundled via ffmpeg-static; electron-builder unpacks it from asar
function getFfmpegPath() {
  if (!ffmpegStatic) return 'ffmpeg';
  // Handle both Windows (\) and POSIX (/) separators that may appear inside
  // asar paths regardless of platform, and handle the extraResources/bin copy.
  const app = getElectronApp();
  if (app) {
    const ext = os.platform() === 'win32' ? '.exe' : '';
    const bundled = path.join(process.resourcesPath, 'bin', 'ffmpeg' + ext);
    if (fs.existsSync(bundled)) return bundled;
  }
  return ffmpegStatic
    .replace('app.asar/', 'app.asar.unpacked/')
    .replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

const DOWNLOADS  = getDownloadsDir();
const BIN_PATH   = getYtDlpPath();
const FFMPEG_BIN = getFfmpegPath();

fs.mkdirSync(DOWNLOADS, { recursive: true });
fs.mkdirSync(path.dirname(BIN_PATH), { recursive: true });

// ── Job store ─────────────────────────────────────────────────────────────────
// jobId → { status: 'running'|'done'|'error', progress: object|null, result, error }
const jobs = new Map();

// ── yt-dlp ────────────────────────────────────────────────────────────────────
let ytDlp;

// Map runtime platform+arch to the correct yt-dlp GitHub release filename.
// 'yt-dlp' (no suffix) is a Python zipapp and does NOT work without Python.
function ytDlpReleaseName() {
  const p = os.platform();
  if (p === 'win32') return 'yt-dlp.exe';
  if (p === 'darwin') return 'yt-dlp_macos';
  const a = os.arch();
  if (a === 'arm64') return 'yt-dlp_linux_aarch64';
  if (a === 'arm')   return 'yt-dlp_linux_armv7l';
  return 'yt-dlp_linux';
}

async function initYtDlp() {
  if (!fs.existsSync(BIN_PATH)) {
    console.log('[yt-dlp] Downloading binary for', os.platform(), os.arch(), '…');
    const releases  = await YTDlpWrap.getGithubReleases(1, 1);
    const version   = releases[0].tag_name;
    const fileName  = ytDlpReleaseName();
    const fileURL   = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${fileName}`;
    await YTDlpWrap.downloadFile(fileURL, BIN_PATH);
    if (os.platform() !== 'win32') fs.chmodSync(BIN_PATH, 0o755);
    console.log('[yt-dlp] Ready:', BIN_PATH);
  }
  ytDlp = new YTDlpWrap(BIN_PATH);
}

// ── Platform detection ────────────────────────────────────────────────────────
const PLATFORMS = [
  { id: 'youtube',     pattern: /youtube\.com|youtu\.be/i,               label: 'YouTube',     color: '#ff0000', defaultFormat: 'video' },
  { id: 'spotify',     pattern: /open\.spotify\.com|spotify\.com/i,      label: 'Spotify',     color: '#1db954', defaultFormat: 'audio' },
  { id: 'soundcloud',  pattern: /soundcloud\.com/i,                       label: 'SoundCloud',  color: '#ff5500', defaultFormat: 'audio' },
  { id: 'tiktok',      pattern: /tiktok\.com|vm\.tiktok\.com/i,           label: 'TikTok',      color: '#010101', defaultFormat: 'video' },
  { id: 'instagram',   pattern: /instagram\.com/i,                        label: 'Instagram',   color: '#e1306c', defaultFormat: 'video' },
  { id: 'twitter',     pattern: /twitter\.com|x\.com/i,                   label: 'X / Twitter', color: '#1da1f2', defaultFormat: 'video' },
  { id: 'vimeo',       pattern: /vimeo\.com/i,                            label: 'Vimeo',       color: '#1ab7ea', defaultFormat: 'video' },
  { id: 'twitch',      pattern: /twitch\.tv/i,                            label: 'Twitch',      color: '#9146ff', defaultFormat: 'video' },
  { id: 'reddit',      pattern: /reddit\.com|v\.redd\.it/i,               label: 'Reddit',      color: '#ff4500', defaultFormat: 'video' },
  { id: 'facebook',    pattern: /facebook\.com|fb\.watch/i,               label: 'Facebook',    color: '#1877f2', defaultFormat: 'video' },
  { id: 'dailymotion', pattern: /dailymotion\.com/i,                      label: 'Dailymotion', color: '#0066dc', defaultFormat: 'video' },
  { id: 'generic',     pattern: /.*/,                                     label: 'Video',       color: '#666666', defaultFormat: 'video' },
];

function detectPlatform(url) {
  return PLATFORMS.find(p => p.pattern.test(url)) || PLATFORMS.at(-1);
}

function isValidUrl(url) {
  try { new URL(url); return true; } catch { return false; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function findOutput(jobId) {
  return fs.readdirSync(DOWNLOADS)
    .filter(f => f.startsWith(jobId))
    .map(f => path.join(DOWNLOADS, f))[0] || null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function lastLines(str, n = 4) {
  return str.trim().split('\n').slice(-n).join(' ').trim();
}

// ── spotdl (Spotify) ──────────────────────────────────────────────────────────
async function spotifyInfo(url) {
  // spotdl save writes a JSON-like save file; easiest is to use the url subcommand
  // to get the resolved YouTube URL, then feed to yt-dlp for metadata
  try {
    const { stdout } = await execFileAsync('spotdl', ['url', url], { timeout: 30_000 });
    const ytUrl = stdout.trim().split('\n').find(l => l.startsWith('http'));
    if (!ytUrl) throw new Error('Could not resolve Spotify track to a YouTube URL.');
    const raw  = await ytDlp.execPromise([ytUrl, '--dump-json', '--no-playlist']);
    const data = JSON.parse(raw);
    return {
      title:      data.title     || 'Spotify Track',
      uploader:   data.uploader  || data.artist || 'Unknown',
      duration:   data.duration  || null,
      thumbnail:  data.thumbnail || null,
      view_count: null,
      like_count: null,
    };
  } catch {
    // Fallback: return minimal info without metadata
    return { title: 'Spotify Track', uploader: null, duration: null, thumbnail: null };
  }
}

async function spotifyDownload(url, jobId) {
  const outDir = DOWNLOADS;
  await execFileAsync(
    'spotdl',
    ['download', url, '--output', path.join(outDir, `${jobId}-{title}`), '--format', 'mp3'],
    { timeout: 180_000 }
  );
  return findOutput(jobId);
}

// ── yt-dlp download helpers ───────────────────────────────────────────────────
// quality for video: 'best' | '2160' | '1080' | '720' | '480' | '360'
// quality for audio: 'best' | '320K' | '192K' | '128K'
function ytdlpVideoArgs(url, outTpl, quality = 'best') {
  const fmt = quality === 'best'
    ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
    : `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best[height<=${quality}]`;
  return [url, '-f', fmt, '--merge-output-format', 'mp4', '--ffmpeg-location', FFMPEG_BIN, '--no-playlist', '-o', outTpl];
}

function ytdlpAudioArgs(url, outTpl, quality = 'best') {
  const bitrate = quality === 'best' ? '0' : quality;
  return [
    url,
    '-f', 'bestaudio/best',
    '--extract-audio', '--audio-format', 'mp3',
    '--audio-quality', bitrate,
    '--ffmpeg-location', FFMPEG_BIN,
    '--no-playlist', '-o', outTpl,
  ];
}

// ── Background download runner ────────────────────────────────────────────────
function runDownloadJob(jobId, url, format, quality) {
  const job      = jobs.get(jobId);
  const platform = detectPlatform(url);
  const outTpl   = path.join(DOWNLOADS, `${jobId}.%(ext)s`);

  // Spotify: no yt-dlp progress events — just resolve when done
  if (platform.id === 'spotify') {
    spotifyDownload(url, jobId)
      .then(file => {
        if (!file || !fs.existsSync(file)) {
          job.status = 'error'; job.error = 'Download produced no output file.';
        } else {
          job.status = 'done';
          job.result = buildResult(jobId, file);
        }
      })
      .catch(err => {
        job.status = 'error';
        job.error  = lastLines(err.message || String(err)) || 'Download failed.';
      });
    return;
  }

  const args    = format === 'audio'
    ? ytdlpAudioArgs(url, outTpl, quality)
    : ytdlpVideoArgs(url, outTpl, quality);
  const emitter = ytDlp.exec(args);

  emitter.on('progress', progress => { job.progress = progress; });

  emitter.on('close', () => {
    if (job.status !== 'running') return;
    const file = findOutput(jobId);
    if (file && fs.existsSync(file)) {
      job.status = 'done'; job.result = buildResult(jobId, file);
    } else {
      job.status = 'error'; job.error = 'Download produced no output file.';
    }
  });

  emitter.on('error', err => {
    if (job.status !== 'running') return;
    job.status = 'error';
    job.error  = lastLines(err.message || String(err)) || 'Download failed.';
  });
}

function buildResult(jobId, file) {
  return {
    status:       'ok',
    filename:     path.basename(file),
    download_url: `/files/${path.basename(file)}`,
    server_path:  file,
  };
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

// GET /api/platforms  — let the frontend know what we support
app.get('/api/platforms', (_req, res) => {
  res.json(PLATFORMS.filter(p => p.id !== 'generic').map(({ id, label, color, defaultFormat }) => ({
    id, label, color, defaultFormat,
  })));
});

// POST /api/info
app.post('/api/info', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Enter a valid URL.' });

  const platform = detectPlatform(url);

  try {
    let info;
    if (platform.id === 'spotify') {
      info = await spotifyInfo(url);
    } else {
      const raw  = await ytDlp.execPromise([url, '--dump-json', '--no-playlist']);
      const data = JSON.parse(raw);
      info = {
        title:      data.title      || 'Video',
        uploader:   data.uploader   || data.channel || data.creator || null,
        duration:   data.duration   || null,
        thumbnail:  data.thumbnail  || null,
        view_count: data.view_count || null,
        like_count: data.like_count || null,
      };
    }
    res.json({ ...info, platform: { id: platform.id, label: platform.label, color: platform.color, defaultFormat: platform.defaultFormat } });
  } catch (err) {
    res.status(400).json({ error: lastLines(err.message || String(err)) || 'Could not fetch info.' });
  }
});

// POST /api/download — starts a background job, returns { jobId } immediately
app.post('/api/download', (req, res) => {
  const { url, format = 'video', quality = 'best' } = req.body || {};
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Enter a valid URL.' });

  const jobId = crypto.randomBytes(12).toString('hex');
  jobs.set(jobId, { status: 'running', progress: null, result: null, error: null });
  runDownloadJob(jobId, url, format, quality);
  res.json({ jobId });
});

// GET /api/stream/:jobId — SSE: sends progress, then done/fail event
app.get('/api/stream/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!jobs.has(jobId)) return res.status(404).json({ error: 'Job not found.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (evt, data) => res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);
  send('open', { jobId });

  const tick = setInterval(() => {
    const job = jobs.get(jobId);
    if (!job) { clearInterval(tick); res.end(); return; }

    if (job.progress) { send('progress', job.progress); job.progress = null; }

    if (job.status === 'done') {
      send('done', job.result);
      clearInterval(tick); res.end();
      setTimeout(() => jobs.delete(jobId), 60_000);
    } else if (job.status === 'error') {
      send('fail', { error: job.error });
      clearInterval(tick); res.end();
      jobs.delete(jobId);
    }
  }, 250);

  req.on('close', () => clearInterval(tick));
});

// POST /api/playlist — returns flat list of playlist entries
app.post('/api/playlist', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Enter a valid URL.' });

  try {
    const raw  = await ytDlp.execPromise([
      url, '--flat-playlist', '--yes-playlist', '--dump-single-json', '--no-warnings',
    ]);
    const data = JSON.parse(raw);
    const entries = (data.entries || []).map(e => ({
      url:      e.url || e.webpage_url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null),
      title:    e.title    || 'Video',
      duration: e.duration || null,
      thumbnail: e.thumbnail || (e.thumbnails?.at(-1)?.url ?? null),
      uploader: e.uploader  || e.channel || null,
    })).filter(e => e.url);
    res.json({ title: data.title || 'Playlist', count: entries.length, entries });
  } catch (err) {
    res.status(400).json({ error: lastLines(err.message || String(err)) || 'Could not load playlist.' });
  }
});

// POST /api/trim
const upload = multer({ dest: DOWNLOADS, limits: { fileSize: 4 * 1024 * 1024 * 1024 } });

app.post('/api/trim', upload.single('file'), async (req, res) => {
  const inputPath = req.file?.path;
  if (!inputPath) return res.status(400).json({ error: 'No file provided.' });

  const { start = '0', end } = req.body;
  const ext    = path.extname(req.file.originalname).toLowerCase() || '.mp4';
  const jobId  = crypto.randomBytes(12).toString('hex');
  const output = path.join(DOWNLOADS, `${jobId}${ext}`);

  try {
    // -ss/-to after -i = accurate but slower; fine for local files
    const args = ['-y', '-i', inputPath, '-ss', String(start)];
    if (end && parseFloat(end) > parseFloat(start)) args.push('-to', String(end));
    args.push('-c', 'copy', output);

    await execFileAsync(FFMPEG_BIN, args, { timeout: 300_000 });
    fs.unlinkSync(inputPath);

    if (!fs.existsSync(output)) return res.status(500).json({ error: 'Trim produced no output.' });

    res.json({
      status:       'ok',
      filename:     path.basename(output),
      download_url: `/files/${path.basename(output)}`,
      server_path:  output,
    });
  } catch (err) {
    try { fs.unlinkSync(inputPath); } catch {}
    res.status(500).json({ error: lastLines(err.message || String(err)) || 'Trim failed.' });
  }
});

// GET /files/:filename
app.get('/files/:filename', (req, res) => {
  const name = path.basename(req.params.filename);
  const file = path.join(DOWNLOADS, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File not found.' });
  res.download(file, name);
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start(port) {
  await initYtDlp();
  const listenPort = port ?? (await freePort());
  await new Promise((resolve, reject) => {
    app.listen(listenPort, '127.0.0.1', resolve).on('error', reject);
  });
  console.log(`[server] http://127.0.0.1:${listenPort}`);
  return listenPort;
}

module.exports = { start };

if (require.main === module) {
  start(process.env.PORT ? parseInt(process.env.PORT) : 3000).catch(err => {
    console.error('[fatal]', err.message);
    process.exit(1);
  });
}
