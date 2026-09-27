// Shared fake-music engine for the drive prototypes. Inline this whole file
// into each prototype page (artifacts can't load local scripts from disk).
// It stands in for the real mic pipeline: a 124 BPM track with kick, bass,
// snare, hats and a mid "growl" that only plays in the drop, arranged in
// 8-bar phrases (intro → build → drop → break), folded into NUM_BANDS log
// bands and run through the same kinds of detectors the app has (group
// levels, spectral flux vs an adaptive threshold, graded hits, drop, section
// intensity, centroid, beat grid). Numbers are shaped to look like the real
// monitors, not to be acoustically exact.
const Sim = (() => {
  const NUM_BANDS = 24;
  const BPM = 124;
  const BEAT = 60 / BPM;
  const LOW = [0, 6];   // band index ranges [lo, hi)
  const MID = [6, 15];
  const HIGH = [15, 24];
  const HIST = 600;     // ~10 s at 60 fps

  const PHRASES = ["intro", "build", "drop", "break"]; // 8 bars each
  const bandHz = (i) => 40 * Math.pow(16000 / 40, (i + 0.5) / NUM_BANDS);

  let t = 0;
  const raw = new Float32Array(NUM_BANDS);
  const bands = new Float32Array(NUM_BANDS);
  const prev = new Float32Array(NUM_BANDS);
  const group = { beat: mkDet(), low: mkDet(), mid: mkDet(), high: mkDet() };
  let section = 0.3, loudSlow = 0.3, lastPhrase = "", dropPulse = 0, dropFired = false;
  let lastBeatIdx = -1;
  const lvl = { all: 0, low: 0, mid: 0, high: 0 };

  function mkDet() {
    return { base: 0.05, flux: 0, thr: 0.1, ratio: 0, fired: false, since: 9, pulse: 0, strength: 0 };
  }
  const hist = {
    flux: new Float32Array(HIST), thr: new Float32Array(HIST),
    all: new Float32Array(HIST), low: new Float32Array(HIST), mid: new Float32Array(HIST), high: new Float32Array(HIST),
    hitBeat: new Float32Array(HIST), hitLow: new Float32Array(HIST), hitMid: new Float32Array(HIST), hitHigh: new Float32Array(HIST),
    section: new Float32Array(HIST), centroid: new Float32Array(HIST), loud: new Float32Array(HIST),
  };
  let head = 0;

  // Deterministic-ish noise so reloads look similar.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const env = (x, decay) => (x < 0 ? 0 : Math.exp(-x / decay));
  const bump = (i, centre, width) => Math.exp(-((i - centre) ** 2) / (2 * width * width));

  function phraseAt(time) {
    const bar = Math.floor(time / (BEAT * 4));
    return { name: PHRASES[Math.floor(bar / 8) % 4], bar, barInPhrase: bar % 8 };
  }

  function synth(time) {
    const beatPos = time / BEAT;
    const inBeat = (beatPos % 1) * BEAT;         // seconds since the beat
    const beatIdx = Math.floor(beatPos);
    const ph = phraseAt(time);
    const drop = ph.name === "drop", intro = ph.name === "intro", brk = ph.name === "break", build = ph.name === "build";
    const kickOn = !intro && !(brk && ph.barInPhrase < 6);
    const kick = kickOn ? env(inBeat, 0.11) : 0;
    const snareOn = !intro && beatIdx % 2 === 1;
    const rollDiv = build && ph.barInPhrase >= 6 ? 4 : 1;   // snare roll at the end of the build
    const inRoll = ((beatPos * rollDiv) % 1) * (BEAT / rollDiv);
    const snare = snareOn || (build && ph.barInPhrase >= 6) ? env(build && ph.barInPhrase >= 6 ? inRoll : inBeat, 0.13) * (build ? 0.6 + 0.05 * ph.barInPhrase : 1) : 0;
    const hatDiv = drop ? 4 : 2;
    const inHat = ((beatPos * hatDiv) % 1) * (BEAT / hatDiv);
    const hat = env(inHat, 0.035) * (intro ? 0.55 : drop ? 1 : 0.8);
    const bass = drop ? 0.75 : brk ? 0.2 : build ? 0.45 : 0.1;
    const wob = drop ? 0.55 + 0.45 * Math.sin(beatPos * Math.PI * 2 * 2) : 0; // growl wobbles in 1/8 notes
    const pad = brk || intro ? 0.35 : 0.15;
    for (let i = 0; i < NUM_BANDS; i++) {
      let v = 0.04 + 0.03 * rnd();
      v += kick * 1.1 * bump(i, 1.5, 1.6);
      v += bass * (0.55 + 0.1 * Math.sin(time * 3 + i)) * bump(i, 3.5, 1.8);
      v += snare * 0.85 * bump(i, 11, 3.5);
      v += hat * 0.8 * bump(i, 20.5, 2.4);
      v += wob * 0.8 * bump(i, 10, 3);
      v += pad * 0.5 * bump(i, 8, 5) * (0.8 + 0.2 * Math.sin(time * 0.7));
      raw[i] = Math.min(1, v);
    }
    return ph;
  }

  function detect(det, fluxNow, dt, levelNow) {
    det.flux = fluxNow;
    det.base += (fluxNow - det.base) * Math.min(1, dt * 1.2);
    det.thr = det.base * 1.6 + 0.03;
    det.ratio = fluxNow / det.thr;
    det.since += dt;
    det.fired = false;
    if (det.ratio > 1 && det.since > 0.1) {
      det.fired = true;
      det.since = 0;
      const standout = 1 - Math.exp(-(det.ratio - 1) / 0.6);
      det.strength = Math.max(0.15, 0.5 * standout + 0.5 * levelNow);
      det.pulse = Math.max(det.pulse, det.strength);
    }
    det.pulse *= Math.exp(-dt * 7);
  }

  function step(dt) {
    t += dt;
    const ph = synth(t);
    prev.set(bands);
    for (let i = 0; i < NUM_BANDS; i++) {
      const rate = raw[i] > bands[i] ? 70 : 6;
      bands[i] += (raw[i] - bands[i]) * Math.min(1, rate * dt);
    }
    const mean = (r) => { let s = 0; for (let i = r[0]; i < r[1]; i++) s += bands[i]; return s / (r[1] - r[0]); };
    const fluxOf = (r) => { let s = 0; for (let i = r[0]; i < r[1]; i++) s += Math.max(0, bands[i] - prev[i]); return s / (r[1] - r[0]) * 6; };
    const lvRate = (now, was) => (now > was ? 24 : 10);
    for (const [k, r] of [["low", LOW], ["mid", MID], ["high", HIGH], ["all", [0, NUM_BANDS]]]) {
      const now = mean(r);
      lvl[k] += (now - lvl[k]) * Math.min(1, lvRate(now, lvl[k]) * dt);
    }
    const fluxAll = fluxOf([0, NUM_BANDS]);
    detect(group.beat, fluxAll, dt, lvl.all);
    detect(group.low, fluxOf(LOW), dt, lvl.low);
    detect(group.mid, fluxOf(MID), dt, lvl.mid);
    detect(group.high, fluxOf(HIGH), dt, lvl.high);

    loudSlow += (lvl.all - loudSlow) * Math.min(1, dt / 4);
    section = Math.min(1, Math.max(0, (loudSlow - 0.12) / 0.3));
    dropFired = ph.name === "drop" && lastPhrase !== "drop";
    if (dropFired) dropPulse = 1;
    dropPulse *= Math.exp(-dt * 1.2);
    lastPhrase = ph.name;

    let num = 0, den = 0;
    for (let i = 0; i < NUM_BANDS; i++) { num += i * bands[i]; den += bands[i]; }
    const centroid = den > 0 ? num / den / (NUM_BANDS - 1) : 0.5;

    const beatPos = t / BEAT;
    const beatIdx = Math.floor(beatPos);
    const newBeat = beatIdx !== lastBeatIdx;
    lastBeatIdx = beatIdx;

    head = (head + 1) % HIST;
    hist.flux[head] = fluxAll; hist.thr[head] = group.beat.thr;
    hist.all[head] = lvl.all; hist.low[head] = lvl.low; hist.mid[head] = lvl.mid; hist.high[head] = lvl.high;
    hist.hitBeat[head] = group.beat.fired ? group.beat.strength : 0;
    hist.hitLow[head] = group.low.fired ? group.low.strength : 0;
    hist.hitMid[head] = group.mid.fired ? group.mid.strength : 0;
    hist.hitHigh[head] = group.high.fired ? group.high.strength : 0;
    hist.section[head] = section; hist.centroid[head] = centroid; hist.loud[head] = lvl.all;

    return {
      t, phrase: ph.name, bar: ph.bar, beatPos, beatPhase: beatPos % 1, newBeat,
      bands, level: { ...lvl },
      flux: fluxAll, fluxThr: group.beat.thr, fluxRatio: group.beat.ratio,
      hit: {
        beat: group.beat.fired, low: group.low.fired, mid: group.mid.fired, high: group.high.fired, drop: dropFired,
      },
      strength: { beat: group.beat.strength, low: group.low.strength, mid: group.mid.strength, high: group.high.strength },
      pulse: { beat: group.beat.pulse, low: group.low.pulse, mid: group.mid.pulse, high: group.high.pulse, drop: dropPulse },
      section, centroid,
    };
  }

  // Beat-grid tick: true on the frame a division boundary is crossed.
  // div in beats: 0.5, 1, 2, 4, 8.
  const gridLast = {};
  function gridTick(div, beatPos) {
    const idx = Math.floor(beatPos / div);
    const fired = gridLast[div] !== undefined && idx !== gridLast[div];
    gridLast[div] = idx;
    return fired;
  }

  // Read the last n samples of a history series, oldest first.
  function series(name, n = HIST) {
    const src = hist[name], out = new Float32Array(n);
    for (let k = 0; k < n; k++) out[k] = src[(head - n + 1 + k + HIST * 2) % HIST];
    return out;
  }

  return { NUM_BANDS, BPM, BEAT, LOW, MID, HIGH, HIST, bandHz, step, gridTick, series };
})();

