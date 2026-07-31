const $ = (id) => document.getElementById(id);

function fmtTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

// pct is the real plan percentage from the Claude app's usage cache
function setBar(fillId, pctId, pct) {
  const p = pct == null ? null : Math.max(0, Math.min(100, pct));
  $(fillId).style.width = (p == null ? 0 : p) + '%';
  $(pctId).textContent = p == null ? '--' : p + '%';
  $(fillId).classList.toggle('alert', p != null && p >= 90);
}

function countdown(ms) {
  const d = ms - Date.now();
  if (d <= 0) return 'RESETS NOW';
  const mins = Math.round(d / 60000);
  if (mins < 60) return `Resets in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `Resets in ${h}h${m ? ' ' + m + 'm' : ''}`;
}

function resetDay(ms) {
  const dt = new Date(ms);
  const day = dt.toLocaleDateString(undefined, { weekday: 'short' });
  const time = dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `Resets ${day} ${time}`;
}

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

let last = null;

// Ask the main process to resize the window to fit the card (it grows/shrinks as
// the monitor or settings panels open and close).
function fit() {
  requestAnimationFrame(() => {
    const card = document.getElementById('card');
    if (!card || !window.api.fitHeight) return;
    window.api.fitHeight(Math.ceil(card.getBoundingClientRect().height) + 16);
  });
}

function paintFooter(d) {
  if (!d.live) {
    $('updated').textContent = 'NO LIVE DATA';
    $('updated').classList.add('stale');
    return;
  }
  // the cache only advances while the Claude desktop app is running
  const staleMin = (Date.now() - d.sampledAt) / 60000;
  $('updated').textContent = (staleMin > 20 ? 'STALE ' : 'LIVE ') + ago(d.sampledAt);
  $('updated').classList.toggle('stale', staleMin > 20);
}

function hhmm(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Next upcoming ping among the configured times (today, else first one tomorrow)
function nextPing(times) {
  const list = (times || []).filter(Boolean).slice().sort();
  if (!list.length) return null;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  for (const t of list) {
    const [h, m] = t.split(':').map(Number);
    if (h * 60 + m > cur) return t;
  }
  return list[0]; // tomorrow's first
}

function paintPing(d) {
  const el = $('pingline');
  const hb = d.heartbeat;
  if (!hb || !hb.enabled) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const tri = '\u25B8'; // U+25B8 escape so file encoding can't mangle it
  if (!hb.available) { el.textContent = `${tri} CLI NOT FOUND`; el.classList.remove('fired'); return; }
  const firedToday = hb.lastAt && new Date(hb.lastAt).toDateString() === new Date().toDateString();
  const nxt = nextPing(hb.times);
  const parts = [];
  if (firedToday) parts.push(`PINGED ${hhmm(hb.lastAt)}`);
  if (nxt) parts.push(`NEXT ${nxt}`);
  el.textContent = `${tri} ` + (parts.length ? parts.join(' \u00B7 ') : 'NO PING TIMES SET');
  el.classList.toggle('fired', !!firedToday);
}

// Draw an ECG-style trace: flat baseline with a QRS spike at each ping, over a
// 24-hour window, time axis along the bottom.
function drawECG(history) {
  const W = 260, H = 84, B = 42;
  const now = Date.now();
  const win = 24 * 3600e3;
  const start = now - win;
  const xOf = (t) => ((t - start) / win) * W;
  const pings = (history || []).filter((t) => t >= start && t <= now).sort((a, b) => a - b);

  // one heartbeat waveform, relative to its centre (negative y = up)
  const beat = [[-13, 0], [-10, -4], [-7, 0], [-3, 4], [0, -30], [3, 9], [6, 0], [10, -7], [13, 0]];
  const pts = [[0, B]];
  for (const t of pings) {
    const cx = xOf(t);
    pts.push([cx - 15, B]);
    for (const [dx, dy] of beat) pts.push([cx + dx, B + dy]);
    pts.push([cx + 15, B]);
  }
  pts.push([W, B]);
  pts.sort((a, b) => a[0] - b[0]);
  const poly = pts.map((p) => `${p[0].toFixed(1)},${Math.max(2, Math.min(H - 12, p[1])).toFixed(1)}`).join(' ');

  // vertical grid on real 3-hour clock boundaries; labels every 6h as clock times
  const HOUR = 3600e3;
  const lastHour = Math.floor(now / HOUR) * HOUR;
  let grid = '';
  for (let t = lastHour; t >= start; t -= 3 * HOUR) {
    const gx = xOf(t);
    grid += `<line x1="${gx.toFixed(1)}" y1="0" x2="${gx.toFixed(1)}" y2="${H - 11}" style="stroke:var(--ecg-grid)" stroke-width="1"/>`;
  }
  for (let gy = 0; gy <= H - 11; gy += (H - 11) / 4) grid += `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" style="stroke:var(--ecg-grid)" stroke-width="1"/>`;

  let labels = '';
  for (let t = lastHour; t >= start; t -= 6 * HOUR) {
    const x = Math.min(W - 8, Math.max(8, xOf(t)));
    const hh = String(new Date(t).getHours()).padStart(2, '0');
    labels += `<text x="${x.toFixed(1)}" y="${H - 2}" style="fill:var(--ecg-label)" font-size="7" text-anchor="middle">${hh}:00</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Heartbeat ECG">
    ${grid}
    <polyline points="${poly}" fill="none" stroke="var(--ecg)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${W - 2}" cy="${B}" r="2" fill="var(--ecg)"><animate attributeName="opacity" values="1;0.2;1" dur="1.1s" repeatCount="indefinite"/></circle>
    ${labels}
  </svg>`;
}

function renderMonitor(d) {
  const hb = d.heartbeat || {};
  const hist = hb.history && hb.history.length ? hb.history : (hb.lastAt ? [hb.lastAt] : []);
  $('ecg').innerHTML = drawECG(hist);
  const now = Date.now();
  const in24 = hist.filter((t) => t >= now - 24 * 3600e3).length;
  const lastAt = hist.length ? hist[hist.length - 1] : null;
  $('ecg-cap').textContent = lastAt
    ? `LAST BEAT ${hhmm(lastAt)} \u00B7 ${in24} IN 24H`
    : 'NO BEATS \u00B7 MONITORING';
}

// ---------- Dashboard skin: Bugatti-style gauges ----------
function shortCountdown(ms) {
  if (!ms) return '';
  const mins = Math.max(0, Math.round((ms - Date.now()) / 60000));
  const h = Math.floor(mins / 60);
  return h ? `${h}H ${mins % 60}M` : `${mins}M`;
}
function shortDay(ms) {
  if (!ms) return '';
  const dt = new Date(ms);
  return (dt.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' +
    dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })).toUpperCase();
}

