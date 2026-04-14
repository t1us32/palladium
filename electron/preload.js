'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // Save a downloaded file — either via native save-dialog or directly to Downloads folder
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),

  // Open the folder that contains the saved file in the OS file manager
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),

  // Persistent settings (saved to userData)
  getSettings: ()  => ipcRenderer.invoke('get-settings'),
  setSettings: (s) => ipcRenderer.invoke('set-settings', s),

  // Clipboard
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),

  // Download history
  getHistory:    ()      => ipcRenderer.invoke('get-history'),
  addHistory:    (entry) => ipcRenderer.invoke('add-history', entry),
  clearHistory:  ()      => ipcRenderer.invoke('clear-history'),
});
