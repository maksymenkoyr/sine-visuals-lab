// Second-order IIR sections (the standard bilinear-transform designs) and
// cascades of them, run sample by sample so band levels (bands.ts) see a hit
// within the block it arrives in.

export type FilterKind = "lowpass" | "highpass";

export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(kind: FilterKind, hz: number, sampleRate: number, q = Math.SQRT1_2) {
    const w = (2 * Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const side = kind === "lowpass" ? (1 - cw) / 2 : (1 + cw) / 2;
    this.b0 = side / a0;
    this.b1 = (kind === "lowpass" ? 1 - cw : -(1 + cw)) / a0;
    this.b2 = side / a0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    // Flushing denormals: a decaying tail in plain JS doubles otherwise costs far more per sample.
    this.y1 = Math.abs(y) < 1e-25 ? 0 : y;
    return y;
  }
}

/**
 * A Linkwitz-Riley crossover side: two identical Butterworth sections, -6 dB
 * at `hz` and 24 dB/octave beyond it, so neighbouring bands sum flat and leak
 * little into each other.
 */
export function linkwitzRiley(kind: FilterKind, hz: number, sampleRate: number): Biquad[] {
  return [new Biquad(kind, hz, sampleRate), new Biquad(kind, hz, sampleRate)];
}

export function runChain(chain: Biquad[], x: number): number {
  for (let i = 0; i < chain.length; i++) x = chain[i].step(x);
  return x;
}
