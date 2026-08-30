#!/usr/bin/env node
// Builds src/render/scenes/dancers/clips.bin from the cut list in
// tools/clip-cuts.json: for every entry it fetches the CMU Motion Capture
// Database trial (the cgspeed BVH conversion, via the una-dinosauria/cmu-mocap
// mirror) into tools/.cache/, retargets it onto the dancers rig, cuts the
// requested beats into a seamless loop and quantises it through
// clipFormat.ts. Runs on plain node (24+, which strips TypeScript types, so
// the rig table and the format come straight from src/).
//
//   node tools/clip-convert.mjs                 # build every clip in the cut list
//   node tools/clip-convert.mjs --only macarena # just one
//   node tools/clip-convert.mjs --estimate 143_35   # print the tempo/beat estimate for a trial and exit
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
// autocorrelation of joint speed and the cut list may override it.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  B,
  BONES,
  BONE_COUNT,
  CH_LIFT,
  CH_ROOT_X,
  CH_ROOT_Z,
  POSE_LENGTH,
  ROOT_REST_Y,
  boneChannel,
  boneTail,
  createPose,
  createRigWorld,
  forwardKinematics,
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
const outPath = resolve(flag("--out", join(here, "..", "src", "render", "scenes", "dancers", "clips.bin")));
const cacheDir = join(here, ".cache");
const only = flag("--only", null);
const estimateOnly = flag("--estimate", null);

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

// ---- Clip assembly -------------------------------------------------------------

function fetchTrial(source, trial) {
  mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, `${trial}.bvh`);
  if (existsSync(path)) return readFileSync(path, "utf8");
  const subject = trial.split("_")[0];
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
  const bpm = cut.bpm > 0 ? cut.bpm : est.bpm;
  const start = Number.isFinite(cut.start) ? cut.start : est.firstBeatFrame;
  const beats = cut.beats ?? 8;
  const srcFramesPerBeat = (SOURCE_FPS * 60) / bpm;
  const end = start + beats * srcFramesPerBeat;
  if (end > bvh.frames - 1) throw new Error(`${cut.name}: ${beats} beats at ${bpm.toFixed(1)} bpm from frame ${start} runs past frame ${bvh.frames}`);

  // Retarget every source frame the cut touches.
  const first = Math.floor(start);
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

  // Resample to FRAMES_PER_BEAT per beat, then close the loop.
  const frames = beats * FRAMES_PER_BEAT;
  const data = new Float32Array(frames * POSE_LENGTH);
  const scratch = createPose();
  for (let k = 0; k < frames; k++) {
    const t = start + (k / frames) * (end - start) - first;
    const i0 = Math.min(n - 2, Math.floor(t));
    lerpPose(src[i0], src[i0 + 1], t - i0, scratch);
    data.set(scratch, k * POSE_LENGTH);
  }
  const blendFrames = Math.round(FRAMES_PER_BEAT / 4);
  const frame0 = data.subarray(0, POSE_LENGTH);
  for (let k = frames - blendFrames; k < frames; k++) {
    const w = (k - (frames - blendFrames) + 1) / (blendFrames + 1);
    const seg = data.subarray(k * POSE_LENGTH, (k + 1) * POSE_LENGTH);
    lerpPose(seg, frame0, w, seg);
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
  };
}

// ---- Main -------------------------------------------------------------------------

const cuts = JSON.parse(readFileSync(cutsPath, "utf8"));
if (estimateOnly) {
  const bvh = parseBvh(await fetchTrial(cuts.source, estimateOnly));
  const est = estimateTempo(bvh);
  console.log(`${estimateOnly}: ${bvh.frames} frames (${(bvh.frames / SOURCE_FPS).toFixed(1)} s)`);
  for (const c of est.candidates) console.log(`  ${c.bpm.toFixed(1)} bpm (lag ${c.lag}) score ${c.score.toFixed(3)}`);
  console.log(`  first beat frame ${est.firstBeatFrame} at ${est.bpm.toFixed(1)} bpm`);
  const gaps = est.hits.slice(1).map((h, i) => h - est.hits[i]);
  console.log(`  hits (frames): ${est.hits.join(" ")}`);
  console.log(`  gaps: ${gaps.join(" ")}`);
  // Where the actor faces over the trial, in degrees of yaw from +Z, every half second.
  const rt = buildRetarget(bvh);
  const headings = [];
  for (let f = 0; f < bvh.frames; f += SOURCE_FPS / 2) {
    const src = sourceWorld(bvh, f);
    const fwd = rot(qmul(src.rotW[rt.hips], qconj(bvhRot0(bvh, rt.hips))), [0, 0, 1]);
    headings.push(`${f}:${((Math.atan2(fwd[0], fwd[2]) * 180) / Math.PI).toFixed(0)}°`);
  }
  console.log(`  heading: ${headings.join(" ")}`);
  process.exit(0);
}

const clips = [];
for (const cut of cuts.clips) {
  if (only && cut.name !== only) continue;
  const bvh = parseBvh(await fetchTrial(cuts.source, cut.trial));
  const clip = buildClip(cut, bvh);
  console.log(`${clip.name}: ${clip.source} → ${clip.frames} frames, energy ${clip.energy.toFixed(2)} rad/beat, reach ${clip.bigness.toFixed(2)}` +
    (cut.bpm > 0 ? "" : ` (tempo estimated; candidates ${clip.estimate.candidates.map((c) => c.bpm.toFixed(0)).join("/")})`));
  clips.push(clip);
}
if (clips.length === 0) throw new Error("no clips built");
// Normalise energy and bigness to 0..1 across the library.
const lo = (k) => Math.min(...clips.map((c) => c[k]));
const hi = (k) => Math.max(...clips.map((c) => c[k]));
for (const k of ["energy", "bigness"]) {
  const a = lo(k), b = hi(k);
  for (const c of clips) c[k] = +(b > a ? (c[k] - a) / (b - a) : 0.5).toFixed(3);
}
const bytes = encodeClipLibrary(clips);
writeFileSync(outPath, bytes);
console.log(`wrote ${outPath}: ${clips.length} clips, ${(bytes.length / 1024).toFixed(1)} KB`);
