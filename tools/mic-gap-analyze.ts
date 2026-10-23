// Detector half of the mic-vs-direct comparison: runs each song take of a
// tools/mic-gap.mjs session through the app's own FeatureExtractor and
// TempoAnalyzer (tests/tempoEval/run.ts's evaluate(), silence gate on, the
// way app.ts runs solo) three times — the tab share, the real mic, and the
// tab share through tests/tempoEval/micChain.ts's simulated room — and
// scores each against the song's own beat grid (song.json's phi/period).
// Needs tools/mic-gap-signal.py's signal.json first: it holds where the
// song sits in the take and how far the mic trails the tab.
//
// Each of tab and mic also runs a second time with the app's default Auto on
// (evaluate()'s `auto`: auto-gain amount from the band span, gate marks from
// the tracked room floor), and the summary carries what Auto resolved to.
//
//   node tools/mic-gap-analyze.ts <session dir> [--noise-from <session dir>]
//
// Writes <session dir>/detect.json and prints a summary.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, type EvalMetrics } from "../tests/tempoEval/run.ts";
import { readWav } from "../tests/tempoEval/recordings.ts";
import { micChain } from "../tests/tempoEval/micChain.ts";
import { hitGrid, roomStats } from "../tests/tempoEval/room.ts";
import { SR, type Track } from "../tests/tempoEval/synth.ts";
import { NUM_BANDS } from "../audio-subsystem/src/types.ts";

interface SongSignal {
  name: string;
  bpm: number;
  period: number;
  phi: number;
  volume: number;
  songTimeAtTab0: number;
  lagMs: number;
}

// An onset counts as the same hit on both legs within this, after the mic's
// measured delay is taken off.
const MATCH_SEC = 0.05;
// Takes start with the player seeking; nothing before this is scored.
const SKIP_SEC = 1;

interface LegFrames {
  times: number[];
  onsets: number[];
  bands: Float32Array[];
  level: number[];
  energy: number[];
  bpm: number[];
}

function runLeg(name: string, mono: Float32Array, s: SongSignal, delaySec: number, auto = false) {
  const dur = mono.length / SR;
  const grid: number[] = [];
  for (let b = s.phi; b - s.songTimeAtTab0 + delaySec < dur; b += s.period) {
    const t = b - s.songTimeAtTab0 + delaySec;
    if (t > SKIP_SEC) grid.push(t);
  }
  const track: Track = { name, mono, tempo: [{ from: 0, to: dur, bpm: s.bpm }], beats: grid, gridBeats: grid };
  const f: LegFrames = { times: [], onsets: [], bands: [], level: [], energy: [], bpm: [] };
  const gain: number[] = [];
  const closed: number[] = [];
  const open: number[] = [];
  const metrics: EvalMetrics = evaluate(track, 60, {
    analyzer: true,
    gate: true,
    auto,
    onFrame: (time, frame, _anim, resolved) => {
      gain.push(resolved.autoGain);
      closed.push(resolved.gate?.closed ?? NaN);
      open.push(resolved.gate?.open ?? NaN);
      f.times.push(time);
      if (frame.onset) f.onsets.push(time);
      f.bands.push(Float32Array.from(frame.bands));
      f.level.push(frame.level);
      f.energy.push(frame.energy);
      f.bpm.push(frame.bpm);
    },
  });
  // How far each onset lands from its nearest beat, for the ones within a
  // quarter beat of one: on-grid share and the signed median offset.
  const offs: number[] = [];
  for (const o of f.onsets) {
    if (o < SKIP_SEC) continue;
    let best = Infinity;
    for (const g of grid) if (Math.abs(o - g) < Math.abs(best)) best = o - g;
    if (Math.abs(best) < s.period / 4) offs.push(best);
  }
  const scored = f.onsets.filter((o) => o >= SKIP_SEC).length;
  return {
    metrics,
    frames: f,
    onsetsPerBeat: scored / grid.length,
    onBeatShare: offs.filter((o) => Math.abs(o) < 0.035).length / Math.max(1, scored),
    onsetOffsetMs: median(offs) * 1000,
    hitGrid: hitGrid(mono, s.bpm),
    room: roomStats(mono),
    resolved: { autoGainMedian: median(gain), autoGainEnd: gain[gain.length - 1]!, closedEnd: closed[closed.length - 1]!, openEnd: open[open.length - 1]! },
  };
}

