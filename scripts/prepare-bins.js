'use strict';
/**
 * Downloads yt-dlp for the current platform into bin/ before electron-builder
 * packages the app. Run automatically via "prebuild:*" npm scripts.
 */
const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs   = require('fs');

const BIN_DIR  = path.join(__dirname, '..', 'bin');
const BIN_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);

fs.mkdirSync(BIN_DIR, { recursive: true });

(async () => {
  if (fs.existsSync(BIN_PATH)) {
    console.log('[prepare-bins] yt-dlp already present:', BIN_PATH);
    return;
  }
  console.log('[prepare-bins] Downloading yt-dlp for', process.platform, process.arch, '...');
  await YTDlpWrap.downloadFromGithub(BIN_PATH);
  fs.chmodSync(BIN_PATH, 0o755);
  console.log('[prepare-bins] Done:', BIN_PATH);
})().catch(err => { console.error('[prepare-bins] Failed:', err.message); process.exit(1); });
