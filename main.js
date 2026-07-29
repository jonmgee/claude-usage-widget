const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { compute } = require('./usage');

app.setName('Claude Usage Widget');

const CFG = path.join(app.getPath('userData'), 'config.json');
// Budgets are gone: the percentages are now the real ones from the desktop app's
// own usage cache, so there is nothing left to calibrate.
const DEFAULTS = {
  refreshSec: 60,
  alwaysOnTop: true,
  skin: 'lcars', // lcars | dash | term | scribble
  caffeinate: 'off', // off | system (display may sleep) | display (keep both awake)
  heartbeatEnabled: false,
  heartbeatTimes: ['15:30'], // HH:MM local — each ping starts a window ending ~5h later
  lastHeartbeatAt: null,   // ms of last successful ping (for the countdown + display)
  lastFires: {},           // { 'HH:MM': dayKey } guard so each time fires once/day
  heartbeats: [],          // ms timestamps of every ping (drives the ECG monitor)
};

// Locate the Claude Code CLI (the "stable launcher").
function findCli() {
  const cands = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch { /* ignore */ } }
  return null;
}
const CLI = findCli();

function loadCfg() {
  let c;
  try { c = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG, 'utf8')) }; }
  catch { c = { ...DEFAULTS }; }
  // migrate old single-time config to the list form
  if (!Array.isArray(c.heartbeatTimes)) {
    c.heartbeatTimes = c.heartbeatTime ? [c.heartbeatTime] : ['15:30'];
  }
  if (!c.lastFires || typeof c.lastFires !== 'object') c.lastFires = {};
  return c;
}
function saveCfg(c) {
  try {
    fs.mkdirSync(path.dirname(CFG), { recursive: true });
    fs.writeFileSync(CFG, JSON.stringify(c, null, 2));
  } catch { /* ignore */ }
}

// Plan tier for the header pill, read straight from ~/.claude.json (no network).
function readPlan() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    const tier = (j && j.oauthAccount && j.oauthAccount.organizationRateLimitTier) || '';
    return /max_20x/.test(tier) ? 'Max (20x)'
      : /max_5x/.test(tier) ? 'Max (5x)'
      : /pro/.test(tier) ? 'Pro'
      : tier || 'Claude';
  } catch {
    return 'Claude';
  }
}

let win = null;
let cfg = loadCfg();
let timer = null;

function build() {
  return {
    ...compute({ heartbeatAt: cfg.lastHeartbeatAt }),
    plan: readPlan(),
    skin: cfg.skin || 'lcars',
    heartbeat: {
      enabled: cfg.heartbeatEnabled,
      times: cfg.heartbeatTimes || [],
      lastAt: cfg.lastHeartbeatAt,
      available: !!CLI,
      history: cfg.heartbeats || [],
    },
  };
}
function push() {
  const u = build();
  if (win && !win.isDestroyed()) win.webContents.send('usage', u);
  maybeHeartbeat(u);
}

// Fire a minimal, cheap CLI call to start a 5-hour window. Resolves {ok} / {ok:false,error}.
function fireHeartbeat() {
  return new Promise((resolve) => {
    if (!CLI) { resolve({ ok: false, error: 'Claude CLI not found' }); return; }
    const env = { ...process.env, HOME: os.homedir(),
      PATH: [path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''].join(':') };
    execFile(CLI,
      ['-p', 'Reply with the single word: ok', '--model', 'haiku', '--no-session-persistence'],
      { timeout: 90000, windowsHide: true, env },
      (err) => {
        if (err) { resolve({ ok: false, error: String(err.message || err) }); return; }
        const at = Date.now();
        cfg.lastHeartbeatAt = at;
        cfg.heartbeats = [...(cfg.heartbeats || []), at]
          .filter((t) => t > at - 14 * 24 * 60 * 60 * 1000) // keep 14 days
          .slice(-200);
        saveCfg(cfg);
        push();
        resolve({ ok: true });
      });
  });
}

