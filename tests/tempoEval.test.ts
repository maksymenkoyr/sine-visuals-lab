import { describe, it, expect } from "vitest";
import { buildTracks, type Track } from "./tempoEval/synth.ts";
import { evaluate, type EvalMetrics } from "./tempoEval/run.ts";
import { GRID_LOCK_ON } from "../src/render/gridPulse.ts";

// Permanent offline scoreboard for the real FeatureExtractor + AnimClock
// tempo tracker (see tempoEval/synth.ts and run.ts) — `npm run eval:tempo`
// always prints the table, win or lose, so a tuning session can see the
// whole picture rather than just the first failing assert. Computed at
// module scope, once, rather than in a beforeAll: Vitest doesn't run a
// file's beforeAll at all when every it() in it is skipped, and this table
// has to print even while every assertion below is (see the next
// paragraph) — module-level code runs whenever the file is collected,
// skipped tests or not.
//
// The assertions started as `it.skip` (pre-tracker-change baseline — see the
// PR that introduced this file for that baseline table) and were switched on
// once the tracker changes they check for landed; see this file's git
// history for the exact baseline.
//
// Two tracker paths, both scored here: the render-tick path (features.ts's
// FeatureExtractor.bpm, timestamped to whatever frame rate the render loop
// happens to run at — the `metrics`/`metrics30` tables) and the fixed-hop
// path (tempoAnalyzer.ts, run.ts's `{ analyzer: true }` — the
// `metricsA60`/`metricsA30`/`metricsA15` tables). The render-tick path is
// the fallback when no AudioWorklet tempo source is live (see
// src/audio/tempoSource.ts), so every existing assertion on it stays —
// the fixed-hop path additionally gets a 15fps table, which is the whole
// point of it: a render-tick tracker degrades as the frame rate drops (see
// this file's own git history/the PR that added the fixed-hop path for
// measurements), while the fixed-hop one never sees a frame at all.

const tracks: Track[] = buildTracks();
const metrics: Record<string, EvalMetrics> = {};
for (const track of tracks) metrics[track.name] = evaluate(track, 60);
// The same tracks at half the frame rate: hits are timestamped to the render
// tick, so a slower device sees every hit later and more coarsely — the
// tick-placement targets below hold at both rates.
const metrics30: Record<string, EvalMetrics> = {};
for (const track of tracks) metrics30[track.name] = evaluate(track, 30);

const metricsA60: Record<string, EvalMetrics> = {};
for (const track of tracks) metricsA60[track.name] = evaluate(track, 60, { analyzer: true });
const metricsA30: Record<string, EvalMetrics> = {};
for (const track of tracks) metricsA30[track.name] = evaluate(track, 30, { analyzer: true });
const metricsA15: Record<string, EvalMetrics> = {};
for (const track of tracks) metricsA15[track.name] = evaluate(track, 15, { analyzer: true });
// Host/TV: the fixed-hop bpm (it rides the wire) with the beat clock on the
// render-tick onset feed — see run.ts's EvalOptions.hostFeed.
const metricsH60: Record<string, EvalMetrics> = {};
for (const track of tracks) metricsH60[track.name] = evaluate(track, 60, { analyzer: true, hostFeed: true });
const metricsH30: Record<string, EvalMetrics> = {};
for (const track of tracks) metricsH30[track.name] = evaluate(track, 30, { analyzer: true, hostFeed: true });

