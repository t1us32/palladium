'use strict';
/**
 * Downloads yt-dlp for the target platform into bin/ before electron-builder
 * packages the app. Run automatically via "build:*" npm scripts.
 *
 * Uses platform-specific standalone binaries from the yt-dlp GitHub releases
 * instead of the Python zipapp (bare "yt-dlp"), which requires Python and will
 * not work on end-user machines running a packaged Electron app.
 */
const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');
const os = require('os');

const targetParam = process.argv[2] || process.platform;
let targetPlatform = process.platform;
if (targetParam === 'win' || targetParam === 'win32') targetPlatform = 'win32';
else if (targetParam === 'mac' || targetParam === 'darwin') targetPlatform = 'darwin';
else if (targetParam === 'linux') targetPlatform = 'linux';

// Map platform+arch to the correct standalone release filename on GitHub.
// 'yt-dlp' (no suffix) is a Python zipapp — it does NOT run without Python.
function ytDlpReleaseName(platform, arch) {
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (arch === 'arm64') return 'yt-dlp_linux_aarch64';
  if (arch === 'arm')   return 'yt-dlp_linux_armv7l';
  return 'yt-dlp_linux';
}

const targetArch = process.arch;
const releaseName = ytDlpReleaseName(targetPlatform, targetArch);

const BIN_DIR  = path.join(__dirname, '..', 'bin');
// The saved filename must match what getYtDlpPath() in server.js looks for.
const BIN_NAME = targetPlatform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);

fs.mkdirSync(BIN_DIR, { recursive: true });

(async () => {
  if (fs.existsSync(BIN_PATH)) {
    console.log('[prepare-bins] yt-dlp already present:', BIN_PATH);
    return;
  }
  console.log('[prepare-bins] Downloading yt-dlp for', targetPlatform, targetArch,
              '(' + releaseName + ') ...');
  const releases = await YTDlpWrap.getGithubReleases(1, 1);
  const version  = releases[0].tag_name;
  const fileURL  = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${releaseName}`;
  await YTDlpWrap.downloadFile(fileURL, BIN_PATH);
  if (targetPlatform !== 'win32') fs.chmodSync(BIN_PATH, 0o755);
  console.log('[prepare-bins] Done:', BIN_PATH);
})().catch(err => { console.error('[prepare-bins] Failed:', err.message); process.exit(1); });
