# Claude usage widget

A small floating desktop widget that shows your Claude Code usage — current 5-hour
session and weekly (all models + Fable) — without opening the usage panel each time.
It floats on top of your windows, or you can un-pin it to sit under them.

![widget](preview.html)

## Launch it

**From the Desktop (no terminal):** double-click **Claude Usage** (the LCARS icon)
on your Desktop. That's it. If macOS ever blocks it the first time, right-click the
icon → **Open** → **Open**.

**From the terminal:**

```bash
cd ~/Applications/claude-usage-widget
npm install     # first time only — downloads Electron (~150 MB)
npm start
```

A compact card appears. Drag it anywhere by its top bar.

### Location note

The project lives in `~/Applications/claude-usage-widget` (NOT the Desktop). macOS
privacy protection (TCC) blocks Finder-launched apps from reading Desktop files,
which made the double-click launcher fail with `EPERM` when the folder was on the
Desktop. `~/Applications` is unprotected, so the launcher works without any
permission prompts.

### The Desktop launcher

`~/Desktop/Claude Usage.app` is a small AppleScript app that runs this project's
Electron binary directly. Its `appDir` points at `~/Applications/claude-usage-widget`.
If you move this folder, update that path: edit the AppleScript, recompile the
script, and swap it into `Claude Usage.app/Contents/Resources/Scripts/main.scpt`.

## The buttons (LCARS function rail, left side)

| Icon | Does |
|------|------|
| ↻ refresh | Re-read the usage data now |
| ∿ pulse | Toggle the heartbeat monitor (ECG readout of pings) |
| 📌 pushpin | Toggle "always float on top" vs "lie below other windows" (dims when un-pinned) |
| ▣ corner | Dock — snap to the bottom-right corner of your screen |
| ⚙ cog | Settings — auto-ping and refresh interval |
| ✕ | Close |

## Auto-ping (window scheduling)

The 5-hour session window starts on your *first* message and resets 5 hours later.
Auto-ping exploits that: at times you choose (⚙ → AUTO-PING), the widget sends a
tiny Haiku message to **start a window early**, so it resets while you're still
working — giving you two full session allowances across an evening instead of one.

- **Multiple ping times**: add as many as you like (+ ADD PING TIME) — e.g. one a
  couple of hours before you get up, another before you get home. Remove with ✕.
- Each fires **only if no window is already active** (otherwise the ping is wasted),
  and each time slot fires at most once per day.
- It gives **no extra weekly quota** — this is window *scheduling*, not a cap bypass.
- Needs the Claude Code CLI at `~/.local/bin/claude` (auto-detected).
- **PING NOW** in settings fires one immediately.

### Auto step-down (model tiers)

As your session fills up, the widget can automatically switch Claude Code's
default model to something cheaper, so you don't burn the last of a window on the
big model. ⚙ → AUTO STEP-DOWN, then set tiers — e.g.:

- at **50%** → **Opus**
- at **75%** → **Sonnet**
- at **90%** → **Haiku**

Add/remove tiers freely (any thresholds, any of Opus/Sonnet/Haiku). The highest
crossed tier wins. The widget shows its state on the card: `STEP-DOWN AT 50% →
OPUS` when armed, `STEPPED DOWN → SONNET` when tripped.

How it works, honestly:

- It writes the `"model"` key in `~/.claude/settings.json` (read-merge-write —
  nothing else in the file is touched). That changes the default for **new**
  sessions and conversations. A conversation you're already in keeps its model
  until you `/model` or restart it — the on-card indicator is your cue.
- Your original setting is remembered and **auto-restored** when the 5-hour
  window resets (usage falls back below the tiers), when you untick the feature,
  or when the widget quits. RESTORE MODEL NOW in settings forces it back anytime.
- It can lag your threshold by a few minutes (usage data updates every ~5 min).
- It has no effect on the claude.ai desktop/web app — Claude Code only.

### Keep Mac awake (caffeinate)

Pings can't fire while the Mac is asleep. ⚙ → KEEP MAC AWAKE runs Apple's
`caffeinate` while the widget is running:

- **SYSTEM ONLY** — the display can sleep but the system stays awake, so pings
  still fire. The usual choice.
- **SYSTEM ONLY + SCREEN OFF NOW** — same, but also puts the display to sleep the
  moment you save: pick it, hit SAVE, walk away. Any key/trackpad touch wakes the
  screen as normal.
