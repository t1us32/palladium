'use strict';

const { app, BrowserWindow, shell, dialog, ipcMain, Menu, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');

let mainWindow = null;
let serverPort = null;

// ── Settings ──────────────────────────────────────────────────────────────────
const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  saveLocation: 'downloads', // 'downloads' | 'ask'
};

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH(), 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

function persistSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH()), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(s, null, 2));
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('set-settings', (_, s) => {
  const merged = { ...loadSettings(), ...s };
  persistSettings(merged);
  return merged;
});

ipcMain.handle('save-file', async (_, { serverPath, suggestedName }) => {
  const settings = loadSettings();

  if (settings.saveLocation === 'ask') {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save download',
      defaultPath: path.join(app.getPath('downloads'), suggestedName),
      filters: [
        { name: 'Video', extensions: ['mp4', 'mkv', 'webm'] },
        { name: 'Audio', extensions: ['mp3', 'm4a', 'ogg', 'flac'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.promises.copyFile(serverPath, filePath);
    return { saved: true, filePath, folderPath: path.dirname(filePath) };
  }

  // Auto-save to OS Downloads folder
  const dest = path.join(app.getPath('downloads'), suggestedName);
  await fs.promises.copyFile(serverPath, dest);
  return { saved: true, filePath: dest, folderPath: app.getPath('downloads') };
});

// Auto-save without dialog — used by queue items so they don't block each other
ipcMain.handle('save-file-auto', async (_, { serverPath, suggestedName }) => {
  const dest = path.join(app.getPath('downloads'), suggestedName);
  await fs.promises.copyFile(serverPath, dest);
  return { saved: true, filePath: dest, folderPath: app.getPath('downloads') };
});

ipcMain.handle('open-folder', (_, folderPath) => {
  shell.openPath(folderPath);
});

// ── Clipboard ─────────────────────────────────────────────────────────────────
ipcMain.handle('read-clipboard', () => clipboard.readText());

// ── History ───────────────────────────────────────────────────────────────────
const HISTORY_PATH = () => path.join(app.getPath('userData'), 'history.json');

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_PATH(), 'utf8')); }
  catch { return []; }
}
function saveHistory(list) {
  fs.mkdirSync(path.dirname(HISTORY_PATH()), { recursive: true });
  fs.writeFileSync(HISTORY_PATH(), JSON.stringify(list, null, 2));
}

ipcMain.handle('get-history',   () => loadHistory());
ipcMain.handle('add-history',   (_, entry) => {
  const list = [entry, ...loadHistory()].slice(0, 30);
  saveHistory(list);
  return list;
});
ipcMain.handle('clear-history', () => { saveHistory([]); return []; });

// ── Server ────────────────────────────────────────────────────────────────────
async function startServer() {
  const { start } = require('../server');
  serverPort = await start();
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  // Remove the native File / Edit / View / … menu bar on all platforms
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width:     560,
    height:    460,
    minWidth:  480,
    minHeight: 400,
    title: 'Palladium',
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          false,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  mainWindow.once('ready-to-show', () => { mainWindow.show(); mainWindow.focus(); });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
  } catch (err) {
    dialog.showErrorBox('Palladium — startup error', `Failed to start:\n\n${err.message}`);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
