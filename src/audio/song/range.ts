// Copied from audio-subsystem/v6 (2026-10-30, #798/#800); the bench check (bench-signals' probe app-song) holds it equal to v6. Edits: the exports nothing uses are not exported, and RANGERS_FOR is removed.
// Turns a raw song field into 0..1 for a scene (#798). The raw fields keep their sources' scales because the bench's rank
// scoring never needed 0..1; a scene does, and a fixed divisor would not do: loudness and the drop level sit at different
// heights on a quiet mic and on line-in. Each ranger is causal (only the past), takes the frame's dt, and clips to 0..1.
// Which ranger each field uses was picked by measurement: bench-signals/src/rich/v6-range-pick.ts, see RANGES in ../song.ts.

export type RangedField = "loudness" | "hatLevel" | "chordLevel" | "dropLevel" | "inDrop";

export interface Ranger {
  step(value: number, dt: number): number;
}

const unit = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

/** value / a running peak that falls back with time constant `releaseS`; `floor` stops a near-silent signal from being stretched to 1. */
class PeakRange implements Ranger {
  private peak = 0;
  private readonly releaseS: number;
  private readonly floor: number;
  constructor(releaseS: number, floor: number) {
    this.releaseS = releaseS;
    this.floor = floor;
  }

  step(value: number, dt: number): number {
    this.peak = Math.max(value, this.peak * Math.exp(-dt / this.releaseS));
    return unit(value / Math.max(this.peak, this.floor));
  }
}

/** Position between a running minimum and maximum that each drift toward the signal with time constant `timeS`; `minSpan` keeps a flat signal from being stretched. */
class MinMaxRange implements Ranger {
  private lo = NaN;
  private hi = NaN;
  private readonly timeS: number;
  private readonly minSpan: number;
  constructor(timeS: number, minSpan: number) {
    this.timeS = timeS;
    this.minSpan = minSpan;
  }

  step(value: number, dt: number): number {
    if (Number.isNaN(this.lo)) this.lo = this.hi = value;
    const k = 1 - Math.exp(-dt / this.timeS);
    this.lo = Math.min(value, this.lo + (value - this.lo) * k);
    this.hi = Math.max(value, this.hi + (value - this.hi) * k);
    return unit((value - this.lo) / Math.max(this.hi - this.lo, this.minSpan));
  }
}

/** value / top, for a level that already has a natural scale (a detector's score over its own firing mark). */
class FixedTop implements Ranger {
  private readonly top: number;
  constructor(top: number) {
    this.top = top;
  }

  step(value: number): number {
    return unit(value / this.top);
  }
}

/** A level in dB: `ceilDb` reads 1 and `ceilDb - spanDb` reads 0. Static, so it keeps the raw level's order, which the adaptive rangers do not. */
class DbRange implements Ranger {
  private readonly ceilDb: number;
  private readonly spanDb: number;
  constructor(ceilDb: number, spanDb: number) {
    this.ceilDb = ceilDb;
    this.spanDb = spanDb;
  }

  step(value: number): number {
    return value > 0 ? unit((20 * Math.log10(value) - (this.ceilDb - this.spanDb)) / this.spanDb) : 0;
  }
}

/** (value - lo) / (hi - lo), clipped: a static offset map, so it keeps the raw level's order but uses the whole 0..1 for the span the level really moves in. */
class AffineRange implements Ranger {
  private readonly lo: number;
  private readonly hi: number;
  constructor(lo: number, hi: number) {
    this.lo = lo;
    this.hi = hi;
  }

  step(value: number): number {
    return unit((value - this.lo) / (this.hi - this.lo));
  }
}

type RangerSpec =
  | { kind: "peak"; releaseS: number }
  | { kind: "minmax"; timeS: number }
  | { kind: "top"; top: number }
  | { kind: "db"; spanDb: number }
  | { kind: "fixed"; times: number }
  | { kind: "affine" };

// Measured 2026-10-30 on the rich song's line-in case, seeds 1 and 2, over the frames inside music, from the raw traces of
// bench-signals/results/rich-v6-tune3 (`node src/rich/v6-range-pick.ts --measure`): the 99.9th percentile of the loudness in
// dB, the 99.5th percentile of the drop level, and for the affine drop ranger its 5th percentile and 1.1 times its maximum.
// A different song or input level moves all of them; they anchor the static rangers.
const STATIC_RANGE = { loudnessCeilDb: -10.0527, dropTop: 0.6023, dropLow: 0.3745, dropHigh: 0.6708 };

/** The smallest value a ranger divides by: the floor of a peak ranger, the minimum span of a min-max one. */
const RANGE_FLOOR: Record<RangedField, number> = {
  loudness: 0.002,
  inDrop: 0.01,
  dropLevel: 0.02,
  // A detector's score over its firing mark reads 1 at the mark, so a span or peak under 1 would stretch noise.
  hatLevel: 1,
  chordLevel: 1,
};

/** Every ranger the bench scored, by name; a field's pick is RANGES in ../song.ts. */
const RANGERS: Record<string, RangerSpec> = {
  peak10: { kind: "peak", releaseS: 10 },
  peak30: { kind: "peak", releaseS: 30 },
  peak60: { kind: "peak", releaseS: 60 },
  peak120: { kind: "peak", releaseS: 120 },
  minmax30: { kind: "minmax", timeS: 30 },
  minmax60: { kind: "minmax", timeS: 60 },
  minmax120: { kind: "minmax", timeS: 120 },
  top2: { kind: "top", top: 2 },
  top3: { kind: "top", top: 3 },
  top4: { kind: "top", top: 4 },
  // For a level that is 0..1 already and only needs clipping.
  top1: { kind: "top", top: 1 },
  db30: { kind: "db", spanDb: 30 },
  db40: { kind: "db", spanDb: 40 },
  db50: { kind: "db", spanDb: 50 },
  db60: { kind: "db", spanDb: 60 },
  // The value is `times` x STATIC_RANGE.dropTop at 1; "05" is 0.5, as an id cannot hold a dot.
  fixed05: { kind: "fixed", times: 0.5 },
  fixed1: { kind: "fixed", times: 1 },
  fixed2: { kind: "fixed", times: 2 },
  affine: { kind: "affine" },
};


export function makeRanger(name: string, field: RangedField): Ranger {
  const spec = RANGERS[name];
  if (!spec) throw new Error(`no ranger called ${name}`);
  switch (spec.kind) {
    case "peak":
      return new PeakRange(spec.releaseS, RANGE_FLOOR[field]);
    case "minmax":
      return new MinMaxRange(spec.timeS, RANGE_FLOOR[field]);
    case "top":
      return new FixedTop(spec.top);
    case "db":
      return new DbRange(STATIC_RANGE.loudnessCeilDb, spec.spanDb);
    case "fixed":
      return new FixedTop(spec.times * STATIC_RANGE.dropTop);
    case "affine":
      return new AffineRange(STATIC_RANGE.dropLow, STATIC_RANGE.dropHigh);
  }
}
