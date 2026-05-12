'use strict';

const { app, BrowserWindow, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('path');

// Must be set before any server module is required so data-dir.js picks it up
process.env.WORKPULSE_DATA_DIR = app.getPath('userData');
process.env.OPEN_BROWSER = '0';

// Start Express server in-process (Electron bundles Node.js)
require('../server/index');

const PORT = parseInt(process.env.PORT || '3333', 10);
const APP_URL = `http://localhost:${PORT}`;

let win = null;
let tray = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    title: 'WorkPulse',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(APP_URL);

  // Retry once if server isn't up yet (shouldn't happen, Express starts in <100ms)
  win.webContents.on('did-fail-load', (_e, code) => {
    if (code === -102 || code === -6) {
      setTimeout(() => win && win.loadURL(APP_URL), 600);
    }
  });

  // Open all external links (OAuth, Jira, GitHub) in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_URL)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('closed', () => { win = null; });
}

function createTray() {
  // Use a blank 16x16 template image as fallback — replace build/tray.png with a real icon
  const iconPath = path.join(__dirname, '..', 'build', 'tray.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip('WorkPulse');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open WorkPulse', click: () => { if (win) win.focus(); else createWindow(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', () => { if (win) win.focus(); else createWindow(); });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // On macOS keep running in tray when all windows are closed
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
