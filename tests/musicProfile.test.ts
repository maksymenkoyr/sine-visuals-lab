import { describe, it, expect } from "vitest";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import { createMusicProfile, NEUTRAL, type ProfileInputs } from "../src/render/musicProfile.ts";
import { createSyntheticFeed } from "../src/audio/synthetic.ts";

const DT = 1 / 60;
const NEUTRAL_INPUTS: ProfileInputs = { tempoLock: 0, sectionIntensity: 0.5 };

function silentFrame(t: number): FeatureFrame {
  return { time: t, bands: new Float32Array(NUM_BANDS), energy: 0, onset: false, bpm: 0, onsetPhase: 0, level: 0 };
}

function constantBandsFrame(t: number, bands: Float32Array, level = 0.6): FeatureFrame {
  let energy = 0;
  for (let b = 0; b < NUM_BANDS; b++) energy += bands[b];
  return { time: t, bands, energy: energy / NUM_BANDS, onset: false, bpm: 0, onsetPhase: 0, level };
}

function bassHeavyBands(): Float32Array {
  const bands = new Float32Array(NUM_BANDS);
  for (let b = 0; b < NUM_BANDS; b++) bands[b] = b < 4 ? 0.8 : 0.02;
  return bands;
}

function trebleHeavyBands(): Float32Array {
  const bands = new Float32Array(NUM_BANDS);
  for (let b = 0; b < NUM_BANDS; b++) bands[b] = b >= NUM_BANDS - 4 ? 0.8 : 0.02;
  return bands;
}

function soloBands(): Float32Array {
  const bands = new Float32Array(NUM_BANDS);
  bands[10] = 0.9;
  return bands;
}

function fullMixBands(seed: number): Float32Array {
  const bands = new Float32Array(NUM_BANDS);
  for (let b = 0; b < NUM_BANDS; b++) bands[b] = 0.55 + 0.2 * Math.sin(b * 1.7 + seed);
  return bands;
}