function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function corr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i]! - ma) * (b[i]! - mb);
    saa += (a[i]! - ma) ** 2;
    sbb += (b[i]! - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb + 1e-12);
}

/** Recall: share of the tab's onsets the other leg also fires within
 *  MATCH_SEC (after its delay); precision: share of its onsets that match. */
function agreement(ref: number[], other: number[], delaySec: number) {
  const r = ref.filter((t) => t >= SKIP_SEC);
  const o = other.filter((t) => t >= SKIP_SEC).map((t) => t - delaySec);
  const hit = (t: number, set: number[]) => set.some((u) => Math.abs(u - t) <= MATCH_SEC);
  return {
    recall: r.filter((t) => hit(t, o)).length / Math.max(1, r.length),
    precision: o.filter((t) => hit(t, r)).length / Math.max(1, o.length),
  };
}

/** Per band: correlation of the frames' normalized band values (what a scene
 *  reads) between the tab and another leg, frames shifted by the delay. */
function bandAgreement(ref: LegFrames, other: LegFrames, delaySec: number) {
  const shift = Math.round(delaySec * 60);
  const start = Math.round(SKIP_SEC * 60);
  const corrs: number[] = [];
  const meanRef: number[] = [];
  const meanOther: number[] = [];
  for (let b = 0; b < NUM_BANDS; b++) {
    const a: number[] = [];
    const c: number[] = [];
    for (let i = start; i + shift < other.bands.length && i < ref.bands.length; i++) {
      a.push(ref.bands[i]![b]!);
      c.push(other.bands[i + shift]![b]!);
    }
    corrs.push(corr(a, c));
    meanRef.push(a.reduce((x, y) => x + y, 0) / a.length);
    meanOther.push(c.reduce((x, y) => x + y, 0) / c.length);
  }
  const lv = (f: LegFrames) => f.level.slice(start);
  return { corrs, meanRef, meanOther, levelRef: median(lv(ref)), levelOther: median(lv(other)), energyCorr: corr(ref.energy.slice(start), other.energy.slice(start + shift)) };
}

/** The quiet room through the same extractor: the level the gate reads
 *  there, and any hits the gate lets through. */
function runNoise(mono: Float32Array) {
  const levels: number[] = [];
  let onsets = 0;
  let marks: { closed: number; open: number } | undefined;
  evaluate({ name: "noise", mono, tempo: [], beats: [], gridBeats: [] }, 60, {
    analyzer: true,
    gate: true,
    auto: true,
    onFrame: (time, frame, _anim, resolved) => {
      marks = resolved.gate;
      if (time < SKIP_SEC) return;
      levels.push(frame.level);
      if (frame.onset) onsets++;
    },
  });
  const s = [...levels].sort((a, b) => a - b);
  const pct = (p: number) => s[Math.floor(p * (s.length - 1))]!;
  return { levelP10: pct(0.1), levelMedian: pct(0.5), levelP90: pct(0.9), autoMarksEnd: marks, onsetsPerMin: (onsets / (levels.length / 60)) * 60 };
}

