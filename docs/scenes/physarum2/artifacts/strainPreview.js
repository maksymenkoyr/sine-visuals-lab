// Shared strain-motion mapping + a tiny standalone Physarum stepper used by
// each specimen box's pure-culture preview in the Strains card. Inlined by
// build.mjs at the /*PREVIEW*/ marker (loads before the main app script, in
// the same <script> scope -- these are plain globals, not a module).
//
// The point of putting strainMotion() and applySurge() here, instead of
// inline in the dish sim, is so the MAIN dish and every preview box call the
// exact same two functions to turn a strain's settings into sense-angle /
// reach / turn / step / deposit. A box's preview is meant to literally BE an
// example of that strain, so the two must never drift apart.

const DEG = Math.PI / 180;

// eff: { sa (deg, fixed per strain), nutrient, sensor, turn, speed } -- all
// 0..1 except sa. Returns the five numbers a Physarum step needs.
function strainMotion(eff) {
  return {
    sensorAngle: eff.sa * DEG,
    reach: 1.2 + eff.sensor * 13,
    turn: (4 + eff.turn * 110) * DEG,
    step: 0.25 + eff.speed * 1.9,
    deposit: 0.07 * eff.nutrient,
  };
}

// Excitability is a per-frame (value, instant drive) pair rather than one
// effective number, so it's applied as a multiplier after strainMotion()
// instead of folded into it. Both the dish and the previews call this too.
function applySurge(step, excValue, excDrive) {
  return step * (1 + excValue * 3.5 * excDrive);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A self-contained pure-culture Physarum sim: one strain, its own trail, on
// a small torus. `step(motion)` takes the object strainMotion()+applySurge()
// produced; `draw(ctx, rgb)` renders the trail into a 2D context in rgb
// (0..1 each).
// Fraction of agents re-spawned at random each step. A pure culture has no
// rival strain to push against, so without this it keeps coarsening until
// one thick loop holds most of the trail (measured 2026-09-27 with a node
// harness: Spotter reached 76% of its trail in the densest 2% of cells after
// 900 steps with surges). A small constant trickle of fresh agents keeps it
// exploring, which is also what a real plasmodium's growing front does.
const RESPAWN_PER_STEP = 0.005;

function createStrainPreview({ size = 64, agents = 2000, seed = 1 } = {}) {
  const rnd = mulberry32(seed);
  const CELLS = size * size;
  const trail = new Float32Array(CELLS);
  const tmp = new Float32Array(CELLS);
  const ax = new Float32Array(agents);
  const ay = new Float32Array(agents);
  const ah = new Float32Array(agents);
  for (let i = 0; i < agents; i++) {
    ax[i] = rnd() * size;
    ay[i] = rnd() * size;
    ah[i] = rnd() * Math.PI * 2;
  }

  const off = document.createElement("canvas");
  off.width = size; off.height = size;
  const octx = off.getContext("2d");
  const img = octx.createImageData(size, size);
  const GAMMA = new Float32Array(256);
  for (let i = 0; i < 256; i++) GAMMA[i] = Math.pow(i / 255, 1 / 2.2);

  function sense(x, y) {
    // Math.floor, not |0: |0 truncates toward zero, so small negative probe
    // coordinates near the seam wrap to the wrong edge and bias the sensed
    // trail toward row/col 0 -- very visible on this small single-strain
    // torus since there's no other strain's trail to compete against it.
    let xi = Math.floor(x), yi = Math.floor(y);
    xi = ((xi % size) + size) % size;
    yi = ((yi % size) + size) % size;
    return trail[yi * size + xi];
  }

  function step(m) {
    for (let i = 0; i < agents; i++) {
      if (rnd() < RESPAWN_PER_STEP) {
        ax[i] = rnd() * size; ay[i] = rnd() * size; ah[i] = rnd() * Math.PI * 2;
        continue;
      }
      const h = ah[i], x = ax[i], y = ay[i];
      const sC = sense(x + Math.cos(h) * m.reach, y + Math.sin(h) * m.reach);
      const sL = sense(x + Math.cos(h - m.sensorAngle) * m.reach, y + Math.sin(h - m.sensorAngle) * m.reach);
      const sR = sense(x + Math.cos(h + m.sensorAngle) * m.reach, y + Math.sin(h + m.sensorAngle) * m.reach);
      let nh = h;
      if (sC >= sL && sC >= sR) { /* hold heading */ }
      else if (sL > sC && sR > sC) nh += (rnd() < 0.5 ? -1 : 1) * m.turn;
      else if (sL > sR) nh -= m.turn;
      else nh += m.turn;
      let nx = x + Math.cos(nh) * m.step;
      let ny = y + Math.sin(nh) * m.step;
      if (nx < 0) nx += size; else if (nx >= size) nx -= size;
      if (ny < 0) ny += size; else if (ny >= size) ny -= size;
      ax[i] = nx; ay[i] = ny; ah[i] = nh;
      trail[(ny | 0) * size + (nx | 0)] += m.deposit;
    }
    // 3x3 box blur (separable, wrapped) + decay -- the same kernel as the
    // dish sim, so a box shows the strain's real grain. RESPAWN_PER_STEP,
    // not a wider blur, is what keeps a pure culture from collapsing.
    for (let y = 0; y < size; y++) {
      const r = y * size;
      for (let x = 0; x < size; x++) {
        tmp[r + x] = trail[r + ((x + size - 1) % size)] + trail[r + x] + trail[r + ((x + 1) % size)];
      }
    }
    for (let y = 0; y < size; y++) {
      const r = y * size, up = ((y + size - 1) % size) * size, dn = ((y + 1) % size) * size;
      for (let x = 0; x < size; x++) {
        trail[r + x] = (tmp[up + x] + tmp[r + x] + tmp[dn + x]) * (0.9 / 9);
      }
    }
  }

  function draw(ctx, rgb) {
    const d = img.data;
    for (let p = 0, q = 0; p < CELLS; p++, q += 4) {
      let t = trail[p] * 0.85;
      if (t > 1) t = 1;
      t = GAMMA[(t * 255) | 0];
      d[q] = Math.min(255, t * rgb[0] * 255);
      d[q + 1] = Math.min(255, t * rgb[1] * 255);
      d[q + 2] = Math.min(255, t * rgb[2] * 255);
      d[q + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(off, 0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  return { step, draw };
}
