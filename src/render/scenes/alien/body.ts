/**
 * The alien's body as a signed-distance field, posed on the dancers' rig
 * (../dancers/rig.ts) in its bind pose — the T-pose captured motion is
 * retargeted against — so mesh.ts can sample it once, turn it into
 * triangles, and skin every vertex to the bones whose shapes it came from.
 *
 * Shapes are data, not code: each `Part` names the bone it rides on and is
 * written in that bone's own frame (+Y along the bone, +Z its front at rest),
 * so the proportions read as "how fat is the thigh", never as world
 * coordinates. Parts union in list order with a polynomial smooth min of
 * their own blend width; `carve` parts are subtracted afterwards (the eye
 * sockets), then `inlay` parts are added back with almost no blend (the eyes
 * sitting in them, leaving a crease the wireframe draws as a dense outline).
 *
 * The figure is a classic "grey": a bulbous cranium over a narrow face,
 * big almond eyes tilted up at the outer corner, a thin neck, a slender
 * torso, long thin limbs and three long fingers plus a thumb. The rig's
 * bone lengths are fixed by the captured clips, so the alien's look comes
 * from radii and the head alone.
 *
 * The head and each hand are their own `set` so mesh.ts can mesh them on
 * finer grids than the body: the reference draws the face denser than the
 * torso, and a finger is thinner than two body cells. Each joins the body
 * by overlapping it — the neck runs up inside the skull, and the hand set
 * carries a short wrist stub that starts inside the forearm's end — so the
 * closed surfaces cross instead of leaving a gap.
 *
 * Pure and DOM/GL-free — tests/alien.test.ts samples it under node.
 */
import { B, type Vec3 } from "../dancers/rig.ts";

export type PartSet = "body" | "head" | "handL" | "handR";

interface PartBase {
  bone: number;
  set: PartSet;
  /** Smooth-min width this part blends into what came before it with. */
  blend: number;
  /** "add" unions; "carve" subtracts after every add; "inlay" adds back
   *  after the carves. */
  op?: "add" | "carve" | "inlay";
}

/** An ellipsoid, optionally turned about the bone's Z by `roll` radians. */
export interface EllipsoidPart extends PartBase {
  kind: "ellipsoid";
  center: Vec3;
  radii: Vec3;
  roll?: number;
}

/** A capsule from `a` to `b` whose radius runs from `ra` to `rb`. */
export interface ConePart extends PartBase {
  kind: "cone";
  a: Vec3;
  b: Vec3;
  ra: number;
  rb: number;
}

export type Part = EllipsoidPart | ConePart;

function ellipsoid(bone: number, set: PartSet, center: Vec3, radii: Vec3, blend: number, extra: Partial<EllipsoidPart> = {}): EllipsoidPart {
  return { kind: "ellipsoid", bone, set, center, radii, blend, ...extra };
}

function cone(bone: number, set: PartSet, a: Vec3, b: Vec3, ra: number, rb: number, blend: number): ConePart {
  return { kind: "cone", bone, set, a, b, ra, rb, blend };
}

