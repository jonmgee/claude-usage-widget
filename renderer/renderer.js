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
  const today = new Date().toDateString();
  const firedToday = hb.lastAt && new Date(hb.lastAt).toDateString() === today;
  const failedToday = hb.lastError && new Date(hb.lastError.at).toDateString() === today
    && (!hb.lastAt || hb.lastError.at > hb.lastAt);
  const nxt = nextPing(hb.times);
  const parts = [];
  if (failedToday) parts.push(`PING FAILED ${hhmm(hb.lastError.at)}`);
  else if (firedToday) parts.push(`PINGED ${hhmm(hb.lastAt)}`);
  if (nxt) parts.push(`NEXT ${nxt}`);
  el.textContent = `${tri} ` + (parts.length ? parts.join(' \u00B7 ') : 'NO PING TIMES SET');
  el.title = failedToday && hb.lastError.error ? hb.lastError.error : '';
  el.classList.toggle('failed', !!failedToday);
  el.classList.toggle('fired', !failedToday && !!firedToday);
}

// Auto step-down status line
function paintStepdown(d) {
  const el = $('stepline');
  const sd = d.stepdown;
  if (!sd || !sd.enabled) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const tri = '\u25BE';
  if (sd.applied) {
    el.textContent = `${tri} STEPPED DOWN \u2192 ${String(sd.applied).toUpperCase()}`;
    el.classList.add('fired');
    return;
  }
  const pct = d.session ? d.session.pct : null;
  const tiers = (sd.tiers || []).slice().sort((a, b) => a.pct - b.pct);
  const next = tiers.find((t) => pct == null || pct < t.pct);
  el.textContent = next
    ? `${tri} STEP-DOWN AT ${next.pct}% \u2192 ${String(next.model).toUpperCase()}`
    : `${tri} STEP-DOWN ARMED`;
  el.classList.remove('fired');
}

