#!/usr/bin/env node
// Builds the dancers' clip library from the cut list in
// tools/clip-cuts.json: for every entry it fetches the CMU Motion Capture
// Database trial (the cgspeed BVH conversion, via the una-dinosauria/cmu-mocap
// mirror) into tools/.cache/, retargets it onto the dancers rig, cuts the
// requested beats into a seamless loop and quantises it through
// clipFormat.ts. An entry with no `start` gets the trial's best-looping
// window from findLoop() instead. Runs on plain node (24+, which strips
// TypeScript types, so the rig table and the format come straight from src/).
//
// It writes public/media/dancers/clips-v<n>.bin, one past the newest there
// (or --out <file>), and never overwrites a committed library: a tab loaded
// before a deploy may still fetch it (src/pinnedAssets.ts's header, "Scene
// media"). Then point CLIP_LIBRARY_URL (src/render/scenes/dancers/
// clipFormat.ts) at the new file and add it to tests/mediaManifest.ts.
//
//   node tools/clip-convert.mjs                 # build every clip in the cut list
//   node tools/clip-convert.mjs --only macarena # just one
//   node tools/clip-convert.mjs --estimate 143_35   # print the tempo/beat estimate for a trial and exit
//   node tools/clip-convert.mjs --cuts tools/clip-candidates.json --out <file> --report <json>
//       # the trials not in the library yet; --report writes each clip's loop scores
//   --raw-feet  # leave the feet as captured (polishFeet() is skipped)
//
// Retarget: cgspeed inserts a T-pose as frame 0 of every file, facing +Z —
// the same way the rig faces. For each of our bones we take the matching
// source joint's world rotation relative to that frame-0 pose (so twist
// survives) and apply it to our own T-pose bone, after a per-bone swing that
// makes the two T-poses' bone directions coincide exactly (their rest poses
// differ in the feet and the shoulders). Root motion is scaled by the hip
// height ratio; the linear drift is removed so the dancer stays in frame
// but the weight shifts stay; `lift` is how high the source's lower foot is
// above its own floor. CMU has no music, so the tempo is estimated from the
// autocorrelation of joint speed and the cut list may override it. The
// loop's last beat crossfades into the beat before its start, so frame 0
// follows at full speed.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  B,
  BONES,
  BONE_COUNT,
  CH_LIFT,
  CH_ROOT_X,
  CH_ROOT_Z,
  FLOOR_Y,
  FOOT_RADIUS,
  POSE_LENGTH,
  ROOT_REST_Y,
  boneChannel,
  boneTail,
  createPose,
  createRigWorld,
  forwardKinematics,
  groundToFloor,
  lerpPose,
  quatConjugate,
  quatMul,
  quatNormalize,
  quatRotate,
  tPose,
} from "../src/render/scenes/dancers/rig.ts";
import { encodeClipLibrary } from "../src/render/scenes/dancers/clipFormat.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const cutsPath = resolve(flag("--cuts", join(here, "clip-cuts.json")));
const mediaDir = join(here, "..", "public", "media", "dancers");
const newest = Math.max(0, ...readdirSync(mediaDir).map((f) => Number(/^clips-v(\d+)\.bin$/.exec(f)?.[1] ?? 0)));
const outPath = resolve(flag("--out", join(mediaDir, `clips-v${newest + 1}.bin`)));
const cacheDir = join(here, ".cache");
const only = flag("--only", null);
const estimateOnly = flag("--estimate", null);
const reportPath = flag("--report", null);
const rawFeet = args.includes("--raw-feet");

const FRAMES_PER_BEAT = 16;
const SOURCE_FPS = 120;

// ---- BVH -------------------------------------------------------------------

function parseBvh(text) {
  const tok = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const expect = (t) => {
    if (tok[i] !== t) throw new Error(`bvh: expected ${t} at token ${i}, got ${tok[i]}`);
    i++;
  };
  expect("HIERARCHY");
  const joints = [];
  const stack = [];
  let inEnd = false;
  while (tok[i] !== "MOTION") {
    const t = tok[i++];
    const cur = () => joints[stack[stack.length - 1]];
    if (t === "ROOT" || t === "JOINT") {
      joints.push({ name: tok[i++], parent: stack.length ? stack[stack.length - 1] : -1, offset: [0, 0, 0], channels: [], end: null });
      expect("{");
      stack.push(joints.length - 1);
    } else if (t === "OFFSET") {
      const o = [+tok[i++], +tok[i++], +tok[i++]];
      if (inEnd) cur().end = o;
      else cur().offset = o;
    } else if (t === "CHANNELS") {
      const n = +tok[i++];
      cur().channels = tok.slice(i, i + n);
      i += n;
    } else if (t === "End") {
      i++; // Site
      expect("{");
      inEnd = true;
    } else if (t === "}") {
      if (inEnd) inEnd = false;
      else stack.pop();
    } else throw new Error(`bvh: unexpected ${t}`);
  }
  i++; // MOTION
  expect("Frames:");
  const frames = +tok[i++];
  expect("Frame");
  expect("Time:");
  const frameTime = +tok[i++];
  const channelCount = joints.reduce((n, j) => n + j.channels.length, 0);
  const motion = new Float64Array(frames * channelCount);
  for (let k = 0; k < motion.length; k++) motion[k] = +tok[i++];
  return { joints, frames, frameTime, channelCount, motion };
}

