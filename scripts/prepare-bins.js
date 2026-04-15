'use strict';
/**
 * Downloads yt-dlp for the target platform into bin/ before electron-builder
 * packages the app. Uses Node built-in https — no extra dependencies.
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const targetParam = process.argv[2] || process.platform;
let targetPlatform = process.platform;
if (targetParam === 'win' || targetParam === 'win32') targetPlatform = 'win32';
else if (targetParam === 'mac' || targetParam === 'darwin') targetPlatform = 'darwin';
else if (targetParam === 'linux') targetPlatform = 'linux';

const targetArch = process.arch; // arm64 | x64 | arm | ia32

// Map platform + arch to the exact filename on the yt-dlp GitHub Releases page.
// NOTE: 'yt-dlp' (bare) is a Python zipapp — it requires Python and won't work
//       in a packaged Electron app. Always use the standalone platform binary.
function ytDlpReleaseName(platform, arch) {
  if (platform === 'win32')  return 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';  // universal binary, works on x64 + arm64
  // Linux
  if (arch === 'arm64') return 'yt-dlp_linux_aarch64';
  if (arch === 'arm')   return 'yt-dlp_linux_armv7l';
  return 'yt-dlp_linux';
}

const releaseName = ytDlpReleaseName(targetPlatform, targetArch);
const BIN_DIR     = path.join(__dirname, '..', 'bin');
// The saved name must match what getYtDlpPath() in server.js looks for.
const BIN_NAME    = targetPlatform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_PATH    = path.join(BIN_DIR, BIN_NAME);

fs.mkdirSync(BIN_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

/** GET with redirect following; returns response body as string. */
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'palladium-build/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Download binary file with redirect following. */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'palladium-build/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      const tmp  = dest + '.tmp';
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(tmp, dest);
          resolve();
        });
      });
      file.on('error', err => { try { fs.unlinkSync(tmp); } catch {} reject(err); });
      res.on('error',  err => { try { fs.unlinkSync(tmp); } catch {} reject(err); });
    }).on('error', reject);
  });
}

/** Fetch latest yt-dlp release tag from GitHub API. */
async function getLatestTag() {
  const body = await get('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest');
  const tag  = JSON.parse(body).tag_name;
  if (!tag) throw new Error('Could not find tag_name in GitHub API response');
  return tag;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  if (fs.existsSync(BIN_PATH)) {
    console.log('[prepare-bins] yt-dlp already present:', BIN_PATH);
    return;
  }

  console.log(`[prepare-bins] Fetching latest yt-dlp release tag…`);
  const version = await getLatestTag();
  const fileURL = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${releaseName}`;

  console.log(`[prepare-bins] Downloading ${releaseName} (${version}) for ${targetPlatform}/${targetArch}…`);
  await downloadFile(fileURL, BIN_PATH);

  if (targetPlatform !== 'win32') fs.chmodSync(BIN_PATH, 0o755);

  console.log('[prepare-bins] Done:', BIN_PATH);
})().catch(err => {
  console.error('[prepare-bins] Failed:', err.message || String(err));
  process.exit(1);
});