// Reactor skin: annunciator tile grid that lights with usage
function drawAnnunc(d) {
  const pct = d.session ? d.session.pct : null;
  const hbOn = !!(d.heartbeat && d.heartbeat.enabled);
  const tiles = [
    { label: 'REACTOR NORMAL', cls: 'a-green', lit: pct != null && pct < 75 },
    { label: 'HIGH USAGE', cls: 'a-amber', lit: pct != null && pct >= 75 },
    { label: 'SCRAM 90%', cls: 'a-red', lit: pct != null && pct >= 90 },
    { label: 'AUTO PING', cls: 'a-white', lit: hbOn },
  ];
  return tiles.map((t) => `<div class="atile ${t.cls}${t.lit ? ' lit' : ''}">${t.label}</div>`).join('');
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

// ---------- Per-skin centrepiece visualizations ----------

// NIXIE: percentages as real nixie tubes + a brass pressure gauge for weekly
function drawNixie(d) {
  const pct = d.session.pct == null ? '--' : String(d.session.pct);
  const tubes = [...pct].map((ch) => `
    <span style="position:relative;display:inline-flex;align-items:center;justify-content:center;
      width:36px;height:56px;margin:0 2px;
      background:radial-gradient(ellipse at 50% 35%, #241109, #120803 75%);
      border:2px solid rgba(215,235,235,0.3); border-bottom:5px solid #2aa198;
      border-radius:11px 11px 6px 6px; box-shadow: inset 0 0 10px rgba(255,120,20,0.25);">
      <span style="position:absolute;font-family:Georgia,serif;font-size:30px;color:rgba(255,157,60,0.13);">8</span>
      <span style="position:relative;font-family:Georgia,serif;font-size:30px;color:#ff9d3c;
        text-shadow:0 0 8px rgba(255,130,30,1),0 0 20px rgba(255,110,20,0.6);">${ch}</span>
    </span>`).join('');
  const w = d.week.pct == null ? 0 : d.week.pct;
  const ang = -135 + (w / 100) * 270;
  let ticks = '';
  for (let p = 0; p <= 100; p += 10) {
    const a = (-135 + (p / 100) * 270 - 90) * Math.PI / 180;
    const x1 = 45 + 32 * Math.cos(a), y1 = 45 + 32 * Math.sin(a);
    const x2 = 45 + 37 * Math.cos(a), y2 = 45 + 37 * Math.sin(a);
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#4a3018" stroke-width="1.6"/>`;
  }
  const sReset = d.session.active && d.session.reset ? shortCountdown(d.session.reset) : 'IDLE';
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
    <div style="text-align:center;">
      <div style="display:flex;align-items:center;">${tubes}
        <span style="font-family:Georgia,serif;font-size:15px;color:#ff9d3c;text-shadow:0 0 6px rgba(255,130,30,0.8);margin-left:3px;">%</span></div>
      <div style="font-size:10px;color:#c9a883;letter-spacing:0.1em;margin-top:4px;">SESSION \u00B7 RESET ${sReset}</div>
    </div>
    <div style="flex:1;height:6px;background:linear-gradient(#8a5426,#c77b46 45%,#6b3d1a);border-radius:3px;box-shadow:0 1px 2px #000;"></div>
    <div style="text-align:center;">
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r="43" fill="url(#nxbrass)" stroke="#5c3416" stroke-width="2"/>
        <defs><radialGradient id="nxbrass" cx="0.4" cy="0.3"><stop offset="0" stop-color="#e2bd7c"/><stop offset="1" stop-color="#96702f"/></radialGradient></defs>
        <circle cx="45" cy="45" r="36" fill="#f3ead2" stroke="#5c3416" stroke-width="1.5"/>
        ${ticks}
        <text x="45" y="66" font-family="Georgia,serif" font-size="9" fill="#4a3018" text-anchor="middle">WEEKLY</text>
        <text x="45" y="34" font-family="Georgia,serif" font-size="13" fill="#4a3018" text-anchor="middle" font-weight="bold">${w}%</text>
        <g transform="rotate(${ang.toFixed(1)} 45 45)"><polygon points="45,45 43,49 45,14 47,49" fill="#8a1f10"/></g>
        <circle cx="45" cy="45" r="4" fill="#4a3018"/>
      </svg>
    </div>
  </div>`;
}

// SYNTHWAVE: sunset over a perspective grid, usage as a neon EQ bank
function drawSynth(d) {
  const pct = d.session.pct == null ? 0 : d.session.pct;
  const w = d.week.pct == null ? 0 : d.week.pct;
  const N = 18;
  const lit = Math.round((pct / 100) * N);
  let eq = '';
  for (let i = 0; i < N; i++) {
    const h = 14 + 22 * Math.abs(Math.sin(i * 1.7 + 1));
    const x = 14 + i * 13;
    const on = i < lit;
    eq += `<rect x="${x}" y="${(138 - h).toFixed(1)}" width="9" height="${h.toFixed(1)}" rx="2"
      fill="${on ? '#ff2bd6' : 'none'}" stroke="${on ? 'none' : '#3a2470'}" stroke-width="1"
      ${on ? 'style="filter:drop-shadow(0 0 4px rgba(255,43,214,0.8))"' : ''}/>`;
  }
  let grid = '';
  for (const gy of [88, 93, 100, 110, 124]) grid += `<line x1="0" y1="${gy}" x2="260" y2="${gy}" stroke="#ff2bd6" stroke-opacity="0.25" stroke-width="1"/>`;
  for (let i = -6; i <= 6; i++) grid += `<line x1="130" y1="86" x2="${130 + i * 42}" y2="140" stroke="#ff2bd6" stroke-opacity="0.18" stroke-width="1"/>`;
  const wx = 14 + (w / 100) * 232;
  const sReset = d.session.active && d.session.reset ? shortCountdown(d.session.reset) : 'IDLE';
  return `<svg viewBox="0 0 260 150" style="display:block;width:100%">
    <defs>
      <linearGradient id="swsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d0f3d"/><stop offset="1" stop-color="#3d1160"/></linearGradient>
      <linearGradient id="swsun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd76a"/><stop offset="1" stop-color="#ff2bd6"/></linearGradient>
    </defs>
    <rect x="0" y="0" width="260" height="86" fill="url(#swsky)"/>
    <circle cx="130" cy="62" r="26" fill="url(#swsun)"/>
    <rect x="100" y="66" width="60" height="3" fill="#1d0f3d"/><rect x="100" y="73" width="60" height="4" fill="#1d0f3d"/><rect x="100" y="81" width="60" height="5" fill="#1d0f3d"/>
    <polygon points="0,86 40,58 78,86" fill="#170a33"/><polygon points="180,86 224,52 260,86" fill="#170a33"/>
    <text x="8" y="16" fill="#2be8f4" font-size="9" letter-spacing="2" style="text-shadow:0 0 6px rgba(43,232,244,0.8)">SESSION ${pct}%</text>
    <text x="252" y="16" fill="#ff2bd6" font-size="9" letter-spacing="2" text-anchor="end">RESET ${sReset}</text>
    <rect x="0" y="86" width="260" height="64" fill="#10062a"/>
    ${grid}${eq}
    <line x1="${wx.toFixed(1)}" y1="88" x2="${wx.toFixed(1)}" y2="140" stroke="#2be8f4" stroke-width="2" style="filter:drop-shadow(0 0 4px rgba(43,232,244,0.9))"/>
    <text x="${Math.min(224, wx + 4).toFixed(1)}" y="97" fill="#2be8f4" font-size="8">WK ${w}%</text>
  </svg>`;
}

// COCKPIT: primary flight display — attitude ball + two tape instruments
function drawCockpit(d) {
  const pct = d.session.pct == null ? 0 : d.session.pct;
  const w = d.week.pct == null ? 0 : d.week.pct;
  function tape(x, val, label, bugTiers) {
    const y0 = 10, h = 118;
    const yOf = (p) => y0 + h - (p / 100) * h;
    let t = `<rect x="${x}" y="${y0}" width="52" height="${h}" fill="#0d1012" stroke="#3a3d40"/>`;
    for (let p = 0; p <= 100; p += 10) {
      const y = yOf(p);
      t += `<line x1="${x}" y1="${y.toFixed(1)}" x2="${x + 7}" y2="${y.toFixed(1)}" stroke="#cfd4d8" stroke-width="1"/>`;
      if (p % 20 === 0) t += `<text x="${x + 11}" y="${(y + 3).toFixed(1)}" fill="#cfd4d8" font-size="7">${p}</text>`;
    }
    t += `<rect x="${x}" y="${y0}" width="3" height="${((100 - 90) / 100 * h).toFixed(1)}" fill="#ff3b30"/>`;
    for (const b of (bugTiers || [])) {
      t += `<polygon points="${x + 52},${(yOf(b) - 4).toFixed(1)} ${x + 46},${yOf(b).toFixed(1)} ${x + 52},${(yOf(b) + 4).toFixed(1)}" fill="#ff4bd8"/>`;
    }
    const vy = Math.max(y0 + 9, Math.min(y0 + h - 9, yOf(val)));
    t += `<rect x="${x + 2}" y="${(vy - 8).toFixed(1)}" width="40" height="16" fill="#000" stroke="#ffb300"/>
      <text x="${x + 22}" y="${(vy + 4).toFixed(1)}" fill="#ffb300" font-size="11" font-family="Menlo,monospace" text-anchor="middle">${val}</text>
      <text x="${x + 26}" y="${y0 + h + 11}" fill="#35e0e8" font-size="8" text-anchor="middle" letter-spacing="1">${label}</text>`;
    return t;
  }
  const tiers = (d.stepdown && d.stepdown.enabled ? d.stepdown.tiers || [] : []).map((t) => t.pct);
  const sReset = d.session.active && d.session.reset ? shortCountdown(d.session.reset) : 'IDLE';
  return `<svg viewBox="0 0 260 150" style="display:block;width:100%">
    <clipPath id="ball"><rect x="80" y="10" width="100" height="100" rx="8"/></clipPath>
    <g clip-path="url(#ball)">
      <rect x="80" y="10" width="100" height="50" fill="#2b7fd4"/>
      <rect x="80" y="60" width="100" height="50" fill="#8a5a2b"/>
      <line x1="80" y1="60" x2="180" y2="60" stroke="#fff" stroke-width="1.5"/>
      <line x1="115" y1="42" x2="145" y2="42" stroke="#fff" stroke-width="1"/><text x="108" y="45" fill="#fff" font-size="6">10</text>
      <line x1="120" y1="51" x2="140" y2="51" stroke="#fff" stroke-width="1"/>
      <line x1="120" y1="69" x2="140" y2="69" stroke="#fff" stroke-width="1"/>
      <line x1="115" y1="78" x2="145" y2="78" stroke="#fff" stroke-width="1"/><text x="108" y="81" fill="#fff" font-size="6">10</text>
    </g>
    <path d="M105 60 h20 l5 6 5-6 h20" fill="none" stroke="#ffd21e" stroke-width="3"/>
    <rect x="80" y="10" width="100" height="100" rx="8" fill="none" stroke="#3a3d40" stroke-width="2"/>
    <text x="130" y="124" fill="#23d160" font-size="8" text-anchor="middle" font-family="Menlo,monospace">RESET ${sReset}</text>
    <text x="130" y="137" fill="#35e0e8" font-size="7" text-anchor="middle">${d.week.reset ? 'WK ' + shortDay(d.week.reset) : ''}</text>
    ${tape(10, pct, 'SESSION', tiers)}
    ${tape(196, w, 'WEEKLY', [])}
  </svg>`;
}

// GAME BOY: session usage as a Tetris well; stats panel on the right
function drawGameboy(d) {
  const C = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
  const pct = d.session.pct == null ? 0 : d.session.pct;
  const w = d.week.pct == null ? 0 : d.week.pct;
  const cols = 10, rows = 12, cell = 11;
  const filledRows = Math.round((pct / 100) * rows);
  let cells = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const filled = r >= rows - filledRows;
      const hash = (r * 31 + c * 17 + 7) % 5;
      if (filled && hash !== 4) {
        cells += `<rect x="${12 + c * cell}" y="${12 + r * cell}" width="${cell - 1}" height="${cell - 1}" fill="${hash % 2 ? C[0] : C[1]}"/>
          <rect x="${14 + c * cell}" y="${14 + r * cell}" width="${cell - 5}" height="${cell - 5}" fill="none" stroke="${C[3]}" stroke-width="1"/>`;
      }
    }
  }
  let piece = '';
  for (const [px, py] of [[4, 0], [5, 0], [5, 1], [6, 1]]) {
    piece += `<rect x="${12 + px * cell}" y="${12 + py * cell}" width="${cell - 1}" height="${cell - 1}" fill="${C[0]}"/>`;
  }
  let bricks = '';
  for (let r = 0; r < 13; r++) {
    bricks += `<rect x="2" y="${10 + r * cell}" width="8" height="${cell - 2}" fill="none" stroke="${C[0]}" stroke-width="1.5"/>
      <rect x="${12 + cols * cell + 1}" y="${10 + r * cell}" width="8" height="${cell - 2}" fill="none" stroke="${C[0]}" stroke-width="1.5"/>`;
  }
  function box(y, label, value) {
    return `<rect x="146" y="${y}" width="104" height="34" fill="none" stroke="${C[0]}" stroke-width="2"/>
      <rect x="148.5" y="${y + 2.5}" width="99" height="29" fill="none" stroke="${C[0]}" stroke-width="1"/>
      <text x="198" y="${y + 14}" fill="${C[0]}" font-size="9" text-anchor="middle" font-family="Courier New,monospace" font-weight="bold">${label}</text>
      <text x="198" y="${y + 28}" fill="${C[0]}" font-size="12" text-anchor="middle" font-family="Courier New,monospace" font-weight="bold">${value}</text>`;
  }
  const sReset = d.session.active && d.session.reset ? shortCountdown(d.session.reset) : 'IDLE';
  return `<svg viewBox="0 0 260 152" style="display:block;width:100%">
    ${bricks}
    <rect x="11" y="11" width="${cols * cell + 1}" height="${rows * cell + 1}" fill="none" stroke="${C[0]}" stroke-width="1.5"/>
    ${cells}${piece}
    ${box(11, 'SESSION', pct + '%')}
    ${box(55, 'WEEKLY', w + '%')}
    ${box(99, 'RESET', sReset)}
    <text x="198" y="148" fill="${C[1]}" font-size="8" text-anchor="middle" font-family="Courier New,monospace" font-weight="bold">${fmtTokens(d.session.tokens || 0)} TOK</text>
  </svg>`;
}

// REACTOR: industrial edgewise needle meters on cream scale plates
function drawReactorMeters(d) {
  function meter(x, val, label) {
    const v = val == null ? 0 : val;
    let t = '';
    for (let p = 0; p <= 100; p += 10) {
      const a = (-50 + (p / 100) * 100 - 90) * Math.PI / 180;
      const x1 = x + 59 + 44 * Math.cos(a), y1 = 78 + 44 * Math.sin(a);
      const x2 = x + 59 + 51 * Math.cos(a), y2 = 78 + 51 * Math.sin(a);
      t += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#2a2a24" stroke-width="${p % 20 ? 1 : 1.8}"/>`;
      if (p % 20 === 0) {
        const xt = x + 59 + 58 * Math.cos(a), yt = 78 + 58 * Math.sin(a);
        t += `<text x="${xt.toFixed(1)}" y="${(yt + 2.5).toFixed(1)}" fill="#2a2a24" font-size="7" text-anchor="middle">${p}</text>`;
      }
    }
    const a0 = (-50 + 90 - 90) * Math.PI / 180, a1 = (50 - 90) * Math.PI / 180;
    const rx0 = x + 59 + 47.5 * Math.cos(a0), ry0 = 78 + 47.5 * Math.sin(a0);
    const rx1 = x + 59 + 47.5 * Math.cos(a1), ry1 = 78 + 47.5 * Math.sin(a1);
    t += `<path d="M ${rx0.toFixed(1)} ${ry0.toFixed(1)} A 47.5 47.5 0 0 1 ${rx1.toFixed(1)} ${ry1.toFixed(1)}" fill="none" stroke="#c0392b" stroke-width="6"/>`;
    const na = -50 + (Math.max(0, Math.min(100, v)) / 100) * 100;
    return `<rect x="${x}" y="8" width="118" height="86" rx="4" fill="#efe8d2" stroke="#3d4a44" stroke-width="3"/>
      ${t}
      <g transform="rotate(${na.toFixed(1)} ${x + 59} 78)"><polygon points="${x + 59},78 ${x + 57},80 ${x + 59},32 ${x + 61},80" fill="#1a1a16"/></g>
      <circle cx="${x + 59}" cy="78" r="4.5" fill="#3d4a44"/>
      <line x1="${x + 8}" y1="20" x2="${x + 44}" y2="14" stroke="rgba(255,255,255,0.45)" stroke-width="3"/>
      <rect x="${x + 24}" y="96" width="70" height="15" fill="#10201a"/>
      <text x="${x + 59}" y="107" fill="#e6efe9" font-size="8" text-anchor="middle" letter-spacing="1">${label} ${v}%</text>`;
  }
  const sReset = d.session.active && d.session.reset ? shortCountdown(d.session.reset) : 'IDLE';
  return `<svg viewBox="0 0 260 126" style="display:block;width:100%">
    ${meter(4, d.session.pct, 'SESSION')}
    ${meter(138, d.week.pct, 'WEEKLY')}
    <text x="130" y="122" fill="#3d554b" font-size="8" text-anchor="middle">RESET ${sReset}${d.week.reset ? ' \u00B7 WK ' + shortDay(d.week.reset) : ''}</text>
  </svg>`;
}