// Real songs, through a mic, with the silence gate at its shipped defaults —
// see the plan/PR that added this block for the measured bug it reproduces:
// with the render-tick onset feed gated by room level (features.ts's
// `onset`), the host/TV path and the render-tick fallback path lost most of
// the Metronome's own running time on real music played through a simulated
// speaker->room->mic chain (tempoEval/micChain.ts), while solo mode (fed by
// the AudioWorklet analyser's own ungated onsets) was unaffected. Three
// tables, same three shapes as the clean-signal tables above: host/TV
// (`hostFeed`), render-tick (no `analyzer`), and solo (`analyzer` without
// `hostFeed`) — all three now read the tracker's own ungated pulse onset
// (FeatureFrame.pulseOnset) for tempo, not the visual, gated `onset`.
const metricsMicHost: Record<string, EvalMetrics> = {};
for (const track of tracks) metricsMicHost[track.name] = evaluate(track, 60, { analyzer: true, hostFeed: true, mic: true, gate: true });
const metricsMicRender: Record<string, EvalMetrics> = {};
for (const track of tracks) metricsMicRender[track.name] = evaluate(track, 60, { mic: true, gate: true });
const metricsMicSolo: Record<string, EvalMetrics> = {};
for (const track of tracks) metricsMicSolo[track.name] = evaluate(track, 60, { analyzer: true, mic: true, gate: true });

function fmt(v: number, digits = 3): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "--";
}

function printTable(label: string, rows: Record<string, EvalMetrics>): void {
  const table: Record<string, Record<string, string>> = {};
  for (const [name, m] of Object.entries(rows)) {
    table[name] = {
      tempoOk: fmt(m.tempoOk),
      tempoOkSteady: fmt(m.tempoOkSteady),
      timeToLockSec: fmt(m.timeToLockSec, 2),
      ticksOn30ms: fmt(m.ticksOn30ms),
      medianOffsetMs: fmt(m.medianOffsetMs, 1),
      lockWhenRight: fmt(m.lockWhenRight),
      lockWhenWrong: fmt(m.lockWhenWrong),
      lockNoTempo: fmt(m.lockNoTempo),
      endBpm: fmt(m.endBpm, 1),
      endLock: fmt(m.endLock),
      metroOn30ms: fmt(m.metroOn30ms),
      metroCoverage: fmt(m.metroCoverage),
      metroIntervalCv: fmt(m.metroIntervalCv),
      metroBreakdownRun: fmt(m.metroBreakdownRun),
      metroBreakdownOn30ms: fmt(m.metroBreakdownOn30ms),
      metroEndRunning: String(m.metroEndRunning),
      metroRunShare: fmt(m.metroRunShare),
    };
  }
  // eslint-disable-next-line no-console
  console.log(label);
  // eslint-disable-next-line no-console
  console.table(table);
}
printTable("60 fps", metrics);
printTable("30 fps", metrics30);
printTable("60 fps (analyzer)", metricsA60);
printTable("30 fps (analyzer)", metricsA30);
printTable("15 fps (analyzer)", metricsA15);
printTable("60 fps (host/TV)", metricsH60);
printTable("30 fps (host/TV)", metricsH30);
printTable("60 fps, through a mic, gate on (host/TV)", metricsMicHost);
printTable("60 fps, through a mic, gate on (render-tick)", metricsMicRender);
printTable("60 fps, through a mic, gate on (solo)", metricsMicSolo);