// ---- quaternion scratch helpers (x, y, z, w in plain arrays) -------------

const q = (x = 0, y = 0, z = 0, w = 1) => new Float32Array([x, y, z, w]);
const qmul = (a, b) => {
  const out = q();
  quatMul(a, 0, b, 0, out, 0);
  return out;
};
const qconj = (a) => {
  const out = q();
  quatConjugate(a, 0, out, 0);
  return out;
};
const qaxis = (axis, deg) => {
  const h = (deg * Math.PI) / 360;
  const s = Math.sin(h);
  return q(axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h));
};
const rot = (quat, v) => {
  const out = new Float32Array(3);
  quatRotate(quat, 0, v[0], v[1], v[2], out, 0);
  return out;
};
const norm = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
/** Shortest rotation taking unit vector a onto unit vector b. */
const qFromTo = (a, b) => {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) {
    // Antiparallel: rotate π about any axis perpendicular to a.
    const axis = Math.abs(a[0]) < 0.9 ? norm([0, -a[2], a[1]]) : norm([a[2], 0, -a[0]]);
    return q(axis[0], axis[1], axis[2], 0);
  }
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const out = q(c[0], c[1], c[2], 1 + d);
  quatNormalize(out, 0);
  return out;
};

/** World rotation + position of every source joint at one frame. */
function sourceWorld(bvh, frame, endSites) {
  const { joints, motion, channelCount } = bvh;
  const rotW = new Array(joints.length);
  const posW = new Array(joints.length);
  let c = frame * channelCount;
  for (let j = 0; j < joints.length; j++) {
    const joint = joints[j];
    let local = q();
    let tx = 0, ty = 0, tz = 0;
    for (const ch of joint.channels) {
      const v = motion[c++];
      if (ch === "Xposition") tx = v;
      else if (ch === "Yposition") ty = v;
      else if (ch === "Zposition") tz = v;
      else if (ch === "Xrotation") local = qmul(local, qaxis([1, 0, 0], v));
      else if (ch === "Yrotation") local = qmul(local, qaxis([0, 1, 0], v));
      else if (ch === "Zrotation") local = qmul(local, qaxis([0, 0, 1], v));
    }
    if (joint.parent < 0) {
      rotW[j] = local;
      posW[j] = [joint.offset[0] + tx, joint.offset[1] + ty, joint.offset[2] + tz];
    } else {
      const p = joint.parent;
      rotW[j] = qmul(rotW[p], local);
      const o = rot(rotW[p], joint.offset);
      posW[j] = [posW[p][0] + o[0], posW[p][1] + o[1], posW[p][2] + o[2]];
    }
  }
  if (endSites) {
    for (let j = 0; j < joints.length; j++) {
      if (!joints[j].end) continue;
      const o = rot(rotW[j], joints[j].end);
      endSites[j] = [posW[j][0] + o[0], posW[j][1] + o[1], posW[j][2] + o[2]];
    }
  }
  return { rotW, posW };
}

// ---- Rig mapping -------------------------------------------------------------

// Our bone → the source joint whose world rotation drives it, and the joint
// (or end site, "name.end") its direction is measured toward. Bones without
// a source (the jaw) stay at rest.
const MAP = {
  pelvis: ["Hips", "Spine"],
  spine: ["LowerBack", "Spine1"],
  chest: ["Spine1", "Neck"],
  neck: ["Neck", "Head"],
  head: ["Head", "Head.end"],
  L_upperArm: ["LeftArm", "LeftForeArm"],
  L_forearm: ["LeftForeArm", "LeftHand"],
  L_hand: ["LeftHand", "LeftHandIndex1"],
  R_upperArm: ["RightArm", "RightForeArm"],
  R_forearm: ["RightForeArm", "RightHand"],
  R_hand: ["RightHand", "RightHandIndex1"],
  L_thigh: ["LeftUpLeg", "LeftLeg"],
  L_shin: ["LeftLeg", "LeftFoot"],
  L_foot: ["LeftFoot", "LeftToeBase"],
  R_thigh: ["RightUpLeg", "RightLeg"],
  R_shin: ["RightLeg", "RightFoot"],
  R_foot: ["RightFoot", "RightToeBase"],
};
const FEET_SRC = ["LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase"];

function jointIndex(bvh, name) {
  const i = bvh.joints.findIndex((j) => j.name === name);
  if (i < 0) throw new Error(`bvh: no joint ${name}`);
  return i;
}

