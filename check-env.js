// Diagnostic: run `node check-env.js` to see what the widget can find on this
// machine. Prints only paths and counts - no message content, nothing sent anywhere.
const fs = require('fs');
const path = require('path');
const os = require('os');

function claudeAppDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Claude');
}

const ok = (b) => (b ? 'FOUND    ' : 'MISSING  ');
console.log('platform :', process.platform, '| node', process.version);
console.log('home     :', os.homedir());
console.log('');

const appDir = claudeAppDir();
console.log(ok(fs.existsSync(appDir)), 'Claude app data dir :', appDir);
if (fs.existsSync(appDir)) {
  const names = fs.readdirSync(appDir).filter((f) => f.toLowerCase().endsWith('.json'));
  console.log('           json files there:', names.join(', ') || '(none)');
}

const usage = path.join(appDir, 'plan-usage-history.json');
console.log(ok(fs.existsSync(usage)), 'plan-usage-history  :', usage);
if (fs.existsSync(usage)) {
  try {
    const j = JSON.parse(fs.readFileSync(usage, 'utf8'));
    const s = j.samples || [];
    console.log('           samples:', s.length, '| newest sample keys:', s.length ? JSON.stringify(s[s.length - 1].u) : 'n/a');
  } catch (e) { console.log('           could not parse:', e.message); }
}

const projects = path.join(os.homedir(), '.claude', 'projects');
console.log(ok(fs.existsSync(projects)), 'Claude Code logs    :', projects);
const settings = path.join(os.homedir(), '.claude', 'settings.json');
console.log(ok(fs.existsSync(settings)), 'Claude Code settings:', settings);
const acct = path.join(os.homedir(), '.claude.json');
console.log(ok(fs.existsSync(acct)), 'account config      :', acct);

console.log('');
const home = os.homedir();
const cands = process.platform === 'win32'
  ? [path.join(home, '.local', 'bin', 'claude.exe'), path.join(home, '.local', 'bin', 'claude.cmd'),
     path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
     path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe')]
  : [path.join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
let found = false;
for (const c of cands) {
  const has = c && fs.existsSync(c);
  if (has) found = true;
  console.log(ok(has), 'CLI candidate       :', c);
}
console.log('');
console.log(found ? 'Auto-ping + step-down should work.' : 'No Claude Code CLI found - auto-ping/step-down will be disabled.');