function buildParts(): Part[] {
  const parts: Part[] = [];

  // Torso, bottom up.
  parts.push(ellipsoid(B.pelvis, "body", [0, 0.02, 0], [0.12, 0.1, 0.08], 0));
  parts.push(ellipsoid(B.spine, "body", [0, 0.12, 0.005], [0.085, 0.15, 0.065], 0.06));
  parts.push(ellipsoid(B.chest, "body", [0, 0.13, 0], [0.13, 0.16, 0.085], 0.06));
  parts.push(cone(B.chest, "body", [-0.19, 0.24, -0.005], [0.19, 0.24, -0.005], 0.045, 0.045, 0.05));
  parts.push(cone(B.neck, "body", [0, -0.02, 0], [0, 0.16, 0.01], 0.038, 0.03, 0.04));

  // Head: cranium, a narrow face hanging forward under it, a small chin.
  parts.push(ellipsoid(B.head, "head", [0, 0.25, -0.02], [0.15, 0.155, 0.17], 0.05));
  // The back of the skull swept back and up.
  parts.push(ellipsoid(B.head, "head", [0, 0.28, -0.1], [0.125, 0.13, 0.15], 0.06));
  parts.push(ellipsoid(B.head, "head", [0, 0.11, 0.045], [0.085, 0.11, 0.085], 0.07));
  parts.push(ellipsoid(B.head, "head", [0, 0.02, 0.06], [0.035, 0.035, 0.035], 0.04));
  for (const s of [-1, 1]) {
    // Sockets tilted up at the outer corner, then the eyes set into them.
    parts.push(ellipsoid(B.head, "head", [s * 0.06, 0.15, 0.125], [0.056, 0.027, 0.04], 0.015, { op: "carve", roll: s * 0.45 }));
    parts.push(ellipsoid(B.head, "head", [s * 0.06, 0.15, 0.098], [0.05, 0.022, 0.03], 0.004, { op: "inlay", roll: s * 0.45 }));
  }

  for (const side of ["L", "R"] as const) {
    const upper = side === "L" ? B.L_upperArm : B.R_upperArm;
    const fore = side === "L" ? B.L_forearm : B.R_forearm;
    const hand = side === "L" ? B.L_hand : B.R_hand;
    const handSet: PartSet = side === "L" ? "handL" : "handR";
    parts.push(cone(upper, "body", [0, -0.02, 0], [0, 0.3, 0], 0.04, 0.03, 0.04));
    parts.push(cone(fore, "body", [0, 0, 0], [0, 0.26, 0], 0.031, 0.022, 0.03));

    // The hand: a wrist stub reaching back into the forearm, a flat palm,
    // three long fingers fanned in the palm's plane (local Y-Z), a thumb.
    parts.push(cone(fore, handSet, [0, 0.2, 0], [0, 0.27, 0], 0.024, 0.021, 0));
    parts.push(ellipsoid(hand, handSet, [0, 0.045, 0], [0.017, 0.055, 0.038], 0.02));
    for (const i of [-1, 0, 1]) {
      const ang = 0.22 * i;
      const len = i === 0 ? 0.14 : 0.125;
      const a: Vec3 = [0, 0.085, 0.018 * i];
      const b: Vec3 = [0, a[1] + Math.cos(ang) * len, a[2] + Math.sin(ang) * len];
      parts.push(cone(hand, handSet, a, b, 0.0105, 0.0075, 0.012));
      parts.push(ellipsoid(hand, handSet, b, [0.009, 0.012, 0.011], 0.006));
    }
    parts.push(cone(hand, handSet, [0, 0.03, 0.03], [0, 0.03 + 0.55 * 0.075, 0.03 + 0.83 * 0.075], 0.011, 0.008, 0.012));
  }

  for (const side of ["L", "R"] as const) {
    const thigh = side === "L" ? B.L_thigh : B.R_thigh;
    const shin = side === "L" ? B.L_shin : B.R_shin;
    const foot = side === "L" ? B.L_foot : B.R_foot;
    parts.push(cone(thigh, "body", [0, -0.03, 0], [0, 0.44, 0], 0.062, 0.042, 0.05));
    parts.push(cone(shin, "body", [0, 0, 0], [0, 0.42, 0], 0.043, 0.028, 0.03));
    parts.push(ellipsoid(foot, "body", [0, 0.08, -0.02], [0.04, 0.11, 0.028], 0.03));
  }
  return parts;
}

export const PARTS: readonly Part[] = buildParts();

// ---- Distance -----------------------------------------------------------------

// Bound-preserving ellipsoid approximation (exact on the axes).
// Inigo Quilez's ellipsoid bound (MIT) — see THIRD-PARTY-NOTICES.md
function sdEllipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const bx = ax / rx, by = ay / ry, bz = az / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const k1 = Math.max(Math.sqrt(bx * bx + by * by + bz * bz), 1e-9);
  return (k0 * (k0 - 1)) / k1;
}

/** Distance to a capsule whose radius tapers from ra at `a` to rb at `b`. */
function sdCone(x: number, y: number, z: number, p: ConePart): number {
  const bax = p.b[0] - p.a[0], bay = p.b[1] - p.a[1], baz = p.b[2] - p.a[2];
  const pax = x - p.a[0], pay = y - p.a[1], paz = z - p.a[2];
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (p.ra + (p.rb - p.ra) * h);
}

// Polynomial smooth union; k is the blend width.
// Inigo Quilez's polynomial smooth min (MIT) — see THIRD-PARTY-NOTICES.md
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

/** Bone frames the parts are evaluated in: world head position (xyz) and
 *  rotation (xyzw) per bone — rig.ts's RigWorld layout. */
export interface BoneFrames {
  pos: Float32Array;
  rot: Float32Array;
}

/** A part's signed distance at world point (x, y, z). */
export function partDistance(part: Part, frames: BoneFrames, x: number, y: number, z: number): number {
  const b = part.bone;
  // World -> bone: rotate (p - head) by the conjugate of the bone's rotation.
  const qx = -frames.rot[b * 4], qy = -frames.rot[b * 4 + 1], qz = -frames.rot[b * 4 + 2], qw = frames.rot[b * 4 + 3];
  const vx = x - frames.pos[b * 3], vy = y - frames.pos[b * 3 + 1], vz = z - frames.pos[b * 3 + 2];
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  let lx = vx + qw * tx + (qy * tz - qz * ty);
  let ly = vy + qw * ty + (qz * tx - qx * tz);
  const lz = vz + qw * tz + (qx * ty - qy * tx);
  if (part.kind === "cone") return sdCone(lx, ly, lz, part);
  lx -= part.center[0];
  ly -= part.center[1];
  const cz = lz - part.center[2];
  if (part.roll) {
    const c = Math.cos(part.roll), s = Math.sin(part.roll);
    const rx = c * lx + s * ly;
    ly = -s * lx + c * ly;
    lx = rx;
  }
  return sdEllipsoid(lx, ly, cz, part.radii[0], part.radii[1], part.radii[2]);
}

/** One set's parts in fixed bone frames, with a world-space bounding sphere
 *  per part, so a sample can skip every part too far away to matter. */