// Scheduler: at each configured time, if no window is currently active, fire once.
function maybeHeartbeat(usage) {
  if (!cfg.heartbeatEnabled || !CLI) return;
  const times = Array.isArray(cfg.heartbeatTimes) ? cfg.heartbeatTimes : [];
  const now = new Date();
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  for (const t of times) {
    const [h, m] = String(t).split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    if (cfg.lastFires[t] === dayKey) continue;          // this slot already handled today
    const scheduled = new Date(now); scheduled.setHours(h, m, 0, 0);
    if (now < scheduled) continue;                       // not time yet
    if (now - scheduled > 60 * 60 * 1000) continue;      // missed by >1h — skip today
    if (usage.session.active) continue;                  // window already running; ping would be wasted
    cfg.lastFires[t] = dayKey;
    saveCfg(cfg);
    fireHeartbeat();
    return; // at most one ping per tick
  }
}

// --- caffeinate: keep the Mac awake so scheduled pings can fire ---
// modes: off | system (-i, display may sleep) | display (-di, both awake)
//        | system-off (-i, and put the display to sleep immediately)
let caffProc = null;
function applyCaffeinate(sleepScreenNow = false) {
  if (caffProc) { try { caffProc.kill(); } catch { /* ignore */ } caffProc = null; }
  const mode = cfg.caffeinate || 'off';
  if (mode === 'off') return;
  const args = mode === 'display' ? ['-di'] : ['-i'];
  try {
    caffProc = require('child_process').spawn('/usr/bin/caffeinate', args, { stdio: 'ignore' });
    caffProc.on('exit', () => { caffProc = null; });
  } catch { caffProc = null; }
  // one-shot screen-off, only when the user just picked this mode --
  // not on app startup (they just launched the widget to look at it)
  if (mode === 'system-off' && sleepScreenNow) {
    try { execFile('/usr/bin/pmset', ['displaysleepnow'], { timeout: 10000 }, () => {}); }
    catch { /* ignore */ }
  }
}

function startTimer() {
  clearInterval(timer);
  timer = setInterval(push, Math.max(15, cfg.refreshSec) * 1000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 340,
    height: 312, // starting height; the renderer auto-fits it to content
    frame: false,
    transparent: true,
    resizable: false,
    fullscreenable: false,
    hasShadow: true,
    alwaysOnTop: cfg.alwaysOnTop,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  if (cfg.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { push(); win.webContents.send('pin', cfg.alwaysOnTop); });
  startTimer();
}

app.whenReady().then(() => {
  // give the running app (Dock, cmd-tab) the LCARS icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, 'icon.png')); } catch { /* ignore */ }
  }
  applyCaffeinate();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (caffProc) { try { caffProc.kill(); } catch { /* ignore */ } } });

ipcMain.handle('refresh', () => build());
ipcMain.handle('getConfig', () => cfg);
ipcMain.handle('setConfig', (_e, patch) => {
  cfg = { ...cfg, ...patch };
  saveCfg(cfg);
  if ('refreshSec' in patch) startTimer();
  if ('caffeinate' in patch) applyCaffeinate(true);
  push();
  return cfg;
});
ipcMain.on('togglePin', () => {
  cfg.alwaysOnTop = !cfg.alwaysOnTop;
  saveCfg(cfg);
  if (win) win.setAlwaysOnTop(cfg.alwaysOnTop, 'floating');
  if (win) win.webContents.send('pin', cfg.alwaysOnTop);
});
ipcMain.on('dock', () => {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  const b = win.getBounds();
  win.setPosition(
    workArea.x + workArea.width - b.width - 16,
    workArea.y + workArea.height - b.height - 16
  );
});
ipcMain.on('close', () => { if (win) win.close(); });
ipcMain.on('fitHeight', (_e, h) => {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const newH = Math.max(180, Math.min(wa.height - 16, Math.round(h)));
  // growing pushes the window downward — shift it up if the bottom edge
  // would leave the screen (e.g. when docked to a bottom corner)
  let y = b.y;
  const maxY = wa.y + wa.height - 8 - newH;
  if (y > maxY) y = Math.max(wa.y + 8, maxY);
  win.setBounds({ x: b.x, y, width: b.width, height: newH });
});
ipcMain.handle('pingNow', async () => {
  const r = await fireHeartbeat();
  return r;
});
