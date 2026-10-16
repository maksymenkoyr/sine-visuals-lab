/**
 * A crude small-speaker -> room -> mic chain: almost no bass (a 2nd-order
 * high-pass at `hpHz`, applied twice), a few feedback combs standing in for
 * room reverb (`wet` mix), background noise at `noiseDb`, and an overall
 * level drop (`gainDb`) — the conditions the app actually hears through a
 * phone mic rather than a track's own clean master. Ported from the probe
 * that measured tests/tempoEval.test.ts's "through a mic, silence gate on"
 * block's baseline (see that file's own header for the numbers): same
 * algorithm, `sr` taken as a parameter instead of a module-level constant so
 * this can run against any track (tempoEval/synth.ts's tracks are all at
 * synth.ts's own SR, but nothing here should assume that).
 *
 * The `hpHz` and `gainDb` defaults are fitted to phone recordings of a real
 * party (tests/tempoRecordings.test.ts's room table): a party PA keeps far
 * more bass than a small speaker, and the phone heard the music louder than
 * this chain first assumed. `wet` and `noiseDb` are not fitted: the party's
 * hits do fade slower than here, but these combs can't slow the fade without
 * filling the gaps between hits far above the party's, and how fast a hit
 * fades depends as much on the music, whose clean original we don't have.
 */

export interface MicChainOpts {
  /** High-pass cutoff, Hz — applied twice (two cascaded 2nd-order stages). */
  hpHz?: number;
  /** Room-reverb wet mix, 0..1 (0 = dry, unprocessed signal only). */
  wet?: number;
  /** Background noise floor, dBFS. */
  noiseDb?: number;
  /** Overall level, dB (typically negative — a room is quieter than the source). */
  gainDb?: number;
}

export function micChain(mono: Float32Array, sr: number, opts: MicChainOpts = {}): Float32Array {
  const hp = opts.hpHz ?? 110;
  const wet = opts.wet ?? 0.35;
  const noiseDb = opts.noiseDb ?? -45;
  const gainDb = opts.gainDb ?? -5;

  const y = Float32Array.from(mono);
  for (let pass = 0; pass < 2; pass++) {
    const w0 = (2 * Math.PI * hp) / sr;
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    const c = Math.cos(w0);
    const b0 = (1 + c) / 2;
    const b1 = -(1 + c);
    const b2 = (1 + c) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * c;
    const a2 = 1 - alpha;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const xi = y[i]!;
      const yi = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = yi;
      y[i] = yi;
    }
  }

  // Schroeder-style feedback combs standing in for room reverb — not a real
  // impulse response, just enough smear to make the flux/onset detector see
  // something other than a bone-dry signal.
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.round((d * sr) / 44100));
  const rev = new Float32Array(y.length);
  for (const d of combs) {
    const buf = new Float32Array(d);
    let k = 0;
    for (let i = 0; i < y.length; i++) {
      const out = buf[k]!;
      buf[k] = y[i]! + out * 0.8;
      rev[i] += out * 0.25;
      k = (k + 1) % d;
    }
  }

  const out = new Float32Array(y.length);
  // Deterministic RNG (LCG), never Math.random — this harness must be
  // bit-for-bit repeatable like the rest of tempoEval.
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const g = Math.pow(10, gainDb / 20);
  const nz = Math.pow(10, noiseDb / 20);
  for (let i = 0; i < y.length; i++) out[i] = ((1 - wet) * y[i]! + wet * rev[i]!) * g + nz * rnd();
  return out;
}