/** Position of a mapping target: a joint, or "<joint>.end" for its end site. */
function targetPos(bvh, world, endSites, name) {
  if (name.endsWith(".end")) return endSites[jointIndex(bvh, name.slice(0, -4))];
  return world.posW[jointIndex(bvh, name)];
}

function lowestFootY(bvh, world) {
  let y = Infinity;
  for (const n of FEET_SRC) y = Math.min(y, world.posW[jointIndex(bvh, n)][1]);
  return y;
}

/** Precomputes everything frame-independent: our T-pose world transforms
 *  and, per bone, the aligned target rotation at the source's T-pose. */
function buildRetarget(bvh) {
  const endSites0 = [];
  const src0 = sourceWorld(bvh, 0, endSites0);
  const ours = createRigWorld();
  forwardKinematics(tPose(createPose()), ours);
  const tail = new Float32Array(3);
  const align = new Array(BONE_COUNT).fill(null);
  const srcJoint = new Array(BONE_COUNT).fill(-1);
  const rotW0 = new Array(BONE_COUNT).fill(null);
  for (let b = 0; b < BONE_COUNT; b++) {
    const m = MAP[BONES[b].name];
    if (!m) continue;
    const j = jointIndex(bvh, m[0]);
    srcJoint[b] = j;
    boneTail(ours, b, tail, 0);
    const head = [ours.pos[b * 3], ours.pos[b * 3 + 1], ours.pos[b * 3 + 2]];
    const dOurs = norm([tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]]);
    const t = targetPos(bvh, src0, endSites0, m[1]);
    const s = src0.posW[j];
    const dSrc = norm([t[0] - s[0], t[1] - s[1], t[2] - s[2]]);
    const oursT = q(ours.rot[b * 4], ours.rot[b * 4 + 1], ours.rot[b * 4 + 2], ours.rot[b * 4 + 3]);
    align[b] = qmul(qFromTo(dOurs, dSrc), oursT);
    rotW0[b] = qconj(src0.rotW[j]);
  }
  const hips = jointIndex(bvh, "Hips");
  const floor0 = lowestFootY(bvh, src0);
  const scale = ROOT_REST_Y / (src0.posW[hips][1] - floor0);
  return { align, srcJoint, rotW0, hips, scale, hips0: src0.posW[hips], heading: q() };
}

/** The T-pose faces +Z but the performance faces wherever the actor stood,
 *  so each clip is turned to face the camera on average — a yaw fix on the
 *  whole clip, which keeps any turning the move itself does. */
function fixHeading(bvh, rt, first, last) {
  let fx = 0, fz = 0;
  for (let f = first; f <= last; f++) {
    const src = sourceWorld(bvh, f);
    const delta = qmul(src.rotW[rt.hips], qconj(bvhRot0(bvh, rt.hips)));
    const fwd = rot(delta, [0, 0, 1]);
    fx += fwd[0];
    fz += fwd[2];
  }
  const yaw = Math.atan2(fx, fz);
  rt.heading = qaxis([0, 1, 0], (-yaw * 180) / Math.PI);
  return yaw;
}

const rot0Cache = new WeakMap();
function bvhRot0(bvh, j) {
  let m = rot0Cache.get(bvh);
  if (!m) rot0Cache.set(bvh, (m = sourceWorld(bvh, 0).rotW));
  return m[j];
}

const rest = new Array(BONE_COUNT);
for (let b = 0; b < BONE_COUNT; b++) rest[b] = qconj(q(...BONES[b].rest));

/** One source frame → a Pose (root in metres, lift left for the caller). */
function retargetFrame(bvh, rt, frame, out) {
  const src = sourceWorld(bvh, frame);
  const worldOurs = new Array(BONE_COUNT);
  for (let b = 0; b < BONE_COUNT; b++) {
    const p = BONES[b].parent;
    let wb;
    if (rt.srcJoint[b] < 0) {
      // No source: rest rotation under whatever the parent does.
      wb = qmul(p < 0 ? q() : worldOurs[p], q(...BONES[b].rest));
    } else {
      const delta = qmul(rt.heading, qmul(src.rotW[rt.srcJoint[b]], rt.rotW0[b]));
      wb = qmul(delta, rt.align[b]);
    }
    worldOurs[b] = wb;
    const local = qmul(qmul(p < 0 ? q() : qconj(worldOurs[p]), wb), rest[b]);
    quatNormalize(local, 0);
    out.set(local, boneChannel(b));
  }
  const h = src.posW[rt.hips];
  const d = rot(rt.heading, [h[0] - rt.hips0[0], 0, h[2] - rt.hips0[2]]);
  out[CH_ROOT_X] = d[0] * rt.scale;
  out[CH_ROOT_Z] = d[2] * rt.scale;
  out[CH_LIFT] = lowestFootY(bvh, src) * rt.scale; // absolute for now; made relative per clip
  return out;
}

// ---- Tempo estimate -----------------------------------------------------------

