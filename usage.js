// Usage data for the widget.
//
// PRIMARY SOURCE: ~/Library/Application Support/Claude/plan-usage-history.json
//   The Claude desktop app samples your real plan usage every ~5 min and stores it:
//     { t: <ms>, org: <id>, u: { fh: <session %>, sd: <weekly %>, xu: <credits %> } }
//   These are the exact percentages shown in the app's own usage panel.
//
// SECONDARY: ~/.claude/projects/**/*.jsonl (Claude Code logs) — used only to work out
//   the current 5-hour session window (for the reset countdown) and token counts.
//
// No network calls are made.
const fs = require('fs');
const path = require('path');
const os = require('os');

const H = 3600e3;
const D = 86400e3;

// The Claude desktop app's data folder differs per platform.
function claudeAppDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Claude');
}
const PLAN_USAGE = path.join(claudeAppDir(), 'plan-usage-history.json');

// ---------- real plan usage (the numbers the app itself shows) ----------
function readPlanUsage() {
  let j;
  try { j = JSON.parse(fs.readFileSync(PLAN_USAGE, 'utf8')); } catch { return null; }
  const s = Array.isArray(j && j.samples) ? j.samples : [];
  if (!s.length) return null;
  const last = s[s.length - 1];
  if (!last || !last.u) return null;

  // Weekly window boundary: a reset shows up as sd dropping to 0. Roll it forward a
  // week at a time so an older boundary still yields the right upcoming reset.
  let boundary = null;
  let prev = null;
  for (const x of s) {
    const v = x.u && typeof x.u.sd === 'number' ? x.u.sd : null;
    if (prev !== null && v === 0 && prev > 0) boundary = x.t;
    if (v !== null) prev = v;
  }
  let weekReset = null;
  if (boundary) {
    weekReset = boundary;
    while (weekReset <= Date.now()) weekReset += 7 * D;
  }

  return {
    sessionPct: typeof last.u.fh === 'number' ? last.u.fh : null,
    weekPct: typeof last.u.sd === 'number' ? last.u.sd : null,
    creditsPct: typeof last.u.xu === 'number' ? last.u.xu : null,
    sampledAt: last.t,
    weekReset,
  };
}

// ---------- Claude Code logs (session window + token counts) ----------
function listLogs() {
  const base = path.join(os.homedir(), '.claude', 'projects');
  const out = [];
  (function walk(dir) {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) walk(p);
      else if (it.isFile() && p.endsWith('.jsonl')) out.push(p);
    }
  })(base);
  return out;
}

function readEntries() {
  const entries = [];
  for (const f of listLogs()) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (d.type !== 'assistant') continue;
      const m = d.message || {};
      const u = m.usage;
      if (!u || !d.timestamp) continue;
      if (m.model === '<synthetic>') continue;
      const t = Date.parse(d.timestamp);
      if (!t) continue;
      // Cache reads are ~93% of raw token volume and are cheap re-reads of context,
      // so they are excluded from the headline "work done" figure.
      const work = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
      entries.push({ t, work });
    }
  }
  entries.sort((a, b) => a.t - b.t);
  return entries;
}

// 5-hour session blocks anchored on the first message (NOT floored to the hour —
// flooring pushed the reset countdown out by up to an hour).
function sessionWindow(entries, now) {
  let start = null;
  for (const e of entries) {
    if (start === null || e.t >= start + 5 * H) start = e.t;
  }
  if (start === null) return { start: null, reset: null, tokens: 0, active: false };
  const reset = start + 5 * H;
  const active = now < reset;
  const tokens = active ? entries.filter((e) => e.t >= start).reduce((s, e) => s + e.work, 0) : 0;
  return { start, reset, tokens, active };
}

// opts.heartbeatAt: ms timestamp of a ping the widget fired. A ping starts a real
// 5-hour window server-side but isn't written to the logs, so we fold it in as a
// zero-work entry so the reset countdown reflects it.
function compute(opts = {}) {
  const now = Date.now();
  const live = readPlanUsage();
  const entries = readEntries();
  if (opts.heartbeatAt) {
    entries.push({ t: opts.heartbeatAt, work: 0 });
    entries.sort((a, b) => a.t - b.t);
  }
  const win = sessionWindow(entries, now);
  const weekTokens = entries.filter((e) => e.t >= now - 7 * D).reduce((s, e) => s + e.work, 0);

  return {
    // true when we have the real percentages from the desktop app's cache
    live: !!live,
    // how stale that sample is (the app only writes this while it is running)
    sampledAt: live ? live.sampledAt : null,
    session: {
      pct: live ? live.sessionPct : null,
      reset: win.reset,
      active: win.active,
      tokens: win.tokens,
    },
    week: {
      pct: live ? live.weekPct : null,
      reset: live ? live.weekReset : null,
      tokens: weekTokens,
    },
    credits: live ? live.creditsPct : null,
    updatedAt: now,
  };
}

module.exports = { compute, PLAN_USAGE };
