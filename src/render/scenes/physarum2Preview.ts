/**
 * A self-contained, pure-TS port of the "Physarum Lab" prototype's
 * `createStrainPreview` (docs/scenes/physarum2/artifacts/strainPreview.js) —
 * the tiny single-strain Physarum sim behind each specimen box's live
 * pure-culture preview (src/ui/widgets/previews.ts, itemBoxes.ts). No DOM:
 * this module never touches `document`/`canvas`/`ImageData` so it runs and
 * is tested under plain Node (tests/physarum2Preview.test.ts) exactly like
 * every other pure module in src/render/ — the UI side (previews.ts) owns
 * turning `pixels()`'s raw RGBA buffer into an actual on-screen canvas via
 * putImageData.
 *
 * This is deliberately its own tiny torus, not a CPU mirror of the real
 * scene's trail map: a box is meant to look like a zoomed patch of one
 * strain's own network, at a size cheap enough to run four of, continuously,
 * inside the device menu. `motion` (see `StrainPreviewMotion` below) is
 * supplied by the caller in this preview's OWN cell units — the caller
 * (previews.ts) is the one place that converts physarum2.ts's
 * `resolveStrainEffective` (reference-texel units) into these, with one
 * documented constant (REF_TEXELS_PER_PREVIEW_CELL) — so the two simulations
 * share exactly one strain-motion formula (physarum2.ts's file header, "the
 * one strain-motion mapping") even though they run on differently-sized
 * fields.
 */

