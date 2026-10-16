// The high-precision half of Fractal Grid's deep zoom: one reference orbit
// per dive target, computed here on the CPU, which the GPU iterates every
// pixel against (index.ts's FRAG, "perturbation"). Deep in a dive, pixels sit
// so close together that 32-bit floats can't tell their c values apart, but
// each pixel's *offset* from the target is a perfectly ordinary small float.
// Writing z = Z + δ, where Z is the target's own orbit, the iteration
// z → z² + c becomes δ → 2Zδ + δ² + δc, which only ever multiplies small
// numbers by the reference — so the GPU needs Z rounded to 32 bits, but Z
// itself must be computed far more precisely than any pixel spacing.
//
// That precision is double-double arithmetic: each number is an unevaluated
// sum hi + lo of two doubles, about 32 significant digits, built from the
// exact error terms of a double addition (twoSum) and multiplication
// (twoProd, Dekker's split). Plain numbers rather than BigInt, because the
// build targets TV browsers that predate BigInt (vite.config.ts, `target`).
// MAX_DEPTH in motion.ts is where that precision stops being enough.
//
// The orbit is stored up to and including its first escaped point (or
// MAX_REF_LEN points): the shader rebases a pixel onto the start of the
// orbit when it runs past the end, so a short orbit is fine — see FRAG.

import type { DiveTarget } from "./motion.ts";

/** Longest reference orbit kept, points. */
export const MAX_REF_LEN = 4096;
/** Escape radius² for the reference; matches the shader's. */
export const REF_ESCAPE_R2 = 1024;

const SPLIT = 134217729; // 2^27 + 1, Dekker's splitter for 53-bit doubles

/** A double-double: value = hi + lo, |lo| ≤ half an ulp of hi. */
interface DD {
  hi: number;
  lo: number;
}

function twoSum(a: number, b: number): DD {
  const s = a + b;
  const bb = s - a;
  return { hi: s, lo: a - (s - bb) + (b - bb) };
}

function quickTwoSum(a: number, b: number): DD {
  const s = a + b;
  return { hi: s, lo: b - (s - a) };
}

function twoProd(a: number, b: number): DD {
  const p = a * b;
  const ta = SPLIT * a;
  const aHi = ta - (ta - a);
  const aLo = a - aHi;
  const tb = SPLIT * b;
  const bHi = tb - (tb - b);
  const bLo = b - bHi;
  return { hi: p, lo: aHi * bHi - p + aHi * bLo + aLo * bHi + aLo * bLo };
}

export function ddAdd(a: DD, b: DD): DD {
  const s = twoSum(a.hi, b.hi);
  return quickTwoSum(s.hi, s.lo + a.lo + b.lo);
}

export function ddMul(a: DD, b: DD): DD {
  const p = twoProd(a.hi, b.hi);
  return quickTwoSum(p.hi, p.lo + a.hi * b.lo + a.lo * b.hi);
}

function ddScale(a: DD, k: number): DD {
  // Exact for a power-of-two k, which is all this file needs (2xy).
  return { hi: a.hi * k, lo: a.lo * k };
}

function ddNeg(a: DD): DD {
  return { hi: -a.hi, lo: -a.lo };
}

export interface ReferenceOrbit {
  /** x, y pairs as 32-bit floats, `length + 1` points (the last may have
   *  escaped). */
  points: Float32Array;
  /** Points a pixel may continue from; at this index it must rebase. */
  length: number;
}

/** The target's critical orbit Z₀ = 0, Z₁ = c, … in double-double, rounded
 *  to 32-bit floats for the GPU. */
export function referenceOrbit(target: DiveTarget, maxLen: number = MAX_REF_LEN): ReferenceOrbit {
  const cx: DD = { hi: target.reHi, lo: target.reLo };
  const cy: DD = { hi: target.imHi, lo: target.imLo };
  const points = new Float32Array(2 * (maxLen + 1));
  let x: DD = { hi: 0, lo: 0 };
  let y: DD = { hi: 0, lo: 0 };
  let n = 0;
  for (; n < maxLen; n++) {
    points[2 * n] = x.hi + x.lo;
    points[2 * n + 1] = y.hi + y.lo;
    const xx = ddMul(x, x);
    const yy = ddMul(y, y);
    const xy = ddMul(x, y);
    const nx = ddAdd(ddAdd(xx, ddNeg(yy)), cx);
    const ny = ddAdd(ddScale(xy, 2), cy);
    x = nx;
    y = ny;
    const r2 = x.hi * x.hi + y.hi * y.hi;
    if (!(r2 <= REF_ESCAPE_R2)) {
      n++;
      break;
    }
  }
  points[2 * n] = x.hi + x.lo;
  points[2 * n + 1] = y.hi + y.lo;
  return { points: points.subarray(0, 2 * (n + 1)), length: n };
}