const dir = process.argv[2]!;
const noiseDir = process.argv.includes("--noise-from") ? process.argv[process.argv.indexOf("--noise-from") + 1]! : dir;
const noise = runNoise(readWav(join(noiseDir, "noise.mic.wav")));
console.log(
  `noise: level p10 ${noise.levelP10.toFixed(3)} median ${noise.levelMedian.toFixed(3)} p90 ${noise.levelP90.toFixed(3)}, ${noise.onsetsPerMin.toFixed(1)} hits/min, auto gate ${noise.autoMarksEnd?.closed.toFixed(3)}/${noise.autoMarksEnd?.open.toFixed(3)}`,
);
const signal = JSON.parse(readFileSync(join(dir, "signal.json"), "utf8")) as { songs: SongSignal[] };
const out = [];
for (const s of signal.songs) {
  const tab = readWav(join(dir, `${s.name}.tab.wav`));
  const mic = readWav(join(dir, `${s.name}.mic.wav`));
  const delay = s.lagMs / 1000;
  const legs = {
    tab: runLeg(`${s.name} tab`, tab, s, 0),
    mic: runLeg(`${s.name} mic`, mic, s, delay),
    sim: runLeg(`${s.name} sim`, micChain(tab, SR), s, 0),
    tabAuto: runLeg(`${s.name} tab auto`, tab, s, 0, true),
    micAuto: runLeg(`${s.name} mic auto`, mic, s, delay, true),
  };
  const summary = (k: keyof typeof legs) => {
    const l = legs[k];
    return {
      tempoOk: l.metrics.tempoOk,
      tempoOkSteady: l.metrics.tempoOkSteady,
      timeToLockSec: l.metrics.timeToLockSec,
      ticksOn30ms: l.metrics.ticksOn30ms,
      medianOffsetMs: l.metrics.medianOffsetMs,
      metroCoverage: l.metrics.metroCoverage,
      endBpm: l.metrics.endBpm,
      onsetsPerBeat: l.onsetsPerBeat,
      onBeatShare: l.onBeatShare,
      onsetOffsetMs: l.onsetOffsetMs,
      hitGrid: l.hitGrid,
      room: l.room,
      resolved: l.resolved,
    };
  };
  const row = {
    name: s.name,
    bpm: s.bpm,
    volume: s.volume,
    lagMs: s.lagMs,
    tab: summary("tab"),
    mic: summary("mic"),
    sim: summary("sim"),
    tabAuto: summary("tabAuto"),
    micAuto: summary("micAuto"),
    micVsTab: { onsets: agreement(legs.tab.frames.onsets, legs.mic.frames.onsets, delay), ...bandAgreement(legs.tab.frames, legs.mic.frames, delay) },
    simVsTab: { onsets: agreement(legs.tab.frames.onsets, legs.sim.frames.onsets, 0), ...bandAgreement(legs.tab.frames, legs.sim.frames, 0) },
    micAutoVsTabAuto: { onsets: agreement(legs.tabAuto.frames.onsets, legs.micAuto.frames.onsets, delay), ...bandAgreement(legs.tabAuto.frames, legs.micAuto.frames, delay) },
  };
  out.push(row);
  const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "  - ");
  console.log(`${s.name} (${s.bpm.toFixed(0)} BPM, lag ${s.lagMs.toFixed(1)} ms)`);
  for (const k of ["tab", "mic", "sim", "tabAuto", "micAuto"] as const) {
    const m = row[k];
    console.log(
      `  ${k}: tempoOk ${f(m.tempoOk)} steady ${f(m.tempoOkSteady)} lock ${f(m.timeToLockSec, 1)}s ticks30 ${f(m.ticksOn30ms)} tickOff ${f(m.medianOffsetMs, 0)}ms end ${f(m.endBpm, 1)} | onsets/beat ${f(m.onsetsPerBeat)} onBeat ${f(m.onBeatShare)} off ${f(m.onsetOffsetMs, 0)}ms | grid on/off ${f(m.hitGrid.onPerBar, 1)}/${f(m.hitGrid.offPerBar, 1)} | room lvl ${f(m.room.levelDb, 1)} floor ${f(m.room.floorDb, 1)} fade ${f(m.room.fadeDb, 1)} bass ${f(m.room.bassDb, 1)} | auto-gain med ${f(m.resolved.autoGainMedian)} end ${f(m.resolved.autoGainEnd)} gate ${f(m.resolved.closedEnd, 3)}/${f(m.resolved.openEnd, 3)}`,
    );
  }
  for (const k of ["micVsTab", "simVsTab", "micAutoVsTabAuto"] as const) {
    const a = row[k];
    console.log(`  ${k}: onset recall ${f(a.onsets.recall)} precision ${f(a.onsets.precision)} energyCorr ${f(a.energyCorr)} level ${f(a.levelRef)}→${f(a.levelOther)} bandCorr ${a.corrs.map((c) => f(c, 1)).join(" ")}`);
  }
}
writeFileSync(join(dir, "detect.json"), JSON.stringify({ noise, songs: out }));
