// Me desktop shell: runs the bundled Next.js server in a background process
// and shows it in a native window. Data lives in ~/Library/Application Support/Me.
const { app, BrowserWindow, shell, Menu, dialog, nativeTheme } = require('electron');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 3737;
const ORIGIN = `http://localhost:${PORT}`;
const isLocal = (url) => { try { const u = new URL(url); return ['localhost', '127.0.0.1'].includes(u.hostname) && u.port === String(PORT); } catch { return false; } };

app.setName('Me');
if (!app.requestSingleInstanceLock()) app.quit();

const dataDir = app.getPath('userData');
let server = null;
let win = null;
let quitting = false;

// One-time move of the data from the original ~/Me folder.
function migrate() {
  fs.mkdirSync(dataDir, { recursive: true });
  const legacy = path.join(os.homedir(), 'Me');
  if (!fs.existsSync(path.join(dataDir, 'me.db')) && fs.existsSync(path.join(legacy, 'data', 'me.db'))) {
    for (const f of ['me.db', 'me.db-wal', 'me.db-shm']) {
      const src = path.join(legacy, 'data', f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f));
    }
  }
  const env = path.join(dataDir, '.env.local');
  if (!fs.existsSync(env) && fs.existsSync(path.join(legacy, '.env.local'))) {
    fs.copyFileSync(path.join(legacy, '.env.local'), env);
    fs.chmodSync(env, 0o600);
  }
}

async function ping() {
  try { const r = await fetch(`${ORIGIN}/api/status`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

async function startServer() {
  if (await ping()) return; // already running (e.g. `npm start` in a terminal)
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(__dirname, '..', '.next', 'standalone');
  const entry = path.join(dir, 'server.js');
  if (!fs.existsSync(entry)) throw new Error(`Server bundle missing at ${entry}. Run "npm run build:server".`);
  const log = fs.openSync(path.join(dataDir, 'server.log'), 'a');
  server = fork(entry, [], {
    cwd: dir,
    stdio: ['ignore', log, log, 'ipc'],
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', PORT: String(PORT), HOSTNAME: '127.0.0.1',
      ME_DATA_DIR: dataDir, ME_ENV_FILE: path.join(dataDir, '.env.local'), ME_DESKTOP: '1',
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning', NEXT_TELEMETRY_DISABLED: '1',
    },
  });
  server.on('exit', (code) => {
    server = null;
    if (!quitting) dialog.showErrorBox('Me stopped', `The background server exited (code ${code}). Details: ${path.join(dataDir, 'server.log')}`);
  });
  for (let i = 0; i < 80; i++) { if (await ping()) return; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`Server didn't start. See ${path.join(dataDir, 'server.log')}`);
}

const boundsFile = path.join(dataDir, 'window.json');
function loadBounds() { try { return JSON.parse(fs.readFileSync(boundsFile, 'utf8')); } catch { return { width: 1320, height: 880 }; } }

function createWindow() {
  win = new BrowserWindow({
    ...loadBounds(), minWidth: 880, minHeight: 600, title: 'Me', show: false,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141412' : '#f6f5f2',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.loadURL(ORIGIN);
  win.once('ready-to-show', () => win.show());

  // Anything that isn't Me itself (Google sign-in, Gmail, Meet links, links
  // inside emails) opens in your normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:|^mailto:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  const guard = (e, url) => { if (!isLocal(url)) { e.preventDefault(); shell.openExternal(url); } };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);

  win.on('close', (e) => {
    try { fs.writeFileSync(boundsFile, JSON.stringify(win.getNormalBounds())); } catch {}
    if (!quitting && process.platform === 'darwin') { e.preventDefault(); win.hide(); }
  });
}

function show(route) {
  if (!win) createWindow();
  win.show(); win.focus();
  if (route) win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('me:navigate', { detail: ${JSON.stringify(route)} }))`);
}

function buildMenu() {
  const go = (label, route, key) => ({ label, accelerator: `CmdOrCtrl+${key}`, click: () => show(route) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu', submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => show('/settings') },
      { label: 'Open at Login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
      { label: 'Show Data Folder', click: () => shell.openPath(dataDir) },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'File', submenu: [
      { label: 'Quick Add Task', accelerator: 'CmdOrCtrl+N', click: () => { show(); win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))"); } },
      { role: 'close' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      go('Home', '/', 1), go('Tasks', '/tasks', 2), go('Calendar', '/calendar', 3), go('Training', '/training', 4),
      { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ]));
}

// Dock badge = tasks due today or overdue.
async function updateBadge() {
  try {
    const { tasks } = await (await fetch(`${ORIGIN}/api/tasks`)).json();
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const n = tasks.filter((t) => t.due_date && t.due_date <= today).length;
    app.dock?.setBadge(n ? String(n) : '');
  } catch {}
}

app.on('second-instance', () => show());
app.on('activate', () => show());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { if (server) server.kill(); });

app.whenReady().then(async () => {
  migrate();
  buildMenu();
  try { await startServer(); }
  catch (e) { dialog.showErrorBox('Me couldn’t start', e.message); app.exit(1); return; }
  createWindow();
  updateBadge();
  setInterval(updateBadge, 60_000);
  win.on('focus', updateBadge);
});