// The source catalogue the prototypes pick from. `read(f, s)` returns the
// source's value this frame (0..1); `s` is per-source state for decaying
// edges. Colours follow the real panel (STRIP_* for bands, HOT_RED for the
// Rhythm card's Beat lane, AUTO_SKY for Brightness, INPUT_GREEN for level).
const SOURCES = [
  { id: "hit.beat", kind: "hit", label: "Any hit", short: "Hit", colour: "#ef4444", monitor: "rhythm.beat", range: [0, 24] },
  { id: "hit.low", kind: "hit", label: "Bass hits", short: "Bass", colour: "#89e29d", monitor: "rhythm.low", range: [0, 6] },
  { id: "hit.mid", kind: "hit", label: "Mid hits", short: "Mid", colour: "#c0a2f5", monitor: "rhythm.mid", range: [6, 15] },
  { id: "hit.high", kind: "hit", label: "Treble hits", short: "Treble", colour: "#f6b15b", monitor: "rhythm.high", range: [15, 24] },
  { id: "hit.drop", kind: "hit", label: "Drop", short: "Drop", colour: "#eab308", monitor: "loudness.section" },
  { id: "flux", kind: "level", label: "Onset surge", short: "Surge", colour: "#f3f3f3", monitor: "rhythm.onset", range: [0, 24] },
  { id: "level.all", kind: "level", label: "Loudness", short: "Loud", colour: "#8ce6a0", monitor: "signal.level", range: [0, 24] },
  { id: "level.low", kind: "level", label: "Bass level", short: "Bass lvl", colour: "#89e29d", monitor: "bands.low", range: [0, 6] },
  { id: "level.mid", kind: "level", label: "Mid level", short: "Mid lvl", colour: "#c0a2f5", monitor: "bands.mid", range: [6, 15] },
  { id: "level.high", kind: "level", label: "Treble level", short: "Treble lvl", colour: "#f6b15b", monitor: "bands.high", range: [15, 24] },
  { id: "section", kind: "level", label: "Song intensity", short: "Song", colour: "#4dd4c0", monitor: "loudness.section" },
  { id: "centroid", kind: "level", label: "Brightness", short: "Bright", colour: "#59bbfb", monitor: "character.centroid" },
  { id: "grid.1", kind: "tempo", label: "Every beat", short: "Beat", colour: "#ffffff", monitor: "rhythm.grid", div: 1 },
  { id: "grid.4", kind: "tempo", label: "Every bar", short: "Bar", colour: "#ffffff", monitor: "rhythm.grid", div: 4 },
  { id: "line", kind: "line", label: "Drawn line", short: "Line", colour: "#f9b96c", monitor: "bands.line", range: [0, 24] },
];