- **SYSTEM + DISPLAY** — screen stays on too.
- Caveat: a MacBook on battery with the **lid closed** will still sleep — leave the
  lid open or keep it on power for early-morning pings.

The **heartbeat monitor** (∿ pulse button) shows an ECG trace of pings over the
last 24 hours — a spike per ping, time axis along the bottom.

## Look & feel — skins

Ten skins, switchable in ⚙ → SKIN (saved across restarts):

- **LCARS** (default) — Star Trek: TNG computer panel. Orange elbow, colored
  function rail, segmented meters. For the exact TV font install the free
  [Antonio](https://fonts.google.com/specimen/Antonio) — picked up automatically.
- **DASHBOARD** — Bugatti-style instrument cluster: chrome-bezel gauges with red
  needles and redline zones, LCD readouts, carbon-fibre panel, round chrome buttons.
- **RETRO TERMINAL** — green phosphor CRT: monospace, scanlines, everything in
  glowing green on black.
- **SCRIBBLE** — hand-drawn wireframe: paper background, wobbly ink borders,
  handwriting font, pencil-hatched bars.
- **ENIGMA** — wartime cipher machine: walnut case, brass plaques, black bakelite
  keys with silver rims, cream rotor-window readouts, amber lampboard bars,
  typewriter lettering, and a serial plate (ENIGMA I · Nr. A16247).
- **NIXIE STEAMPUNK** — copper and brass machinery with the percentages as glowing
  nixie tubes (orange digits, glass envelope, teal base).
- **SYNTHWAVE** — neon magenta/cyan outlines glowing on deep purple; laser-pink ECG.
- **COCKPIT** — 737-style EFIS: grey panel, black screens, cyan labels, amber LED
  readouts, green tapes, registration plate G-JONG.
- **GAME BOY** — four shades of DMG pea-green, chunky double borders, pixel-era
  monospace. DMG-01.
- **REACTOR** — seafoam control-room panel with a working **annunciator grid**:
  REACTOR NORMAL / HIGH USAGE (lights at 75%) / SCRAM 90% (blinks red) / AUTO PING,
  black meter windows with red LED digits, strip-chart recorder ECG, and a red
  mushroom close button.

The heartbeat ECG recolours per skin (green / LCD blue / phosphor / ink).

## Where the numbers come from

Everything is read **locally, with no network calls**.

**The percentages are the real ones.** The Claude desktop app samples your actual
plan usage every ~5 minutes and caches it at:

```
~/Library/Application Support/Claude/plan-usage-history.json
```

Each sample looks like `{ "t": <ms>, "u": { "fh": 12, "sd": 3 } }` where `fh` is the
five-hour session percentage and `sd` is the seven-day (all models) percentage —
exactly the figures the app's own usage panel shows.

Supporting details come from elsewhere:

- **Session reset countdown** — the current 5-hour window, derived from message
  timestamps in `~/.claude/projects/**/*.jsonl`. Accurate to within a few minutes.
- **Weekly reset** — derived from the history file by finding when `sd` last
  dropped to 0, rolled forward in 7-day steps.
- **Plan tier** (the "Max (5x)" pill) — `~/.claude.json`.
- **Token counts** (the small grey figures) — from the Claude Code logs. Cache
  reads are excluded: they were ~93% of raw token volume and are cheap re-reads of
  context, so including them made the numbers meaningless.

## The one caveat

That usage cache **only updates while the Claude desktop app is running**. If it's
closed, the numbers freeze. The footer tells you which state you're in:

- `LIVE 5 min ago` — fresh
- `STALE 2h 14m ago` (in red) — the desktop app hasn't sampled recently
- `NO LIVE DATA` — the cache file wasn't found at all

There is no Fable bar: the cache only records session and all-models percentages,
so a Fable figure would have to be invented.

## Files

- `main.js` — Electron window + always-on-top / dock logic
- `usage.js` — reads the plan-usage cache and works out the session window
- `preload.js` — safe bridge between window and UI
- `renderer/` — the card UI (`index.html`, `styles.css`, `renderer.js`)
- `renderer/preview.html` — design preview with mock data (not used by the app)

Config (refresh interval, pin state) is saved to Electron's user-data folder as
`config.json`.
