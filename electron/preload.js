'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronBridge', {
  onFullscreenChange: (cb) => ipcRenderer.on('fullscreen-change', (_e, val) => cb(val)),
  isFullscreen:       ()   => ipcRenderer.invoke('is-fullscreen'),
});