function jointSpeed(bvh) {
  const names = Object.values(MAP).map((m) => m[0]);
  const idx = names.map((n) => jointIndex(bvh, n));
  const speed = new Float64Array(bvh.frames);
  let prev = sourceWorld(bvh, 0).posW;
  for (let f = 1; f < bvh.frames; f++) {
    const cur = sourceWorld(bvh, f).posW;
    let s = 0;
    for (const j of idx) s += Math.hypot(cur[j][0] - prev[j][0], cur[j][1] - prev[j][1], cur[j][2] - prev[j][2]);
    speed[f] = s;
    prev = cur;
  }
  return speed;
}

/** Autocorrelation of joint speed over 50..200 bpm; returns the best few
 *  periods and, for the best, the frame offset where speed bottoms out
 *  (a hit — the moment a move lands on the beat). */
function estimateTempo(bvh, from = SOURCE_FPS) {
  const speed = jointSpeed(bvh).subarray(from);
  const n = speed.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += speed[i];
  mean /= n;
  const x = Float64Array.from(speed, (v) => v - mean);
  const minLag = Math.round((SOURCE_FPS * 60) / 160);
  const maxLag = Math.round((SOURCE_FPS * 60) / 50);
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0, den = 0;
    for (let i = 0; i + lag < n; i++) {
      num += x[i] * x[i + lag];
      den += x[i] * x[i];
    }
    scores.push({ lag, score: den > 0 ? num / den : 0 });
  }
  scores.sort((a, b) => b.score - a.score);
  // Keep local maxima only, so the list reads as distinct candidates.
  const peaks = scores.filter((s) => {
    const l = scores.find((t) => t.lag === s.lag - 1)?.score ?? -1;
    const r = scores.find((t) => t.lag === s.lag + 1)?.score ?? -1;
    return s.score >= l && s.score >= r;
  }).slice(0, 8);
  const best = peaks[0];
  let bestPhase = 0, bestMean = Infinity;
  for (let phase = 0; phase < best.lag; phase++) {
    let s = 0, k = 0;
    for (let i = phase; i < n; i += best.lag) {
      s += speed[i];
      k++;
    }
    if (s / k < bestMean) {
      bestMean = s / k;
      bestPhase = phase;
    }
  }
  // The hits: frames where smoothed joint speed bottoms out — each one is a
  // move landing. Their spacing is the tempo, read by eye when the
  // autocorrelation above is indecisive.
  const smooth = new Float64Array(n);
  const half = 8;
  for (let i = 0; i < n; i++) {
    let s = 0, k = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      s += speed[j];
      k++;
    }
    smooth[i] = s / k;
  }
  const hits = [];
  for (let i = 1; i < n - 1; i++) {
    if (smooth[i] <= smooth[i - 1] && smooth[i] < smooth[i + 1] && (hits.length === 0 || i - hits[hits.length - 1] >= 24)) hits.push(i);
  }
  return {
    candidates: peaks.map((p) => ({ bpm: (SOURCE_FPS * 60) / p.lag, lag: p.lag, score: p.score })),
    bpm: (SOURCE_FPS * 60) / best.lag,
    firstBeatFrame: from + bestPhase,
    hits: hits.map((h) => h + from),
  };
}

// ---- Loop finder ----------------------------------------------------------------

// The tempos the finder tries: the span the hand cuts in clip-cuts.json
// already cover, so a found loop plays at speeds the scenes are tuned for.
const LOOP_BPM = [90, 190];
// What a seam (the end pose against the start pose, root removed) and the
// slide the drift removal puts under planted feet cost a window, both in leg
// lengths. Tuned by eye on the hand-cut trials: a seam of a tenth of a leg
// halves a window.
const SEAM_COST = 10;
const SLIDE_COST = 4;

/** Per-frame joint positions (root removed), root track and joint speed of
 *  a whole trial, for scoring loop windows. */
function trialMotion(bvh) {
  const joints = [...new Set(Object.values(MAP).map((m) => jointIndex(bvh, m[0])))];
  const hips = jointIndex(bvh, "Hips");
  const n = bvh.frames;
  const J = joints.length;
  const rel = new Float32Array(n * J * 3);
  const rootXZ = new Float64Array(n * 2);
  const speed = new Float64Array(n);
  let prev = null;
  for (let f = 0; f < n; f++) {
    const { posW } = sourceWorld(bvh, f);
    const h = posW[hips];
    rootXZ[f * 2] = h[0];
    rootXZ[f * 2 + 1] = h[2];
    let s = 0;
    joints.forEach((j, k) => {
      const p = posW[j];
      const o = (f * J + k) * 3;
      rel[o] = p[0] - h[0];
      rel[o + 1] = p[1];
      rel[o + 2] = p[2] - h[2];
      if (prev) s += Math.hypot(p[0] - prev[j][0], p[1] - prev[j][1], p[2] - prev[j][2]);
    });
    speed[f] = s;
    prev = posW;
  }
  const src0 = sourceWorld(bvh, 0);
  const leg = src0.posW[hips][1] - lowestFootY(bvh, src0);
  return { n, J, rel, rootXZ, speed, leg };
}