const TWO_PI = Math.PI * 2;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rnd(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One step's motion, in this preview's own cell units (see the file header)
 *  — the same five numbers strainPreview.js's own `strainMotion()`/
 *  `applySurge()` produced, just supplied directly here instead of computed
 *  from raw slider values, since that computation is now
 *  physarum2.ts's shared `resolveStrainEffective`. */
export interface StrainPreviewMotion {
  /** Radians — the strain's fixed sensor-layout angle (STRAINS entry). */
  sensorAngle: number;
  /** Cells — how far ahead each of the three sensors probes. */
  reach: number;
  /** Radians — how sharply the agent turns when it turns at all. */
  turn: number;
  /** Cells — how far the agent moves this step. */
  step: number;
  /** Absolute amount added to the landed cell's trail value this step. */
  deposit: number;
}

export interface StrainPreview {
  readonly size: number;
  /** Runs exactly one simulation step (agents sense/turn/move/deposit, then
   *  the trail blurs+decays) — see the file header. */
  step(motion: StrainPreviewMotion): void;
  /** Renders the current trail as a flat RGBA buffer (`size*size*4` bytes,
   *  gamma 1/2.2 and the same 0.85 exposure the prototype's own `draw()`
   *  used), tinted by `rgb` (each 0..1). Pure — no DOM; the caller
   *  (previews.ts) is the one that puts this into an actual canvas. */
  pixels(rgb: readonly [number, number, number]): Uint8ClampedArray;
}

// Fraction of agents re-spawned at random each step. A pure culture has no
// rival strain to push against, so without this it keeps coarsening until
// one thick loop holds most of the trail (measured 2026-09-27 with a node
// harness: Spotter reached 76% of its trail in the densest 2% of cells after
// 900 steps with surges). A small constant trickle of fresh agents keeps it
// exploring, which is also what a real plasmodium's growing front does.
const RESPAWN_PER_STEP = 0.005;

// The prototype's own draw() constants — kept identical so a box's preview
// reads at the same brightness/contrast as the approved "Physarum Lab" v3.
const EXPOSURE = 0.85;
const GAMMA_INV = 1 / 2.2;

export interface StrainPreviewOptions {
  size?: number;
  agents?: number;
  seed?: number;
}

export function createStrainPreview(opts: StrainPreviewOptions = {}): StrainPreview {
  const size = Math.max(1, Math.floor(opts.size ?? 64));
  const agents = Math.max(1, Math.floor(opts.agents ?? 2000));
  const rnd = mulberry32(opts.seed ?? 1);
  const CELLS = size * size;
  const trail = new Float32Array(CELLS);
  const tmp = new Float32Array(CELLS);
  const ax = new Float32Array(agents);
  const ay = new Float32Array(agents);
  const ah = new Float32Array(agents);
  for (let i = 0; i < agents; i++) {
    ax[i] = rnd() * size;
    ay[i] = rnd() * size;
    ah[i] = rnd() * TWO_PI;
  }

  const GAMMA = new Float32Array(256);
  for (let i = 0; i < 256; i++) GAMMA[i] = Math.pow(i / 255, GAMMA_INV);

  function sense(x: number, y: number): number {
    // Math.floor, not |0: |0 truncates toward zero, so small negative probe
    // coordinates near the seam wrap to the wrong edge and bias the sensed
    // trail toward row/col 0 -- very visible on this small single-strain
    // torus since there's no other strain's trail to compete against it.
    let xi = Math.floor(x);
    let yi = Math.floor(y);
    xi = ((xi % size) + size) % size;
    yi = ((yi % size) + size) % size;
    return trail[yi * size + xi]!;
  }

  function step(m: StrainPreviewMotion): void {
    for (let i = 0; i < agents; i++) {
      if (rnd() < RESPAWN_PER_STEP) {
        ax[i] = rnd() * size;
        ay[i] = rnd() * size;
        ah[i] = rnd() * TWO_PI;
        continue;
      }
      const h = ah[i]!;
      const x = ax[i]!;
      const y = ay[i]!;
      const sC = sense(x + Math.cos(h) * m.reach, y + Math.sin(h) * m.reach);
      const sL = sense(x + Math.cos(h - m.sensorAngle) * m.reach, y + Math.sin(h - m.sensorAngle) * m.reach);
      const sR = sense(x + Math.cos(h + m.sensorAngle) * m.reach, y + Math.sin(h + m.sensorAngle) * m.reach);
      let nh = h;
      if (sC >= sL && sC >= sR) {
        // hold heading
      } else if (sL > sC && sR > sC) {
        nh += (rnd() < 0.5 ? -1 : 1) * m.turn;
      } else if (sL > sR) {
        nh -= m.turn;
      } else {
        nh += m.turn;
      }
      let nx = x + Math.cos(nh) * m.step;
      let ny = y + Math.sin(nh) * m.step;
      if (nx < 0) nx += size;
      else if (nx >= size) nx -= size;
      if (ny < 0) ny += size;
      else if (ny >= size) ny -= size;
      ax[i] = nx;
      ay[i] = ny;
      ah[i] = nh;
      trail[(ny | 0) * size + (nx | 0)]! += m.deposit;
    }
    // 3x3 box blur (separable, wrapped) + decay -- the same kernel as the
    // dish sim, so a box shows the strain's real grain. RESPAWN_PER_STEP,
    // not a wider blur, is what keeps a pure culture from collapsing.
    for (let y = 0; y < size; y++) {
      const r = y * size;
      for (let x = 0; x < size; x++) {
        tmp[r + x] = trail[r + ((x + size - 1) % size)]! + trail[r + x]! + trail[r + ((x + 1) % size)]!;
      }
    }
    for (let y = 0; y < size; y++) {
      const r = y * size;
      const up = ((y + size - 1) % size) * size;
      const dn = ((y + 1) % size) * size;
      for (let x = 0; x < size; x++) {
        trail[r + x] = (tmp[up + x]! + tmp[r + x]! + tmp[dn + x]!) * (0.9 / 9);
      }
    }
  }

  function pixels(rgb: readonly [number, number, number]): Uint8ClampedArray {
    const out = new Uint8ClampedArray(CELLS * 4);
    for (let p = 0, q = 0; p < CELLS; p++, q += 4) {
      let t = trail[p]! * EXPOSURE;
      if (t > 1) t = 1;
      t = GAMMA[(t * 255) | 0]!;
      out[q] = Math.min(255, t * rgb[0]! * 255);
      out[q + 1] = Math.min(255, t * rgb[1]! * 255);
      out[q + 2] = Math.min(255, t * rgb[2]! * 255);
      out[q + 3] = 255;
    }
    return out;
  }

  return { size, step, pixels };
}