// Accuracy is scored after a WARMUP_SEC warm-up (tempoOkSteady), with the
// first lock's speed as its own column and target (timeToLockSec): the
// tempo prior (features.ts's tempoPrior) trades a slower first lock on a
// fast track — a few hits in, a 2:3 candidate nearer the prior's centre can
// briefly win — for no 4:3 lock on busy 16th-note hats, and the two numbers
// keep that trade visible instead of blending it into one. Lock is split by
// whether the tracker is right: a confidence worth having reads high when it
// is right and lower when it is wrong.
describe("tempo eval scoreboard", () => {
  it("house: tracks tempo tightly, holds most beats within 30ms, and lets go cleanly after the track ends", () => {
    expect(metrics.house!.tempoOkSteady).toBeGreaterThanOrEqual(0.9);
    expect(metrics.house!.ticksOn30ms).toBeGreaterThanOrEqual(0.6);
    expect(metrics.house!.endBpm).toBe(0);
    expect(metrics.house!.endLock).toBeLessThan(0.1);
  });

  it("hiphop: tracks tempo through the swing pattern", () => {
    expect(metrics.hiphop!.tempoOkSteady).toBeGreaterThanOrEqual(0.88);
    expect(metrics.hiphop!.ticksOn30ms).toBeGreaterThanOrEqual(0.9);
  });

  it("dnb: tracks tempo at 174bpm", () => {
    expect(metrics.dnb!.tempoOkSteady).toBeGreaterThanOrEqual(0.9);
    expect(metrics.dnb!.ticksOn30ms).toBeGreaterThanOrEqual(0.8);
  });

  it("steady tracks find their tempo within a few seconds", () => {
    for (const name of ["house", "hiphop", "dnb"]) {
      expect(metrics[name]!.timeToLockSec, name).toBeLessThanOrEqual(3);
    }
  });

  it("ramp: follows a drifting tempo well enough to be usable", () => {
    expect(metrics.ramp!.tempoOk).toBeGreaterThanOrEqual(0.4);
  });

  // Held to the beat grid's own switch-on line (gridPulse.ts): below it a
  // grid drive falls back to raw hits, which is the behaviour a beatless
  // track should get.
  it("random: doesn't fake a lock on unstructured hits", () => {
    expect(metrics.random!.lockNoTempo).toBeLessThan(GRID_LOCK_ON);
    expect(metrics30.random!.lockNoTempo).toBeLessThan(GRID_LOCK_ON);
  });

  it("30 fps: beats still land on the kick", () => {
    for (const name of ["house", "hiphop", "dnb"]) {
      expect(metrics30[name]!.ticksOn30ms, name).toBeGreaterThanOrEqual(0.8);
    }
  });

  // ramp is held to the comparison only, not the absolute level: its tempo
  // never stops moving, and the tracker only gets it right late in the track
  // (see its own timeToLockSec — the 4:3 lock the prior eventually breaks),
  // so most of its "right" frames sit inside tempoLock's own rise time.
  it("lock is high when the tempo is right, and lower when it is wrong", () => {
    for (const name of ["house", "hiphop", "dnb"]) {
      expect(metrics[name]!.lockWhenRight, name).toBeGreaterThanOrEqual(0.7);
    }
    expect(metrics.ramp!.lockWhenWrong).toBeLessThan(metrics.ramp!.lockWhenRight);
  });

  // metronome.ts on the pure render-tick path — only a browser with no
  // AudioWorklet at all runs this end to end. Held to the metronome's own
  // guarantees (evenly spaced, keeps ticking through the breakdown, lets go at
  // the end); how *accurately* it sits on the beat is only as good as this
  // path's own clock, which the tracker metrics above already score — its
  // on-beat, coverage and random-track numbers are printed, not asserted here.
  // The accuracy targets live on the host/TV path below, which is what the
  // render-tick onset feed actually drives in practice.
  it("metronome: evenly spaced, ticks through house's breakdown, lets go at the end", () => {
    for (const table of [metrics, metrics30]) {
      for (const name of ["house", "hiphop", "dnb"]) {
        expect(table[name]!.metroIntervalCv, name).toBeLessThanOrEqual(0.02);
      }
      expect(table.house!.metroBreakdownRun).toBeGreaterThanOrEqual(0.95);
      expect(table.house!.metroEndRunning).toBe(false);
    }
  });

});