/** How a window of `beats` beats of `lag` frames from frame `s` would loop:
 *  how periodic its joint speed is at that beat, how much it moves (legs
 *  per second), its seam, the slide the drift removal leaves under the
 *  feet and the root's stray around that drift (both in legs, the stray
 *  being only a framing matter), and the score that weighs them. */
function scoreWindow(m, s, lag, beats) {
  const { J, rel, rootXZ, speed, leg } = m;
  const e = Math.round(s + beats * lag);
  const len = e - s;
  let mean = 0;
  for (let i = s; i < e; i++) mean += speed[i];
  mean /= len;
  let num = 0, den = 0;
  const L = Math.round(lag);
  for (let i = s; i < e; i++) {
    const a = speed[i] - mean;
    den += a * a;
    if (i + L < e) num += a * (speed[i + L] - mean);
  }
  const periodic = den > 0 ? Math.max(0, num / den) : 0;
  let seam = 0;
  for (let k = 0; k < J; k++) {
    const a = (s * J + k) * 3, b = (e * J + k) * 3;
    seam += Math.hypot(rel[a] - rel[b], rel[a + 1] - rel[b + 1], rel[a + 2] - rel[b + 2]);
  }
  seam /= J * leg;
  let si = 0, sii = 0, sx = 0, sz = 0, sxi = 0, szi = 0;
  for (let i = s; i <= e; i++) {
    const t = i - s;
    si += t; sii += t * t; sx += rootXZ[i * 2]; sz += rootXZ[i * 2 + 1];
    sxi += rootXZ[i * 2] * t; szi += rootXZ[i * 2 + 1] * t;
  }
  const k = len + 1;
  const d = k * sii - si * si || 1;
  const kx = (k * sxi - si * sx) / d, kz = (k * szi - si * sz) / d;
  const bx = (sx - kx * si) / k, bz = (sz - kz * si) / k;
  let stray = 0;
  for (let i = s; i <= e; i++) {
    const t = i - s;
    stray = Math.max(stray, Math.hypot(rootXZ[i * 2] - bx - kx * t, rootXZ[i * 2 + 1] - bz - kz * t));
  }
  const slide = (Math.hypot(kx, kz) * len) / leg;
  const energy = (mean / leg) * SOURCE_FPS;
  const score = (periodic * energy) / (1 + SEAM_COST * seam + SLIDE_COST * slide);
  return { start: s, bpm: (SOURCE_FPS * 60) / lag, beats, periodic, energy, seam, slide, stray: stray / leg, score };
}

/** For a cut with no start: the window that loops best, of `beats` beats,
 *  or half that when the trial is too short. Starts are hits (joint speed
 *  bottoming out, a move landing), so frame 0 lands on a beat; each start
 *  tries every tempo in LOOP_BPM. */
function findLoop(bvh, beats) {
  const m = trialMotion(bvh);
  const { n, speed } = m;
  const half = 8;
  const smooth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, k = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      s += speed[j];
      k++;
    }
    smooth[i] = s / k;
  }
  const hits = [];
  for (let i = SOURCE_FPS; i < n - 1; i++) {
    if (smooth[i] <= smooth[i - 1] && smooth[i] < smooth[i + 1] && (hits.length === 0 || i - hits[hits.length - 1] >= 24)) hits.push(i);
  }
  const minLag = Math.ceil((SOURCE_FPS * 60) / LOOP_BPM[1]);
  const maxLag = Math.floor((SOURCE_FPS * 60) / LOOP_BPM[0]);
  for (let b = beats; b >= beats / 2; b /= 2) {
    let best = null;
    for (const s of hits) {
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (s + b * lag > n - 2) break;
        const w = scoreWindow(m, s, lag, b);
        if (!best || w.score > best.score) best = w;
      }
    }
    if (best) return best;
  }
  throw new Error(`no ${beats / 2}-beat window fits in ${n} frames`);
}

// ---- Feet -------------------------------------------------------------------------

// CMU's skeleton solve often turns a foot past what an ankle can
// (docs/scenes/dancers.md, Measurements), so every clip's feet go through
// polishFeet() unless --raw-feet. The ankle's range as the angle between the
// shin (knee to ankle) and the foot (heel to toe), in degrees: toes pulled up
// toward the shin, and pointed, wide because dancers point a lifted foot.
// Only this angle is limited, never a turn measured in the shin's own frame:
// the solve flips some feet half a turn about their length for a few frames
// (90_30, the squat kicks), and any such frame reads as nonsense.
const ANKLE_MAX = 118;
const ANKLE_MIN = 15;
// A foot stands when its lowest end is within PLANT_NEAR of the floor, and
// not at all past PLANT_FAR (metres above where groundToFloor() rests it).
const PLANT_NEAR = 0.02;
const PLANT_FAR = 0.08;
// How far a standing foot may point down or up from level: a dancer on the
// ball of the foot keeps a raised heel, but the toe-less foot doesn't stand
// on its tip.
const PLANT_DOWN = 35;
const PLANT_UP = 25;
// Source frames each side the stand is averaged over, so a foot eases flat
// rather than snapping.
const PLANT_SMOOTH = 6;
// A standing foot whose top faces further down than this (the up component
// of its top) stays as captured: levelling it would roll it half a turn
// through a sideways foot, and it may be a real kneel on the instep (90_30).
const UPSIDE_DOWN = -0.3;

