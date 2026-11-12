// Me desktop shell: a native window onto the hosted Me, so the Mac and phone
// share the same data. Set ME_URL=http://localhost:3737 (with `npm run dev`
// running) to point it at a local copy instead.
const { app, BrowserWindow, shell, Menu, nativeTheme, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ME_URL = (process.env.ME_URL || 'https://me-omega-green.vercel.app').replace(/\/$/, '');
const ORIGIN = new URL(ME_URL).origin;
const isOurs = (url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };

app.setName('Me');
if (!app.requestSingleInstanceLock()) app.quit();

const dataDir = app.getPath('userData');
let win = null;
let quitting = false;

const boundsFile = path.join(dataDir, 'window.json');
function loadBounds() { try { return JSON.parse(fs.readFileSync(boundsFile, 'utf8')); } catch { return { width: 1320, height: 880 }; } }

const OFFLINE = (msg) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>
body{font:15px -apple-system,sans-serif;background:#0c0c0c;color:#ececec;display:grid;place-items:center;height:100vh;margin:0;-webkit-app-region:drag}
div{text-align:center}p{color:#8c8c8c}button{-webkit-app-region:no-drag;font:inherit;padding:8px 16px;border-radius:9px;border:0;background:#ececec;color:#0c0c0c;cursor:pointer}</style>
<div><b>Can’t reach Me</b><p>${msg}</p><button onclick="location.href='${ME_URL}'">Try again</button></div>`)}`;

function createWindow() {
  win = new BrowserWindow({
    ...loadBounds(), minWidth: 880, minHeight: 600, title: 'Me', show: false,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0c0c' : '#fafafa',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.loadURL(ME_URL);
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadURL(OFFLINE('Check your internet connection.'));
  });

  // Google sign-in, Gmail, Meet and links in emails open in your browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:|^mailto:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  const guard = (e, url) => { if (!isOurs(url) && !url.startsWith('data:')) { e.preventDefault(); shell.openExternal(url); } };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);

  win.on('close', (e) => {
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(boundsFile, JSON.stringify(win.getNormalBounds())); } catch {}
    if (!quitting && process.platform === 'darwin') { e.preventDefault(); win.hide(); }
  });
}

function show(route) {
  if (!win) createWindow();
  win.show(); win.focus();
  if (route) win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('me:navigate', { detail: ${JSON.stringify(route)} }))`).catch(() => {});
}

function buildMenu() {
  const go = (label, route, key) => ({ label, accelerator: `CmdOrCtrl+${key}`, click: () => show(route) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu', submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => show('/settings') },
      { label: 'Open at Login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'File', submenu: [
      { label: 'Quick Add Task', accelerator: 'CmdOrCtrl+N', click: () => { show(); win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))").catch(() => {}); } },
      { role: 'close' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      go('Home', '/', 1), go('Tasks', '/tasks', 2), go('Calendar', '/calendar', 3), go('Notes', '/notes', 4), go('Training', '/training', 5),
      { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ]));
}

// Dock badge = tasks due today (uses the window's signed-in session).
async function updateBadge() {
  try {
    const res = await session.defaultSession.fetch(`${ME_URL}/api/tasks`);
    if (!res.ok) return app.dock?.setBadge('');
    const { tasks } = await res.json();
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const n = tasks.filter((t) => t.due_date && t.due_date <= today).length;
    app.dock?.setBadge(n ? String(n) : '');
  } catch {}
}

app.on('second-instance', () => show());
app.on('activate', () => show());
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  updateBadge();
  setInterval(updateBadge, 60_000);
  win.on('focus', updateBadge);
});