export interface CompiledSet {
  /** The set's signed distance: adds, then carves, then inlays. A part
   *  whose sphere lies further than PRUNE_BLENDS blend widths beyond the
   *  nearest part's exact distance is skipped — a smooth min of two
   *  readings a blend width apart returns the nearer one exactly. */
  sd(x: number, y: number, z: number): number;
  /** Calls `visit` with the exact distance of every add/inlay part whose
   *  sphere is within `margin` of the nearest part's exact distance. */
  near(x: number, y: number, z: number, margin: number, visit: (part: Part, d: number) => void): void;
}

/** How many of the widest blend a part may sit beyond the nearest part
 *  before sd() skips it — slack for several blends deepening one crease. */
const PRUNE_BLENDS = 3;

export function compileSet(parts: readonly Part[], frames: BoneFrames): CompiledSet {
  const n = parts.length;
  const sphere = new Float64Array(n * 4);
  let maxBlend = 0;
  parts.forEach((p, i) => {
    const local: Vec3 = p.kind === "cone" ? [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2] : p.center;
    const r =
      p.kind === "cone"
        ? Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) / 2 + Math.max(p.ra, p.rb)
        : Math.max(...p.radii);
    const w = boneToWorld(frames, p.bone, local);
    sphere.set([w[0], w[1], w[2], r], i * 4);
    maxBlend = Math.max(maxBlend, p.blend);
  });
  const lb = new Float64Array(n);
  const exact = new Float64Array(n);
  // Part indices sorted by op once, so the hot loops below don't branch on it.
  const indicesFor = (op: Part["op"]): number[] =>
    parts.map((p, i) => ((p.op ?? "add") === op ? i : -1)).filter((i) => i >= 0);
  const adds = indicesFor("add");
  const carves = indicesFor("carve");
  const inlays = indicesFor("inlay");
  const adjacent = [...adds, ...inlays];
  const blend = Float64Array.from(parts, (p) => p.blend);

  /** Fills lb[]; returns the index of the add part with the smallest bound. */
  const bounds = (x: number, y: number, z: number): number => {
    for (let i = 0; i < n; i++) {
      const dx = x - sphere[i * 4], dy = y - sphere[i * 4 + 1], dz = z - sphere[i * 4 + 2];
      lb[i] = Math.sqrt(dx * dx + dy * dy + dz * dz) - sphere[i * 4 + 3];
      exact[i] = NaN;
    }
    let best = adds[0];
    for (const i of adds) if (lb[i] < lb[best]) best = i;
    return best;
  };
  const dist = (i: number, x: number, y: number, z: number): number => {
    // NaN is the only value unequal to itself: not measured yet this sample.
    if (exact[i] !== exact[i]) exact[i] = partDistance(parts[i], frames, x, y, z);
    return exact[i];
  };

  return {
    sd(x, y, z) {
      const first = bounds(x, y, z);
      const cutoff = dist(first, x, y, z) + PRUNE_BLENDS * maxBlend;
      let d = Infinity;
      for (const i of adds) {
        if (lb[i] > cutoff) continue;
        const pd = dist(i, x, y, z);
        d = d === Infinity ? pd : smin(d, pd, blend[i]);
      }
      // A carve changes nothing where its own distance is a blend past -d,
      // an inlay nothing where it is a blend past d.
      for (const i of carves) if (lb[i] <= blend[i] - d) d = -smin(-d, dist(i, x, y, z), blend[i]);
      for (const i of inlays) if (lb[i] <= d + blend[i]) d = smin(d, dist(i, x, y, z), blend[i]);
      return d;
    },
    near(x, y, z, margin, visit) {
      const first = bounds(x, y, z);
      const cutoff = dist(first, x, y, z) + margin;
      for (const i of adjacent) if (lb[i] <= cutoff) visit(parts[i], dist(i, x, y, z));
    },
  };
}

function boneToWorld(frames: BoneFrames, bone: number, local: Vec3): [number, number, number] {
  const qx = frames.rot[bone * 4], qy = frames.rot[bone * 4 + 1], qz = frames.rot[bone * 4 + 2], qw = frames.rot[bone * 4 + 3];
  const [vx, vy, vz] = local;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  return [
    frames.pos[bone * 3] + vx + qw * tx + (qy * tz - qz * ty),
    frames.pos[bone * 3 + 1] + vy + qw * ty + (qz * tx - qx * tz),
    frames.pos[bone * 3 + 2] + vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** World-space box around a set's parts in the given frames, padded by `pad`. */
export function setBounds(parts: readonly Part[], frames: BoneFrames, pad: number): { min: Vec3; max: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grow = (bone: number, local: Vec3, r: number): void => {
    const w = boneToWorld(frames, bone, local);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], w[i] - r - pad);
      max[i] = Math.max(max[i], w[i] + r + pad);
    }
  };
  for (const p of parts) {
    if (p.op === "carve") continue;
    if (p.kind === "cone") {
      grow(p.bone, p.a, p.ra + p.blend);
      grow(p.bone, p.b, p.rb + p.blend);
    } else {
      grow(p.bone, p.center, Math.max(...p.radii) + p.blend);
    }
  }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}
