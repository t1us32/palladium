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
const archiver      = require('archiver');

// ── Download jobs (for SSE streaming) ────────────────────────────────────────
const jobs = new Map(); // jobId → { events[], clients Set, done bool }

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
  return ffmpegStatic.replace(
    'app.asar' + path.sep,
    'app.asar.unpacked' + path.sep
  );
}

const DOWNLOADS  = getDownloadsDir();
const BIN_PATH   = getYtDlpPath();
const FFMPEG_BIN = getFfmpegPath();

fs.mkdirSync(DOWNLOADS, { recursive: true });
fs.mkdirSync(path.dirname(BIN_PATH), { recursive: true });

// ── yt-dlp ────────────────────────────────────────────────────────────────────
let ytDlp;

async function initYtDlp() {
  if (!fs.existsSync(BIN_PATH)) {
    console.log('[yt-dlp] Downloading binary for', os.platform(), os.arch(), '…');
    await YTDlpWrap.downloadFromGithub(BIN_PATH);
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

// ── Spotify collection helpers (playlists + albums) ──────────────────────────
function isSpotifyCollection(url) {
  return /open\.spotify\.com\/(playlist|album)\//i.test(url);
}

function isSpotifyAlbum(url) {
  return /open\.spotify\.com\/album\//i.test(url);
}

// ── Spotify embed scraper (no credentials, no rate limits) ───────────────────
function extractSpotifyId(url) {
  const m = url.match(/open\.spotify\.com\/(album|playlist)\/([A-Za-z0-9]+)/);
  return m ? { type: m[1], id: m[2] } : null;
}

function httpsGet(url) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpsGet(res.headers.location));
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end',  () => resolve({ status: res.statusCode, text: body }));
    });
    req.setTimeout(12_000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
  });
}

async function spotifyEmbedInfo(url, collectionType) {
  const parsed = extractSpotifyId(url);
  if (!parsed) throw new Error('Cannot parse Spotify URL.');

  const { status, text } = await httpsGet(
    `https://open.spotify.com/embed/${parsed.type}/${parsed.id}`
  );
  if (status !== 200) throw new Error(`Spotify embed HTTP ${status}`);

  const m = text.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (!m) throw new Error('__NEXT_DATA__ not found in embed page.');

  const entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error('Entity not found in __NEXT_DATA__.');

  const title = entity.name || entity.title ||
    (collectionType === 'album' ? 'Spotify Album' : 'Spotify Playlist');

  // Largest image is last in the array
  const images = entity.visualIdentity?.image || entity.coverArt?.sources || entity.images || [];
  const thumbnail = images.length ? images.at(-1).url : null;

  // Tracks are in entity.trackList; each has .title and .subtitle (artist)
  const tracks = (entity.trackList || entity.tracks?.items || [])
    .map(item => {
      const t = item.track || item;
      const trackTitle  = t.title || t.name;
      const trackArtist = t.subtitle || '';
      if (!trackTitle) return null;
      return { title: trackTitle, artist: trackArtist };
    })
    .filter(Boolean);

  if (tracks.length === 0) throw new Error('No tracks found in embed data.');

  return {
    title, trackCount: tracks.length, tracks, thumbnail,
    isPlaylist: true, collectionType, duration: null,
    uploader: entity.subtitle || entity.artists?.[0]?.profile?.name || null,
  };
}