const SKIN_VIZ = { nixie: drawNixie, synth: drawSynth, cockpit: drawCockpit, gameboy: drawGameboy, reactor: drawReactorMeters };

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
const FOOTCODES = { lcars: 'LCARS 24-47', dash: 'EB 16.4', term: 'READY.', scribble: 'p.1 \u00B7 draft', enigma: 'ENIGMA I \u00B7 Nr. A16247', nixie: 'IN-14 \u00B7 EST. 1897', synth: 'NEON DREAMS \u00B7 2087', cockpit: 'B737-8 \u00B7 G-JONG', gameboy: 'DMG-01', reactor: 'UNIT 1 \u00B7 CTRL RM' };
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
  if (curSkin === 'reactor') $('annunc').innerHTML = drawAnnunc(d);
  if (SKIN_VIZ[curSkin]) $('skinviz').innerHTML = SKIN_VIZ[curSkin](d);

  setBar('s-fill', 's-pct', d.session.pct);
  $('s-reset').textContent = d.session.active && d.session.reset
    ? countdown(d.session.reset)
    : 'Session idle';
  $('s-abs').textContent = d.session.tokens ? fmtTokens(d.session.tokens) + ' tok' : '';

  setBar('w-fill', 'w-pct', d.week.pct);
  $('w-reset').textContent = d.week.reset ? resetDay(d.week.reset) : '';
  $('w-abs').textContent = d.week.tokens ? fmtTokens(d.week.tokens) + ' tok' : '';

  paintPing(d);
  paintStepdown(d);
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