const DEG = 180 / Math.PI;
const UP = [0, 1, 0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The rotation whose local +X, +Y and +Z land on these orthonormal axes. */
function qFromAxes(x, y, z) {
  const [m00, m10, m20] = x, [m01, m11, m21] = y, [m02, m12, m22] = z;
  const tr = m00 + m11 + m22;
  let out;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out = q((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4);
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    out = q(s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    out = q((m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s);
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    out = q((m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s);
  }
  quatNormalize(out, 0);
  return out;
}

const restFootPitch = (() => {
  const w = createRigWorld();
  forwardKinematics(tPose(createPose()), w);
  const d = rot(w.rot.subarray(B.L_foot * 4, B.L_foot * 4 + 4), UP);
  return Math.asin(d[1]) * DEG;
})();

/** A standing foot (weight 0..1) eased level: roll about its length goes,
 *  and its pitch comes inside PLANT_DOWN/PLANT_UP of the rest foot's. */
function levelFoot(footW, weight) {
  const d = rot(footW, UP);
  const s = rot(footW, [1, 0, 0]);
  const h = Math.hypot(d[0], d[2]);
  if (h < 0.2) return footW; // pointing straight down: no heading to keep
  if (rot(footW, [0, 0, 1])[1] < UPSIDE_DOWN) return footW;
  const pitch = Math.asin(clamp(d[1], -1, 1)) * DEG;
  const target = clamp(pitch, restFootPitch - PLANT_DOWN, restFootPitch + PLANT_UP);
  const p = (pitch + (target - pitch) * weight) / DEG;
  const d2 = [(d[0] / h) * Math.cos(p), Math.sin(p), (d[2] / h) * Math.cos(p)];
  const side = norm(cross(d, UP));
  const roll = Math.atan2(dot(cross(side, s), d), dot(side, s));
  const side2 = norm(cross(d2, UP));
  const level = qFromAxes(side2, d2, cross(side2, d2));
  return qmul(qaxis(d2, roll * (1 - weight) * DEG), level);
}

/** The foot's world rotation turned in the plane of shin and foot until the
 *  angle between them is inside ANKLE_MIN..ANKLE_MAX. */
function limitAnkle(shinW, footW) {
  const s = rot(shinW, UP);
  const d = rot(footW, UP);
  const angle = Math.acos(clamp(dot(s, d), -1, 1)) * DEG;
  const target = clamp(angle, ANKLE_MIN, ANKLE_MAX);
  const axis = cross(s, d);
  if (target === angle || Math.hypot(...axis) < 1e-6) return footW;
  return qmul(qaxis(norm(axis), target - angle), footW);
}

/** Keeps every foot inside the ankle's range, then levels standing feet (the
 *  floor wins), in place, on source-rate poses whose lift is already the
 *  clip's own. */
function polishFeet(poses) {
  const world = createRigWorld();
  const tail = new Float32Array(3);
  const feet = [[B.L_shin, B.L_foot], [B.R_shin, B.R_foot]];
  const stand = feet.map(() => new Float64Array(poses.length));
  poses.forEach((p, i) => {
    forwardKinematics(p, world);
    groundToFloor(world, p[CH_LIFT]);
    feet.forEach(([, foot], k) => {
      boneTail(world, foot, tail, 0);
      const low = Math.min(world.pos[foot * 3 + 1], tail[1]) - FLOOR_Y - FOOT_RADIUS;
      stand[k][i] = 1 - smoothstep(PLANT_NEAR, PLANT_FAR, low);
    });
  });
  poses.forEach((p, i) => {
    forwardKinematics(p, world);
    feet.forEach(([shin, foot], k) => {
      let w = 0, c = 0;
      for (let j = Math.max(0, i - PLANT_SMOOTH); j <= Math.min(poses.length - 1, i + PLANT_SMOOTH); j++) {
        w += stand[k][j];
        c++;
      }
      w /= c;
      const shinW = world.rot.slice(shin * 4, shin * 4 + 4);
      let footW = limitAnkle(shinW, world.rot.slice(foot * 4, foot * 4 + 4));
      if (w > 0) footW = levelFoot(footW, w);
      const local = qmul(qmul(qconj(shinW), footW), rest[foot]);
      quatNormalize(local, 0);
      p.set(local, boneChannel(foot));
    });
  });
}

// ---- Clip assembly -------------------------------------------------------------

function fetchTrial(source, trial) {
  mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, `${trial}.bvh`);
  if (existsSync(path)) return readFileSync(path, "utf8");
  // The mirror pads the subject directory to three digits; the file keeps the CMU name.
  const subject = trial.split("_")[0].padStart(3, "0");
  const url = `${source}/${subject}/${trial}.bvh`;
  console.log(`fetching ${url}`);
  return fetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const text = await r.text();
    writeFileSync(path, text);
    return text;
  });
}

function buildClip(cut, bvh) {
  const rt = buildRetarget(bvh);
  const est = estimateTempo(bvh);
  const found = Number.isFinite(cut.start) ? null : findLoop(bvh, cut.beats ?? 8);
  const beats = found ? found.beats : cut.beats ?? 8;
  const bpm = found ? found.bpm : cut.bpm > 0 ? cut.bpm : est.bpm;
  const start = found ? found.start : cut.start;
  const srcFramesPerBeat = (SOURCE_FPS * 60) / bpm;
  const end = start + beats * srcFramesPerBeat;
  if (end > bvh.frames - 1) throw new Error(`${cut.name}: ${beats} beats at ${bpm.toFixed(1)} bpm from frame ${start} runs past frame ${bvh.frames}`);
  const loop = found ?? scoreWindow(trialMotion(bvh), Math.round(start), srcFramesPerBeat, beats);

  // Retarget every source frame the cut touches, and the beat before it:
  // the loop's last beat crossfades into that beat, so the end flows into
  // frame 0 at full speed.
  const first = Math.max(0, Math.floor(start - srcFramesPerBeat));
  const last = Math.min(bvh.frames - 1, Math.ceil(end) + 1);
  const yaw = fixHeading(bvh, rt, first, last);
  console.log(`${cut.name}: actor faced ${((yaw * 180) / Math.PI).toFixed(0)}° from +Z; turned to face the camera`);
  const src = [];
  for (let f = first; f <= last; f++) src.push(retargetFrame(bvh, rt, f, createPose()));
  // Lift becomes "above this clip's own floor"; root drift comes out.
  let floor = Infinity;
  for (const p of src) floor = Math.min(floor, p[CH_LIFT]);
  const n = src.length;
  let sx = 0, sz = 0, sxi = 0, szi = 0, si = 0, sii = 0;
  src.forEach((p, i) => {
    sx += p[CH_ROOT_X]; sz += p[CH_ROOT_Z]; sxi += p[CH_ROOT_X] * i; szi += p[CH_ROOT_Z] * i; si += i; sii += i * i;
  });
  const den = n * sii - si * si || 1;
  const slopeX = (n * sxi - si * sx) / den, slopeZ = (n * szi - si * sz) / den;
  const meanX = sx / n, meanZ = sz / n, meanI = si / n;
  src.forEach((p, i) => {
    p[CH_LIFT] -= floor;
    p[CH_ROOT_X] -= meanX + slopeX * (i - meanI);
    p[CH_ROOT_Z] -= meanZ + slopeZ * (i - meanI);
  });
  if (!rawFeet) polishFeet(src);

  // Resample to FRAMES_PER_BEAT per beat, then close the loop.
  const frames = beats * FRAMES_PER_BEAT;
  const data = new Float32Array(frames * POSE_LENGTH);
  const scratch = createPose();
  const lead = createPose();
  const sampleSrc = (t, out) => {
    const x = t - first;
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(x)));
    lerpPose(src[i0], src[i0 + 1], x - i0, out);
  };
  for (let k = 0; k < frames; k++) {
    const t = start + (k / frames) * (end - start);
    sampleSrc(t, scratch);
    const fade = k - (frames - FRAMES_PER_BEAT);
    if (fade >= 0) {
      sampleSrc(t - (end - start), lead);
      lerpPose(scratch, lead, smoothstep(0, FRAMES_PER_BEAT, fade + 1), scratch);
    }
    data.set(scratch, k * POSE_LENGTH);
  }

  // Raw energy (mean joint angular speed, rad per beat) and reach (hand
  // distance from the pelvis) — normalised across the library afterwards.
  const world = createRigWorld();
  const tail = new Float32Array(3);
  let ang = 0, reach = 0;
  let prevFrame = data.subarray((frames - 1) * POSE_LENGTH, frames * POSE_LENGTH);
  for (let k = 0; k < frames; k++) {
    const p = data.subarray(k * POSE_LENGTH, (k + 1) * POSE_LENGTH);
    for (let b = 0; b < BONE_COUNT; b++) {
      const ch = boneChannel(b);
      const d = Math.abs(p[ch] * prevFrame[ch] + p[ch + 1] * prevFrame[ch + 1] + p[ch + 2] * prevFrame[ch + 2] + p[ch + 3] * prevFrame[ch + 3]);
      ang += 2 * Math.acos(Math.min(1, d));
    }
    forwardKinematics(p, world);
    for (const hand of [B.L_hand, B.R_hand]) {
      boneTail(world, hand, tail, 0);
      reach += Math.hypot(tail[0] - world.pos[0], tail[1] - world.pos[1], tail[2] - world.pos[2]);
    }
    prevFrame = p;
  }
  return {
    name: cut.name,
    family: cut.family ?? "misc",
    beats,
    nativeBpm: +bpm.toFixed(2),
    frames,
    energy: ang / beats, // raw for now
    bigness: reach / (2 * frames), // raw for now
    mirrorOf: -1,
    source: `CMU ${cut.trial} frames ${Math.round(start)}..${Math.round(end)} @ ${bpm.toFixed(1)} bpm`,
    data,
    estimate: est,
    found: !!found,
    loop,
  };
}