async function spotifyCollectionInfo(url, creds = {}) {
  const collectionType = isSpotifyAlbum(url) ? 'album' : 'playlist';

  // Primary: scrape the public embed page — no credentials, no rate limits
  try {
    return await spotifyEmbedInfo(url, collectionType);
  } catch (embedErr) {
    console.log('[spotify] embed scrape failed:', embedErr.message, '— trying spotdl save');
  }

  // Fallback: spotdl save (needs credentials when rate limited)
  const tmpFile = path.join(os.tmpdir(), `palladium-${crypto.randomBytes(6).toString('hex')}.spotdl`);
  try {
    const args = ['save', url, '--save-file', tmpFile];
    if (creds.clientId)     args.push('--client-id',     creds.clientId);
    if (creds.clientSecret) args.push('--client-secret', creds.clientSecret);
    const { stderr } = await execFileAsync('spotdl', args, { timeout: 30_000 });
    if (/rate.*limit|retry.*after/i.test(stderr || '')) throw new Error('RATE_LIMIT');
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    if (!Array.isArray(data) || data.length === 0) throw new Error('No tracks found.');
    const tracks = data.map(s => ({
      title:  s.name   || 'Unknown',
      artist: Array.isArray(s.artists) ? s.artists.join(', ') : (s.artist || ''),
    }));
    return {
      title: collectionType === 'album' ? (data[0].album_name || 'Spotify Album') : (data[0].list_name || 'Spotify Playlist'),
      trackCount: tracks.length, tracks,
      thumbnail: data[0].cover_url || null,
      isPlaylist: true, collectionType, duration: null, uploader: null,
    };
  } catch (err) {
    const msg = String(err.message || err);
    if (msg === 'RATE_LIMIT' || /rate.*limit|retry.*after/i.test(msg)) {
      throw new Error(
        creds.clientId
          ? 'Spotify rate limit reached even with custom credentials. Try again later.'
          : 'Spotify rate limit — embed scrape also failed. Add Spotify API credentials in Settings.'
      );
    }
    throw err;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function createZip(sourceDir, destPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const arc = archiver('zip', { zlib: { level: 0 } });
    output.on('close', resolve);
    arc.on('error', reject);
    arc.pipe(output);
    arc.directory(sourceDir, false);
    arc.finalize();
  });
}

function sanitizeFilename(s) {
  return s.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

async function fixMp3Tags(filePath, title, artist) {
  const tmp = filePath + '.tmp.mp3';
  try {
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-i', filePath,
      '-metadata', `title=${title}`,
      '-metadata', `artist=${artist}`,
      '-c:a', 'copy',
      tmp,
    ], { timeout: 30_000 });
    fs.renameSync(tmp, filePath);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function spotifyCollectionDownload(url, jobId, tracks = [], emit = () => {}) {
  const collectionDir = path.join(DOWNLOADS, jobId);
  fs.mkdirSync(collectionDir, { recursive: true });

  if (tracks.length === 0) throw new Error('No tracks found — fetch the URL first to load the track list.');

  let doneCount = 0;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const query = [t.artist, t.title].filter(Boolean).join(' - ');
    emit('track', { index: i, status: 'searching', title: t.title, artist: t.artist, total: tracks.length });
    const prefix = String(i + 1).padStart(2, '0');
    const base   = sanitizeFilename([t.artist, t.title].filter(Boolean).join(' - '));
    const outTpl = path.join(collectionDir, `${prefix} ${base}.%(ext)s`);
    try {
      await ytDlp.execPromise([
        `ytsearch1:${query}`,
        '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0',
        '--no-playlist', '-o', outTpl,
      ]);
      const mp3Path = path.join(collectionDir, `${prefix} ${base}.mp3`);
      if (fs.existsSync(mp3Path)) await fixMp3Tags(mp3Path, t.title, t.artist);
      doneCount++;
      emit('track', { index: i, status: 'done', title: t.title, artist: t.artist, done: doneCount, total: tracks.length });
    } catch {
      emit('track', { index: i, status: 'failed', title: t.title, artist: t.artist, done: doneCount, total: tracks.length });
    }
  }

  emit('log', { message: 'Creating archive…' });
  const zipPath = path.join(DOWNLOADS, `${jobId}.zip`);
  await createZip(collectionDir, zipPath);
  return { dir: collectionDir, zipPath };
}