// The fixed-hop path (tempoAnalyzer.ts, via run.ts's { analyzer: true }) —
// see this file's header for what it is and tempoAnalyzer.ts's own header
// for why it exists. Checked at 60, 30 AND 15fps (the render-tick path above
// is only checked at 60/30 — this is the whole point of the fixed-hop path:
// it never sees a render tick at all, so its own numbers barely move across
// that range, unlike the render-tick path's).
describe("tempo eval scoreboard — fixed-hop analyzer path", () => {
  const analyzerTables = { "60fps": metricsA60, "30fps": metricsA30, "15fps": metricsA15 };

  it("house/hiphop/dnb: track tempo tightly and hold most beats within 30ms", () => {
    for (const [label, table] of Object.entries(analyzerTables)) {
      for (const name of ["house", "hiphop", "dnb"]) {
        const tag = `${name} @ ${label}`;
        expect(table[name]!.tempoOkSteady, tag).toBeGreaterThanOrEqual(0.95);
        expect(table[name]!.ticksOn30ms, tag).toBeGreaterThanOrEqual(0.85);
        expect(table[name]!.lockWhenRight, tag).toBeGreaterThanOrEqual(0.7);
      }
    }
  });

  it("ramp: follows the drifting tempo well, confidently, at every frame rate", () => {
    for (const [label, table] of Object.entries(analyzerTables)) {
      expect(table.ramp!.tempoOkSteady, label).toBeGreaterThanOrEqual(0.9);
      expect(table.ramp!.lockWhenRight, label).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("house: lets go cleanly after the track ends", () => {
    for (const [label, table] of Object.entries(analyzerTables)) {
      expect(table.house!.endBpm, label).toBe(0);
      expect(table.house!.endLock, label).toBeLessThan(0.1);
    }
  });

  // Held to the beat grid's own switch-on line (gridPulse.ts), same as the
  // render-tick path's own version of this check above.
  it("random: doesn't fake a lock on unstructured hits", () => {
    for (const [label, table] of Object.entries(analyzerTables)) {
      expect(table.random!.lockNoTempo, label).toBeLessThan(GRID_LOCK_ON);
    }
  });

  it("house/dnb find their tempo within a few seconds", () => {
    for (const [label, table] of Object.entries(analyzerTables)) {
      for (const name of ["house", "dnb"]) {
        expect(table[name]!.timeToLockSec, `${name} @ ${label}`).toBeLessThanOrEqual(3);
      }
    }
  });

  // hiphop's first lock is genuinely slower than house/dnb's — the tempo
  // prior (tempoComb.ts's tempoPrior, centred well above hiphop's 90bpm)
  // costs it a few seconds before the pair comb's own evidence overrides
  // that pull, same trade the render-tick path's own "steady tracks find
  // their tempo" comment above describes. Measured at ~3.4s here, matching
  // the prototype's own measurement (see tempoAnalyzer.ts's header) — report
  // it, but only assert the looser bound the plan settled on; don't tune
  // toward tightening it.
  it("hiphop finds its tempo within a few seconds (looser bound — see comment)", () => {
    for (const [label, table] of Object.entries(analyzerTables)) {
      expect(table.hiphop!.timeToLockSec, label).toBeLessThanOrEqual(4);
    }
  });

  // metronome.ts, scored on the fixed-hop path — see this file's header for
  // the render-tick/analyzer split. Unlike the render-tick describe block
  // above, every metronome target here holds at every rate: the analyzer's
  // own onsets are exact audio-clock times rather than tick-timestamped
  // guesses, so the metronome's phase-follow has nothing to drift against
  // between corrections the way it does on the render-tick path.
  it("metronome: house/hiphop/dnb tick close to the true beat and stay evenly spaced", () => {
    for (const [label, table] of Object.entries(analyzerTables)) {
      for (const name of ["house", "hiphop", "dnb"]) {
        const tag = `${name} @ ${label}`;
        expect(table[name]!.metroOn30ms, tag).toBeGreaterThanOrEqual(0.85);
        expect(table[name]!.metroCoverage, tag).toBeGreaterThanOrEqual(0.9);
        expect(table[name]!.metroIntervalCv, tag).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it("metronome: house keeps ticking through its breakdown and lets go cleanly after the track ends", () => {
    for (const [label, table] of Object.entries(analyzerTables)) {
      expect(table.house!.metroBreakdownRun, label).toBeGreaterThanOrEqual(0.95);
      expect(table.house!.metroBreakdownOn30ms, label).toBeGreaterThanOrEqual(0.8);
      expect(table.house!.metroEndRunning, label).toBe(false);
    }
  });

  it("metronome: random doesn't convince it a tempo is worth running against", () => {
    for (const [label, table] of Object.entries(analyzerTables)) {
      expect(table.random!.metroRunShare, label).toBeLessThanOrEqual(0.3);
    }
  });
});

// Host/TV: fixed-hop bpm, render-tick phase (run.ts's hostFeed). The
// metronome's accuracy targets for everything that isn't solo mode.
describe("tempo eval scoreboard — host/TV path", () => {
  it("metronome: house/hiphop/dnb tick close to the true beat, without dropouts, evenly spaced", () => {
    for (const table of [metricsH60, metricsH30]) {
      for (const name of ["house", "hiphop", "dnb"]) {
        expect(table[name]!.metroOn30ms, name).toBeGreaterThanOrEqual(0.75);
        expect(table[name]!.metroCoverage, name).toBeGreaterThanOrEqual(0.9);
        expect(table[name]!.metroIntervalCv, name).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it("metronome: house keeps ticking through its breakdown and lets go cleanly after the track ends", () => {
    for (const table of [metricsH60, metricsH30]) {
      expect(table.house!.metroBreakdownRun).toBeGreaterThanOrEqual(0.95);
      expect(table.house!.metroBreakdownOn30ms).toBeGreaterThanOrEqual(0.8);
      expect(table.house!.metroEndRunning).toBe(false);
    }
  });

  it("metronome: random doesn't convince it a tempo is worth running against", () => {
    expect(metricsH60.random!.metroRunShare).toBeLessThanOrEqual(0.3);
    expect(metricsH30.random!.metroRunShare).toBeLessThanOrEqual(0.3);
  });
});

// Through a mic, silence gate on — see metricsMicHost/metricsMicRender/
// metricsMicSolo's own comment above for what this reproduces and why. All
// three paths must hold the Metronome running through house/hiphop/dnb,
// close to the beat, without the gate starving it — and random must still
// not convince it a tempo is worth running against, print-only otherwise.
describe("tempo eval scoreboard — through a mic, silence gate on", () => {
  // Baseline (pre-fix — see the commit that added this block): host/render
  // both read metroRunShare 0.000 on house/hiphop/dnb (the gated render-tick
  // onset starves the beat clock's phase comb entirely); solo already runs
  // house/dnb fine (its beat clock never sees the gate) but still fails
  // hiphop, whose tempo the fixed-hop analyzer itself never locks under this
  // mic simulation, gate or no gate — see the PR that landed this block for
  // that measurement. it.fails here only until the pulseOnset fix
  // (FeatureFrame.pulseOnset) lands — see this file's git history.
  it.fails("host/TV: metronome keeps running and stays close to the beat", () => {
    for (const name of ["house", "hiphop", "dnb"]) {
      expect(metricsMicHost[name]!.metroRunShare, name).toBeGreaterThanOrEqual(0.8);
      expect(metricsMicHost[name]!.metroOn30ms, name).toBeGreaterThanOrEqual(0.75);
    }
    // eslint-disable-next-line no-console
    console.log(`host/TV random metroRunShare=${metricsMicHost.random!.metroRunShare.toFixed(3)}`);
    expect(metricsMicHost.random!.metroRunShare).toBeLessThanOrEqual(0.3);
  });

  it.fails("render-tick: metronome keeps running and stays close to the beat", () => {
    for (const name of ["house", "hiphop", "dnb"]) {
      expect(metricsMicRender[name]!.metroRunShare, name).toBeGreaterThanOrEqual(0.8);
      expect(metricsMicRender[name]!.metroOn30ms, name).toBeGreaterThanOrEqual(0.75);
    }
    // eslint-disable-next-line no-console
    console.log(`render-tick random metroRunShare=${metricsMicRender.random!.metroRunShare.toFixed(3)}`);
    expect(metricsMicRender.random!.metroRunShare).toBeLessThanOrEqual(0.3);
  });

  it.fails("solo: metronome keeps running and stays close to the beat", () => {
    for (const name of ["house", "hiphop", "dnb"]) {
      expect(metricsMicSolo[name]!.metroRunShare, name).toBeGreaterThanOrEqual(0.8);
      expect(metricsMicSolo[name]!.metroOn30ms, name).toBeGreaterThanOrEqual(0.75);
    }
    // eslint-disable-next-line no-console
    console.log(`solo random metroRunShare=${metricsMicSolo.random!.metroRunShare.toFixed(3)}`);
    expect(metricsMicSolo.random!.metroRunShare).toBeLessThanOrEqual(0.3);
  });
});