// ---- Main -------------------------------------------------------------------------

const cuts = JSON.parse(readFileSync(cutsPath, "utf8"));
if (estimateOnly) {
  for (const trial of estimateOnly.split(",")) {
    const bvh = parseBvh(await fetchTrial(cuts.source, trial));
    const est = estimateTempo(bvh);
    console.log(`${trial}: ${bvh.frames} frames (${(bvh.frames / SOURCE_FPS).toFixed(1)} s)`);
    console.log(`  tempo candidates: ${est.candidates.map((c) => `${c.bpm.toFixed(0)}bpm/lag${c.lag}/${c.score.toFixed(2)}`).join(" ")}`);
    const gaps = est.hits.slice(1).map((h, i) => h - est.hits[i]);
    console.log(`  hits: ${est.hits.join(" ")}`);
    console.log(`  gaps: ${gaps.join(" ")}`);
    // Where the actor faces over the trial, in degrees of yaw from +Z, every second.
    const rt = buildRetarget(bvh);
    const headings = [];
    for (let f = 0; f < bvh.frames; f += SOURCE_FPS) {
      const src = sourceWorld(bvh, f);
      const fwd = rot(qmul(src.rotW[rt.hips], qconj(bvhRot0(bvh, rt.hips))), [0, 0, 1]);
      headings.push(`${f}:${((Math.atan2(fwd[0], fwd[2]) * 180) / Math.PI).toFixed(0)}`);
    }
    console.log(`  heading: ${headings.join(" ")}`);
  }
  process.exit(0);
}

