'use strict';

const { app, BrowserWindow, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('path');

// Must be set before any server module is required so data-dir.js picks it up
process.env.WORKPULSE_DATA_DIR = app.getPath('userData');
process.env.OPEN_BROWSER = '0';
process.env.WORKPULSE_ELECTRON = '1';

app.setName('WorkPulse');

// Register custom URL scheme so the browser can hand control back after OAuth
app.setAsDefaultProtocolClient('workpulse');

// Start Express server in-process (Electron bundles Node.js)
const wpServer = require('../server/index');

const PORT = parseInt(process.env.PORT || '3333', 10);
const APP_URL = `http://localhost:${PORT}`;

let win = null;
let tray = null;

// Called when the OS hands us a workpulse:// deep link
function handleDeepLink(url) {
  try {
    const u = new URL(url);
    // workpulse://oauth?github=connected  →  /?github=connected
    const query = u.searchParams.toString();
    if (win) {
      win.loadURL(`${APP_URL}${query ? '/?' + query : ''}`);
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  } catch { /* ignore malformed URLs */ }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    title: 'WorkPulse',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 15 },
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
  // Catch server-side 302 redirects (e.g. /auth/github → github.com)
  win.webContents.on('will-redirect', (e, url) => {
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

// macOS: deep link arrives via open-url
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handleDeepLink(url);
  } else {
    app.once('ready', () => handleDeepLink(url));
  }
});

// Windows/Linux: deep link arrives as second-instance argv
app.on('second-instance', (_event, argv) => {
  const url = argv.find(a => a.startsWith('workpulse://'));
  if (url) handleDeepLink(url);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  // Let the server focus the Electron window after OAuth callbacks
  wpServer.setFocusCallback(() => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

app.on('window-all-closed', () => {
  // On macOS keep running in tray when all windows are closed
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