// Per-source readers. Hits and grid ticks become decaying pulses; `height`
// chooses how tall a hit is: "fixed" (always 1), "standout" (how far it
// cleared the threshold — the graded strength), or "loud" (the band's level
// at that moment). Levels are continuous.
function makeReader(src, opts = {}) {
  let pulse = 0;
  const height = opts.height ?? "standout";
  const lineHeights = opts.line ?? null; // Float32Array(NUM_BANDS) of 0..1 thresholds
  return function read(f, dt) {
    pulse *= Math.exp(-dt * 7);
    switch (src.id) {
      case "hit.beat": case "hit.low": case "hit.mid": case "hit.high": {
        const k = src.id.slice(4);
        if (f.hit[k]) {
          const lvKey = k === "beat" ? "all" : k;
          const h = height === "fixed" ? 1 : height === "loud" ? Math.min(1, f.level[lvKey] * 1.8) : f.strength[k];
          pulse = Math.max(pulse, h);
        }
        return pulse;
      }
      case "hit.drop": return f.pulse.drop;
      case "flux": return Math.min(1, Math.max(0, (f.fluxRatio - 0.6) / 1.4));
      case "level.all": return Math.min(1, f.level.all * 1.25);
      case "level.low": return Math.min(1, f.level.low * 1.05);
      case "level.mid": return Math.min(1, f.level.mid * 1.3);
      case "level.high": return Math.min(1, f.level.high * 1.35);
      case "section": return f.section;
      case "centroid": return f.centroid;
      case "grid.1": case "grid.4": {
        if (Sim.gridTick(src.div, f.beatPos)) pulse = 1;
        return pulse;
      }
      case "line": {
        if (!lineHeights) return 0;
        let ex = 0, room = 0;
        for (let i = 0; i < Sim.NUM_BANDS; i++) {
          if (lineHeights[i] >= 1) continue;
          ex += Math.max(0, f.bands[i] - lineHeights[i]);
          room += 1 - lineHeights[i];
        }
        return room > 0 ? Math.min(1, (ex / room) * 2.5) : 0;
      }
    }
    return 0;
  };
}

// How several sources become one drive. "add": weighted sum, clamped.
// "max": the strongest weighted source wins. "gate": the first source,
// passed only while the second is above half (e.g. hits, only when loud).
function combine(mode, values, weights) {
  if (!values.length) return 0;
  if (mode === "max") return Math.min(1, Math.max(...values.map((v, i) => v * weights[i])));
  if (mode === "gate") {
    if (values.length < 2) return values[0] * weights[0];
    const open = values[1] * weights[1] > 0.5 ? 1 : Math.max(0, values[1] * weights[1] * 2 - 0.5) ;
    return Math.min(1, values[0] * weights[0] * open);
  }
  return Math.min(1, values.reduce((s, v, i) => s + v * weights[i], 0));
}