describe("music profile", () => {
  it("starts every dial at NEUTRAL", () => {
    const p = createMusicProfile();
    for (const dial of Object.keys(NEUTRAL) as (keyof typeof NEUTRAL)[]) {
      expect(p[dial]).toBe(NEUTRAL[dial]);
    }
  });

  // The regression test for a real bug: pulse/dynamics/attack originally
  // drifted toward their low extreme during genuine silence instead of
  // holding neutral (only brightness/density had a silence gate). All six
  // must hold at exactly NEUTRAL through a long stretch of true silence.
  it("holds every dial at NEUTRAL through 10s of genuine silence", () => {
    const p = createMusicProfile();
    for (let i = 0; i < 600; i++) p.advance(DT, silentFrame(i * DT), NEUTRAL_INPUTS);
    for (const dial of Object.keys(NEUTRAL) as (keyof typeof NEUTRAL)[]) {
      expect(p[dial]).toBeCloseTo(NEUTRAL[dial], 5);
    }
  });

  it("separates pulse and tempo for a locked four-on-the-floor beat vs. a beatless pad", () => {
    const beatFeed = createSyntheticFeed({ bpm: 170 });
    const beaty = createMusicProfile();
    for (let i = 0; i < 900; i++) {
      const t = i * DT;
      beaty.advance(DT, beatFeed.frame(t), { tempoLock: 1, sectionIntensity: 0.5 });
    }

    const pad = createMusicProfile();
    const padBands = bassHeavyBands();
    for (let i = 0; i < 900; i++) {
      pad.advance(DT, constantBandsFrame(i * DT, padBands), { tempoLock: 0, sectionIntensity: 0.5 });
    }

    expect(beaty.pulse).toBeGreaterThan(pad.pulse);
    expect(beaty.pulse).toBeGreaterThan(0.6);
    expect(pad.pulse).toBeLessThan(0.4);

    expect(beaty.tempo).toBeGreaterThan(0.6); // 170bpm, locked, folds toward BPM_HIGH end
    expect(pad.tempo).toBeCloseTo(0.5, 1); // unlocked -> folds to neutral regardless of bpm
  });

  it("separates brightness for a bass-heavy vs. treble-heavy spectrum", () => {
    const dark = createMusicProfile();
    const bass = bassHeavyBands();
    for (let i = 0; i < 600; i++) dark.advance(DT, constantBandsFrame(i * DT, bass), NEUTRAL_INPUTS);

    const bright = createMusicProfile();
    const treble = trebleHeavyBands();
    for (let i = 0; i < 600; i++) bright.advance(DT, constantBandsFrame(i * DT, treble), NEUTRAL_INPUTS);

    expect(bright.brightness).toBeGreaterThan(dark.brightness);
    expect(dark.brightness).toBeLessThan(0.4);
    expect(bright.brightness).toBeGreaterThan(0.6);
  });

  it("separates density for a solo instrument vs. a full mix", () => {
    const solo = createMusicProfile();
    const soloB = soloBands();
    for (let i = 0; i < 600; i++) solo.advance(DT, constantBandsFrame(i * DT, soloB), NEUTRAL_INPUTS);

    const full = createMusicProfile();
    for (let i = 0; i < 600; i++) full.advance(DT, constantBandsFrame(i * DT, fullMixBands(i * 0.01)), NEUTRAL_INPUTS);

    expect(full.density).toBeGreaterThan(solo.density);
    expect(solo.density).toBeLessThan(0.3);
    expect(full.density).toBeGreaterThan(0.6);
  });

  it("separates dynamics for a steady level vs. a swelling one", () => {
    const bands = fullMixBands(0);
    const steady = createMusicProfile();
    for (let i = 0; i < 3600; i++) {
      steady.advance(DT, constantBandsFrame(i * DT, bands), { tempoLock: 0, sectionIntensity: 0.5 });
    }

    const swelling = createMusicProfile();
    for (let i = 0; i < 3600; i++) {
      // Slow swing between quiet verses and loud choruses, well within the
      // dynamics estimator's ~10-25s time constants (see musicProfile.ts).
      const intensity = 0.5 + 0.45 * Math.sin(i * DT * (2 * Math.PI) / 20);
      swelling.advance(DT, constantBandsFrame(i * DT, bands), { tempoLock: 0, sectionIntensity: intensity });
    }

    // A generous margin rather than a hand-derived absolute bound: the MAD
    // estimator's own ~25s time constant lags behind sectionIntensity's
    // initial 0->0.5 settle, so steady's dynamics doesn't reach exactly 0
    // in a finite run — what matters is the two read clearly apart.
    expect(swelling.dynamics).toBeGreaterThan(steady.dynamics + 0.3);
  });

  it("separates attack for a transient-heavy signal vs. a sustained one", () => {
    const sustained = createMusicProfile();
    const sustainedBands = fullMixBands(0);
    for (let i = 0; i < 900; i++) {
      sustained.advance(DT, constantBandsFrame(i * DT, sustainedBands), NEUTRAL_INPUTS);
    }

    const transient = createMusicProfile();
    for (let i = 0; i < 900; i++) {
      // Sharp spike every 10 ticks, silence between -- big band-to-band flux.
      const bands = i % 10 === 0 ? fullMixBands(0) : new Float32Array(NUM_BANDS);
      transient.advance(DT, constantBandsFrame(i * DT, bands), NEUTRAL_INPUTS);
    }

    expect(transient.attack).toBeGreaterThan(sustained.attack);
  });

  // The regression test for the bug this whole change fixes: auto mode was
  // structurally blind to the room getting quieter or louder because none
  // of the other six dials carry absolute level (they're all scale-free —
  // spectral shape, ratios, event rates). `loudness` reads FeatureFrame.level
  // directly and must be the one dial that actually separates here, while
  // the other six — driven off the *same* band pattern at both volumes —
  // stay close, proving this isn't just injecting noise into everything.
  it("separates loudness for a quiet vs. loud room with the identical band pattern", () => {
    const bands = fullMixBands(0);

    const quiet = createMusicProfile();
    for (let i = 0; i < 600; i++) quiet.advance(DT, constantBandsFrame(i * DT, bands, 0.15), NEUTRAL_INPUTS);

    const loud = createMusicProfile();
    for (let i = 0; i < 600; i++) loud.advance(DT, constantBandsFrame(i * DT, bands, 0.85), NEUTRAL_INPUTS);

    expect(loud.loudness).toBeGreaterThan(quiet.loudness + 0.3);

    for (const dial of ["pulse", "tempo", "brightness", "density", "dynamics", "attack"] as const) {
      expect(Math.abs(loud[dial] - quiet[dial])).toBeLessThan(0.05);
    }
  });

  it("freezes loudness (does not ease toward NEUTRAL) through silence, unlike every other dial", () => {
    const p = createMusicProfile();
    const bands = fullMixBands(0);
    for (let i = 0; i < 300; i++) p.advance(DT, constantBandsFrame(i * DT, bands, 0.9), NEUTRAL_INPUTS);
    const loudBeforeSilence = p.loudness;
    expect(loudBeforeSilence).toBeGreaterThan(0.6);

    for (let i = 0; i < 600; i++) p.advance(DT, silentFrame(i * DT), NEUTRAL_INPUTS);
    expect(p.loudness).toBeCloseTo(loudBeforeSilence, 5);
  });

  it("never produces NaN or out-of-range dials across a long, varied run", () => {
    const p = createMusicProfile();
    const feed = createSyntheticFeed({ bpm: 128 });
    for (let i = 0; i < 3000; i++) {
      const t = i * DT;
      const inputs: ProfileInputs = { tempoLock: 0.5 + 0.5 * Math.sin(t * 0.1), sectionIntensity: 0.5 + 0.5 * Math.sin(t * 0.05) };
      p.advance(DT, feed.frame(t), inputs);
      for (const dial of Object.keys(NEUTRAL) as (keyof typeof NEUTRAL)[]) {
        expect(Number.isFinite(p[dial])).toBe(true);
        expect(p[dial]).toBeGreaterThanOrEqual(0);
        expect(p[dial]).toBeLessThanOrEqual(1);
        // targets feeds the meters panel's RAW chip (audioMeters.ts) — same
        // range guarantee as the eased dial it's the pre-ease measurement for.
        expect(Number.isFinite(p.targets[dial])).toBe(true);
        expect(p.targets[dial]).toBeGreaterThanOrEqual(0);
        expect(p.targets[dial]).toBeLessThanOrEqual(1);
      }
    }
  });

  // targets is what the meters panel's RAW chip shows in place of the eased
  // dials: it should track a hard spectral swap immediately, while brightness
  // itself (settled dark over a long run) barely moves on that single tick.
  it("targets.brightness reacts within a frame while brightness itself lags", () => {
    const p = createMusicProfile();
    const bass = bassHeavyBands();
    for (let i = 0; i < 600; i++) p.advance(DT, constantBandsFrame(i * DT, bass), NEUTRAL_INPUTS);
    const brightnessBeforeSwap = p.brightness;
    expect(brightnessBeforeSwap).toBeLessThan(0.4);

    p.advance(DT, constantBandsFrame(600 * DT, trebleHeavyBands()), NEUTRAL_INPUTS);
    expect(p.targets.brightness).toBeGreaterThan(0.6);
    expect(p.brightness).toBeCloseTo(brightnessBeforeSwap, 1);
  });

  // loudness itself freezes (doesn't ease to NEUTRAL) through silence — see
  // the dedicated test above. targets.loudness must hold the same last
  // reading rather than reporting silence as a raw 0, or RAW mode would
  // contradict the dial it's meant to be the unsmoothed view of.
  it("freezes targets.loudness through silence, matching the loudness dial itself", () => {
    const p = createMusicProfile();
    const bands = fullMixBands(0);
    for (let i = 0; i < 300; i++) p.advance(DT, constantBandsFrame(i * DT, bands, 0.9), NEUTRAL_INPUTS);
    const targetBeforeSilence = p.targets.loudness;
    expect(targetBeforeSilence).toBeGreaterThan(0.6);

    for (let i = 0; i < 600; i++) p.advance(DT, silentFrame(i * DT), NEUTRAL_INPUTS);
    expect(p.targets.loudness).toBeCloseTo(targetBeforeSilence, 5);
  });

  // Session-ranking cold start: the rankers are seeded with shipped priors,
  // so material at the extreme of what music in general does must score
  // extreme from the first seconds — no warm-up blindness where everything
  // reads "medium" until the session has heard its opposite.
  it("scores spectral extremes as extreme within seconds of a cold start (shipped priors)", () => {
    const bright = createMusicProfile();
    const treble = trebleHeavyBands();
    for (let i = 0; i < 120; i++) bright.advance(DT, constantBandsFrame(i * DT, treble), NEUTRAL_INPUTS); // 2s
    expect(bright.targets.brightness).toBeGreaterThan(0.8);

    const dark = createMusicProfile();
    const bass = bassHeavyBands();
    for (let i = 0; i < 120; i++) dark.advance(DT, constantBandsFrame(i * DT, bass), NEUTRAL_INPUTS);
    expect(dark.targets.brightness).toBeLessThan(0.2);
  });

  // The min-spread guard: a monotonous night must not shrink a ranker's
  // range so tight that tiny spectral wobbles read as full-range dial
  // swings — the session range never collapses below RANK_MIN_SPREAD of the
  // shipped prior's spread.
  it("does not turn small wobbles into full-range brightness swings after minutes of monotony", () => {
    const p = createMusicProfile();
    const bands = new Float32Array(NUM_BANDS);
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < 60 * 300; i++) {
      // A bass pad with a gentle wobble on the top bands — a small centroid
      // oscillation around an otherwise constant spectrum, for 5 minutes.
      const wobble = 0.02 + 0.015 * Math.sin(i * DT * 1.3);
      for (let b = 0; b < NUM_BANDS; b++) bands[b] = b < 4 ? 0.8 : wobble;
      p.advance(DT, constantBandsFrame(i * DT, bands), NEUTRAL_INPUTS);
      if (i > 60 * 240) {
        // Track the swing over the final minute, after any collapse would
        // have happened.
        if (p.targets.brightness < lo) lo = p.targets.brightness;
        if (p.targets.brightness > hi) hi = p.targets.brightness;
      }
    }
    expect(hi - lo).toBeLessThan(0.5);
  });
  // at the Smoothing row's Off stop (deviceMenu.ts) — ease() must assign the
  // target directly rather than compute a Math.min(1, rate*dt*scale)
  // coefficient, so every dial lands exactly on `targets`, which is what the
  // meters panel's RAW chip already shows. Exercised over a musical feed
  // (not just constant bands) so attack/pulse/tempo actually vary tick to
  // tick, not just brightness/density/dynamics/loudness.
  it("at rateScale=Infinity, every dial equals its target exactly, every tick", () => {
    const p = createMusicProfile();
    const feed = createSyntheticFeed({ bpm: 128 });
    for (let i = 0; i < 900; i++) {
      const t = i * DT;
      const inputs: ProfileInputs = { tempoLock: 0.5 + 0.5 * Math.sin(t * 0.1), sectionIntensity: 0.5 + 0.5 * Math.sin(t * 0.05) };
      p.advance(DT, feed.frame(t), inputs, Infinity);
      for (const dial of Object.keys(NEUTRAL) as (keyof typeof NEUTRAL)[]) {
        expect(Number.isFinite(p[dial])).toBe(true);
        expect(p[dial]).toBe(p.targets[dial]);
      }
    }
  });
});