// --- step-down tier editor ---
const SD_MODELS = ['opus', 'sonnet', 'haiku'];
function addTierRow(t) {
  const row = document.createElement('div');
  row.className = 'srow sdrow';
  const opts = SD_MODELS.map((m) =>
    `<option value="${m}"${t && t.model === m ? ' selected' : ''}>${m.toUpperCase()}</option>`).join('');
  row.innerHTML = '<label>AT %</label><span class="hbwrap">' +
    `<input type="number" class="sd-pct" min="1" max="99" step="1" value="${t ? t.pct : ''}">` +
    `<select class="sd-model">${opts}</select>` +
    '<button class="hbdel" title="Remove this tier">\u2715</button></span>';
  row.querySelector('.hbdel').onclick = () => { row.remove(); fit(); };
  $('sd-tiers').appendChild(row);
}
function setTierRows(tiers) {
  $('sd-tiers').innerHTML = '';
  const list = tiers && tiers.length ? tiers
    : [{ pct: 50, model: 'opus' }, { pct: 75, model: 'sonnet' }, { pct: 90, model: 'haiku' }];
  for (const t of list) addTierRow(t);
}
function readTierRows() {
  const out = [];
  for (const row of document.querySelectorAll('#sd-tiers .sdrow')) {
    const pct = Number(row.querySelector('.sd-pct').value);
    const model = row.querySelector('.sd-model').value;
    if (pct >= 1 && pct <= 99 && model) out.push({ pct, model });
  }
  out.sort((a, b) => a.pct - b.pct);
  return out;
}
$('sd-add').onclick = () => { addTierRow(null); fit(); };
$('sd-restore').onclick = async () => {
  const btn = $('sd-restore');
  await window.api.restoreModel();
  btn.textContent = 'RESTORED \u2713';
  setTimeout(() => { btn.textContent = 'RESTORE MODEL NOW'; }, 2000);
};

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
    $('sd-on').checked = !!c.stepdownEnabled;
    setTierRows(c.stepdownTiers);
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
    stepdownEnabled: $('sd-on').checked,
    stepdownTiers: readTierRows(),
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