const clips = [];
for (const cut of cuts.clips) {
  if (only && cut.name !== only) continue;
  const bvh = parseBvh(await fetchTrial(cuts.source, cut.trial));
  const clip = buildClip(cut, bvh);
  const l = clip.loop;
  console.log(`${clip.name}: ${clip.source} → ${clip.frames} frames, energy ${clip.energy.toFixed(2)} rad/beat, reach ${clip.bigness.toFixed(2)}` +
    ` (${clip.found ? "found" : "cut"}: periodic ${l.periodic.toFixed(2)}, seam ${l.seam.toFixed(3)}, slide ${l.slide.toFixed(2)}, stray ${l.stray.toFixed(2)} legs)` +
    (clip.found || cut.bpm > 0 ? "" : ` (tempo estimated; candidates ${clip.estimate.candidates.map((c) => c.bpm.toFixed(0)).join("/")})`));
  clips.push({ ...clip, cut });
}
if (clips.length === 0) throw new Error("no clips built");
// Normalise energy and bigness to 0..1 across the library.
const lo = (k) => Math.min(...clips.map((c) => c[k]));
const hi = (k) => Math.max(...clips.map((c) => c[k]));
for (const k of ["energy", "bigness"]) {
  const a = lo(k), b = hi(k);
  for (const c of clips) c[k] = +(b > a ? (c[k] - a) / (b - a) : 0.5).toFixed(3);
}
// Only ClipMeta reaches the file: the encoder serialises whatever fields a
// clip carries, and clips-v1.bin ships every trial's tempo estimate.
const bytes = encodeClipLibrary(clips.map((c) => ({
  name: c.name, family: c.family, beats: c.beats, nativeBpm: c.nativeBpm, frames: c.frames,
  energy: c.energy, bigness: c.bigness, mirrorOf: c.mirrorOf, source: c.source, data: c.data,
})));
writeFileSync(outPath, bytes);
console.log(`wrote ${outPath}: ${clips.length} clips, ${(bytes.length / 1024).toFixed(1)} KB`);
if (reportPath) {
  const report = clips.map((c) => ({
    name: c.name, trial: c.cut.trial, family: c.family, note: c.cut.note ?? "", source: c.source,
    beats: c.beats, bpm: c.nativeBpm, energy: c.energy, bigness: c.bigness,
    found: c.found,
    loop: Object.fromEntries(Object.entries(c.loop).map(([k, v]) => [k, +v.toFixed(3)])),
  }));
  writeFileSync(resolve(reportPath), JSON.stringify(report, null, 1));
  console.log(`wrote ${reportPath}`);
}
console.log("Next: point CLIP_LIBRARY_URL (src/render/scenes/dancers/clipFormat.ts) at it and add it to tests/mediaManifest.ts (tests/sceneMedia.test.ts prints the line).");