// ── yt-dlp download helpers ───────────────────────────────────────────────────
// quality for video: 'best' | '2160' | '1080' | '720' | '480' | '360'
// quality for audio: 'best' | '320K' | '192K' | '128K'
function ytdlpVideoArgs(url, outTpl, quality = 'best') {
  const fmt = quality === 'best'
    ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
    : `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best[height<=${quality}]`;
  return [url, '-f', fmt, '--merge-output-format', 'mp4', '--no-playlist', '-o', outTpl];
}

function ytdlpAudioArgs(url, outTpl, quality = 'best') {
  const bitrate = quality === 'best' ? '0' : quality;
  return [
    url,
    '-f', 'bestaudio/best',
    '--extract-audio', '--audio-format', 'mp3',
    '--audio-quality', bitrate,
    '--no-playlist', '-o', outTpl,
  ];
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
  const { url, spotifyCredentials: creds = {} } = req.body || {};
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Enter a valid URL.' });

  const platform = detectPlatform(url);

  try {
    let info;
    if (platform.id === 'spotify') {
      info = isSpotifyCollection(url) ? await spotifyCollectionInfo(url, creds) : await spotifyInfo(url);
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

// POST /api/start-download  — creates a streaming job for collections
app.post('/api/start-download', (req, res) => {
  const { url, tracks = [], spotifyCredentials: creds = {} } = req.body || {};
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Enter a valid URL.' });
  if (!isSpotifyCollection(url))  return res.status(400).json({ error: 'Not a collection URL.' });

  const jobId = crypto.randomBytes(12).toString('hex');
  const job = { events: [], clients: new Set(), done: false };
  jobs.set(jobId, job);

  function emit(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    job.events.push(msg);
    job.clients.forEach(c => { try { c.write(msg); } catch {} });
  }

  (async () => {
    try {
      const result = await spotifyCollectionDownload(url, jobId, Array.isArray(tracks) ? tracks : [], emit);
      emit('done', {
        status: 'ok', isPlaylist: true,
        filename: `${jobId}.zip`,
        download_url: `/files/${jobId}.zip`,
        server_path: result.zipPath,
        dir_path: result.dir,
      });
    } catch (err) {
      emit('fail', { error: lastLines(err.message || String(err)) || 'Download failed.' });
    } finally {
      job.done = true;
      job.clients.forEach(c => { try { c.end(); } catch {} });
      setTimeout(() => jobs.delete(jobId), 60_000);
    }
  })();

  res.json({ jobId });
});

// GET /api/download-events/:jobId  — SSE stream for a collection job
app.get('/api/download-events/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Replay buffered events (handles reconnect / race with fast tracks)
  job.events.forEach(msg => res.write(msg));
  if (job.done) { res.end(); return; }

  job.clients.add(res);
  req.on('close', () => job.clients.delete(res));
});

// POST /api/download
app.post('/api/download', async (req, res) => {
  const { url, format = 'video', quality = 'best' } = req.body || {};
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Enter a valid URL.' });

  const platform = detectPlatform(url);
  const jobId    = crypto.randomBytes(12).toString('hex');
  const outTpl   = path.join(DOWNLOADS, `${jobId}.%(ext)s`);

  try {
    let file;

    if (platform.id === 'spotify') {
      file = await spotifyDownload(url, jobId);
    } else {
      const args = format === 'audio'
        ? ytdlpAudioArgs(url, outTpl, quality)
        : ytdlpVideoArgs(url, outTpl, quality);
      await ytDlp.execPromise(args);
      file = findOutput(jobId);
    }

    if (!file || !fs.existsSync(file)) {
      return res.status(500).json({ error: 'Download produced no output file.' });
    }

    res.json({
      status:       'ok',
      filename:     path.basename(file),
      download_url: `/files/${path.basename(file)}`,
      server_path:  file,
    });
  } catch (err) {
    res.status(400).json({ error: lastLines(err.message || String(err)) || 'Download failed.' });
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