function drawDash(d) {
  const D2R = Math.PI / 180;
  const onC = (cx, cy, r, a) => [cx + r * Math.cos((a - 90) * D2R), cy + r * Math.sin((a - 90) * D2R)];
  const A0 = 225, SWEEP = 270, RED = 90;
  const angAt = (p) => A0 + (Math.max(0, Math.min(100, p)) / 100) * SWEEP;

  function gauge(cx, cy, r, pct, label, sub, big) {
    const val = pct == null ? 0 : pct;
    let s = '';
    for (let p = 0; p <= 100; p += (big ? 2 : 5)) {
      const a = angAt(p), major = p % 20 === 0;
      const [x1, y1] = onC(cx, cy, r - (major ? 11 : 6), a);
      const [x2, y2] = onC(cx, cy, r - 1, a);
      const col = p >= RED ? '#ff3b30' : (major ? '#eef3f8' : '#828c98');
      s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="${major ? 2 : 1}"/>`;
      if (major && big && p !== 0 && p !== 100) {
        const [nx, ny] = onC(cx, cy, r - 21, a);
        s += `<text x="${nx.toFixed(1)}" y="${(ny + 3).toFixed(1)}" fill="#aab4c0" font-size="8" text-anchor="middle">${p}</text>`;
      }
    }
    const [rx0, ry0] = onC(cx, cy, r - 1, angAt(RED));
    const [rx1, ry1] = onC(cx, cy, r - 1, angAt(100));
    s += `<path d="M ${rx0.toFixed(1)} ${ry0.toFixed(1)} A ${r - 1} ${r - 1} 0 0 1 ${rx1.toFixed(1)} ${ry1.toFixed(1)}" fill="none" stroke="#ff3b30" stroke-width="3"/>`;
    const a = angAt(val);
    const [tx, ty] = onC(cx, cy, r - 13, a);
    const [lx, ly] = onC(cx, cy, 3, a + 90);
    const [rrx, rry] = onC(cx, cy, 3, a - 90);
    const [tlx, tly] = onC(cx, cy, big ? 13 : 9, a + 180);
    const lw = big ? 66 : 52, lh = 24, ly0 = cy + (big ? 24 : 18);
    const digit = pct == null ? '--' : pct + '%';
    return `
      <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="url(#chrome)" stroke-width="8"/>
      <circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="url(#face)"/>
      ${s}
      <text x="${cx}" y="${(cy - r * 0.28).toFixed(1)}" fill="#7d8894" font-size="${big ? 9 : 8}" text-anchor="middle" letter-spacing="2">${label}</text>
      <rect x="${cx - lw / 2}" y="${ly0}" width="${lw}" height="${lh}" rx="4" fill="#071019" stroke="#1d3a56"/>
      <text x="${cx}" y="${ly0 + 12}" fill="#84d6ff" font-size="12" font-weight="500" text-anchor="middle">${digit}</text>
      ${sub ? `<text x="${cx}" y="${ly0 + 21}" fill="#3f6f92" font-size="6.5" text-anchor="middle" letter-spacing="0.5">${sub}</text>` : ''}
      <polygon points="${lx.toFixed(1)},${ly.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)} ${rrx.toFixed(1)},${rry.toFixed(1)} ${tlx.toFixed(1)},${tly.toFixed(1)}" fill="#ff3b30"/>
      <circle cx="${cx}" cy="${cy}" r="${big ? 6 : 5}" fill="url(#hub)" stroke="#2a2f36"/>`;
  }

  const sSub = d.session.active && d.session.reset ? 'RESET ' + shortCountdown(d.session.reset) : 'IDLE';
  const wSub = d.week.reset ? shortDay(d.week.reset) : '';
  return `<svg viewBox="0 0 260 158" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%">
    <defs>
      <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f4f7fa"/><stop offset="0.35" stop-color="#aeb7c2"/>
        <stop offset="0.55" stop-color="#5c646f"/><stop offset="0.75" stop-color="#89929d"/><stop offset="1" stop-color="#d6dde5"/>
      </linearGradient>
      <radialGradient id="face" cx="0.5" cy="0.4" r="0.68">
        <stop offset="0" stop-color="#161b23"/><stop offset="0.7" stop-color="#0a0e14"/><stop offset="1" stop-color="#04060a"/>
      </radialGradient>
      <linearGradient id="hub" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef2f6"/><stop offset="1" stop-color="#6b7480"/></linearGradient>
    </defs>
    ${gauge(78, 72, 60, d.session.pct, 'SESSION', sSub, true)}
    ${gauge(202, 78, 46, d.week.pct, 'WEEKLY', wSub, false)}
  </svg>`;
}

let curSkin = 'lcars';
const FOOTCODES = { lcars: 'LCARS 24-47', dash: 'EB 16.4', term: 'READY.', scribble: 'p.1 \u00B7 draft', enigma: 'ENIGMA I \u00B7 Nr. A16247' };
function applySkin(s) {
  curSkin = s || 'lcars';
  const card = document.getElementById('card');
  if (card.dataset.skin !== curSkin) card.dataset.skin = curSkin;
  const fc = document.querySelector('.foot-code');
  if (fc) fc.textContent = FOOTCODES[curSkin] || FOOTCODES.lcars;
}

function render(d) {
  last = d;
  if (d.skin) applySkin(d.skin);
  if (d.plan) $('plan').textContent = d.plan;
  if (curSkin === 'dash') $('gauges').innerHTML = drawDash(d);

  setBar('s-fill', 's-pct', d.session.pct);
  $('s-reset').textContent = d.session.active && d.session.reset
    ? countdown(d.session.reset)
    : 'Session idle';
  $('s-abs').textContent = d.session.tokens ? fmtTokens(d.session.tokens) + ' tok' : '';

  setBar('w-fill', 'w-pct', d.week.pct);
  $('w-reset').textContent = d.week.reset ? resetDay(d.week.reset) : '';
  $('w-abs').textContent = d.week.tokens ? fmtTokens(d.week.tokens) + ' tok' : '';

  paintPing(d);
  if (!$('monitor').classList.contains('hidden')) renderMonitor(d);
  paintFooter(d);
  fit();
}

window.api.onUsage(render);
window.api.onPin((on) => {
  $('pin').classList.toggle('dim', !on);
});

// keep the countdown + staleness ticking between refreshes
setInterval(() => {
  if (!last) return;
  if (last.session.active && last.session.reset) $('s-reset').textContent = countdown(last.session.reset);
  paintFooter(last);
}, 30000);

// --- controls ---
$('refresh').onclick = async () => { render(await window.api.refresh()); };
$('pin').onclick = () => window.api.togglePin();
$('dock').onclick = () => window.api.dock();
$('close').onclick = () => window.api.close();

$('mon-btn').onclick = () => {
  const m = $('monitor'); // the panel (button is #mon-btn — distinct ids)
  m.classList.toggle('hidden');
  if (!m.classList.contains('hidden') && last) renderMonitor(last);
  fit();
};

// --- ping-time list editor ---
function addTimeRow(val) {
  const row = document.createElement('div');
  row.className = 'srow hbrow';
  row.innerHTML = '<label>PING AT</label><span class="hbwrap">' +
    `<input type="time" value="${val || ''}">` +
    '<button class="hbdel" title="Remove this ping">\u2715</button></span>';
  row.querySelector('.hbdel').onclick = () => { row.remove(); fit(); };
  $('hb-times').appendChild(row);
}
function setTimeRows(times) {
  $('hb-times').innerHTML = '';
  for (const t of (times && times.length ? times : ['15:30'])) addTimeRow(t);
}
function readTimeRows() {
  const vals = [...document.querySelectorAll('#hb-times input[type="time"]')]
    .map((i) => i.value).filter(Boolean);
  return [...new Set(vals)].sort();
}
$('hb-add').onclick = () => { addTimeRow(''); fit(); };

// skin applies instantly on change — no save needed
$('skin').onchange = () => { window.api.setConfig({ skin: $('skin').value || 'lcars' }); };

$('gear').onclick = async () => {
  const s = $('settings');
  if (s.classList.contains('hidden')) {
    const c = await window.api.getConfig();
    $('b-refresh').value = c.refreshSec;
    $('hb-on').checked = !!c.heartbeatEnabled;
    setTimeRows(c.heartbeatTimes);
    $('caff').value = c.caffeinate || 'off';
    $('skin').value = c.skin || 'lcars';
  }
  s.classList.toggle('hidden');
  fit();
};

$('save').onclick = async () => {
  await window.api.setConfig({
    refreshSec: Math.max(15, Number($('b-refresh').value)),
    heartbeatEnabled: $('hb-on').checked,
    heartbeatTimes: readTimeRows(),
    caffeinate: $('caff').value || 'off',
  });
  $('settings').classList.add('hidden');
  fit();
};

$('pingnow').onclick = async () => {
  const btn = $('pingnow');
  const orig = btn.textContent;
  btn.textContent = 'PINGING\u2026';
  btn.disabled = true;
  const r = await window.api.pingNow();
  btn.textContent = r && r.ok ? 'PINGED \u2713' : 'FAILED';
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2500);
};
