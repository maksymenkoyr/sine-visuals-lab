/**
 * The dance clip library: captured moves, retargeted onto the rig offline by
 * tools/clip-convert.mjs and shipped as one binary (`clips.bin`, loaded by
 * index.ts). A clip is a loop of `frames` Poses (rig.ts layout: root x/z,
 * lift, a quaternion per bone) spanning `beats` beats of its source
 * performance — playback never advances by wall time; player.ts turns the
 * beat clock into a phase and sampleClip() interpolates between frames, so
 * every clip beat lands on a music beat by construction.
 *
 * Binary layout, little-endian: u32 magic, u32 bone count (must equal
 * BONE_COUNT — a rig change invalidates every clip), u32 JSON length, the
 * ClipMeta[] as UTF-8 JSON, 2-byte alignment pad, then one int16 pool of
 * every clip's frames back to back (root channels in mm, quaternion
 * components × 32767). Mirrors are not stored: decodeClipLibrary() derives an
 * L/R-swapped twin of every clip, which doubles the library for free.
 *
 * Pure and DOM/GL-free — the converter imports this from node, and
 * tests/dancersClipFormat.test.ts round-trips it.
 */
import { BONES, BONE_COUNT, CH_LIFT, CH_ROOT_X, CH_ROOT_Z, POSE_LENGTH, boneChannel, quatNlerp, type Pose } from "./rig.ts";

export interface ClipMeta {
  /** Unique within the library; the `?clip=` DEV override and logs use it. */
  name: string;
  /** Which family the picker files it under: "street" | "party" | "swing" | "modern". */
  family: string;
  /** Beats the loop spans (4 to a bar) at nativeBpm. */
  beats: number;
  nativeBpm: number;
  frames: number;
  /** 0..1 how much the joints move per beat, relative to the library. */
  energy: number;
  /** 0..1 how far the hands reach from the body, relative to the library. */
  bigness: number;
  /** Index of the clip this one is the mirror of, or -1 for an original. */
  mirrorOf: number;
  /** Where it came from — e.g. "CMU 143_35 frames 240..1000". */
  source: string;
}

export interface Clip extends ClipMeta {
  /** frames × POSE_LENGTH floats, each frame a Pose. */
  data: Float32Array;
}

export interface ClipLibrary {
  clips: readonly Clip[];
  byName: ReadonlyMap<string, Clip>;
}

export const CLIP_MAGIC = 0x314e4344; // "DCN1"
const ROOT_SCALE = 1000; // metres → mm in int16
const QUAT_SCALE = 32767;
const HEADER_BYTES = 12;
/** Suffix a derived mirror carries on its name. */
export const MIRROR_SUFFIX = "~m";

function clampI16(v: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(v)));
}

/** Serialises originals only; mirrors are rebuilt on decode. */
export function encodeClipLibrary(clips: readonly Clip[]): Uint8Array {
  const originals = clips.filter((c) => c.mirrorOf < 0);
  const metas: ClipMeta[] = originals.map(({ data: _data, ...meta }) => meta);
  const json = new TextEncoder().encode(JSON.stringify(metas));
  const jsonEnd = HEADER_BYTES + json.length;
  const poolStart = jsonEnd + (jsonEnd % 2);
  let poolLen = 0;
  for (const c of originals) {
    if (c.data.length !== c.frames * POSE_LENGTH) throw new Error(`clip ${c.name}: data is ${c.data.length} floats, expected ${c.frames * POSE_LENGTH}`);
    poolLen += c.data.length;
  }
  const out = new Uint8Array(poolStart + poolLen * 2);
  const view = new DataView(out.buffer);
  view.setUint32(0, CLIP_MAGIC, true);
  view.setUint32(4, BONE_COUNT, true);
  view.setUint32(8, json.length, true);
  out.set(json, HEADER_BYTES);
  let o = poolStart;
  for (const c of originals) {
    for (let f = 0; f < c.frames; f++) {
      const base = f * POSE_LENGTH;
      for (let i = 0; i < POSE_LENGTH; i++) {
        const v = c.data[base + i];
        view.setInt16(o, clampI16(i < 3 ? v * ROOT_SCALE : v * QUAT_SCALE), true);
        o += 2;
      }
    }
  }
  return out;
}

export function decodeClipLibrary(buf: ArrayBufferLike): ClipLibrary {
  const view = new DataView(buf);
  if (buf.byteLength < HEADER_BYTES || view.getUint32(0, true) !== CLIP_MAGIC) throw new Error("clips: not a clip library");
  const boneCount = view.getUint32(4, true);
  if (boneCount !== BONE_COUNT) throw new Error(`clips: built for ${boneCount} bones, the rig has ${BONE_COUNT} — re-run tools/clip-convert.mjs`);
  const jsonLen = view.getUint32(8, true);
  const metas = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, HEADER_BYTES, jsonLen))) as ClipMeta[];
  const jsonEnd = HEADER_BYTES + jsonLen;
  let o = jsonEnd + (jsonEnd % 2);
  const clips: Clip[] = [];
  for (const meta of metas) {
    const data = new Float32Array(meta.frames * POSE_LENGTH);
    for (let f = 0; f < meta.frames; f++) {
      const base = f * POSE_LENGTH;
      for (let i = 0; i < POSE_LENGTH; i++) {
        const v = view.getInt16(o, true);
        data[base + i] = i < 3 ? v / ROOT_SCALE : v / QUAT_SCALE;
        o += 2;
      }
    }
    clips.push({ ...meta, mirrorOf: -1, data });
  }
  const originals = clips.length;
  for (let i = 0; i < originals; i++) clips.push(mirrorClip(clips[i], i));
  return buildLibrary(clips);
}

export function buildLibrary(clips: readonly Clip[]): ClipLibrary {
  const byName = new Map<string, Clip>();
  for (const c of clips) {
    if (byName.has(c.name)) throw new Error(`clips: duplicate name ${c.name}`);
    byName.set(c.name, c);
  }
  return { clips, byName };
}

/** For each bone, the index of its sagittal twin (itself for the midline). */
export const MIRROR_BONE: readonly number[] = BONES.map((spec) => {
  const twin = spec.name.startsWith("L_") ? spec.name.replace(/^L_/, "R_") : spec.name.startsWith("R_") ? spec.name.replace(/^R_/, "L_") : spec.name;
  return BONES.findIndex((s) => s.name === twin);
});

/** The same move danced by the other side of the body: root x negated,
 *  L/R bones swapped, each rotation reflected through the sagittal plane —
 *  (x, y, z, w) → (x, -y, -z, w), which is exact because every L_/R_ rest
 *  rotation in BONES is its own mirror image. */
export function mirrorClip(clip: Clip, index: number): Clip {
  const data = new Float32Array(clip.data.length);
  for (let f = 0; f < clip.frames; f++) {
    const base = f * POSE_LENGTH;
    data[base + CH_ROOT_X] = -clip.data[base + CH_ROOT_X];
    data[base + CH_ROOT_Z] = clip.data[base + CH_ROOT_Z];
    data[base + CH_LIFT] = clip.data[base + CH_LIFT];
    for (let b = 0; b < BONE_COUNT; b++) {
      const src = base + boneChannel(MIRROR_BONE[b]);
      const dst = base + boneChannel(b);
      data[dst] = clip.data[src];
      data[dst + 1] = -clip.data[src + 1];
      data[dst + 2] = -clip.data[src + 2];
      data[dst + 3] = clip.data[src + 3];
    }
  }
  return { ...clip, name: clip.name + MIRROR_SUFFIX, mirrorOf: index, data };
}

/** Writes the pose at `phase` (0..1 around the loop; any real number wraps)
 *  into `out`, interpolating between the two nearest frames. */
export function sampleClip(clip: Clip, phase: number, out: Pose): void {
  const n = clip.frames;
  let x = (phase - Math.floor(phase)) * n;
  if (!(x >= 0) || x >= n) x = 0;
  const i0 = Math.floor(x);
  const i1 = i0 + 1 === n ? 0 : i0 + 1;
  const t = x - i0;
  const a = i0 * POSE_LENGTH;
  const b = i1 * POSE_LENGTH;
  const d = clip.data;
  for (let i = 0; i < 3; i++) out[i] = d[a + i] + (d[b + i] - d[a + i]) * t;
  for (let bone = 0; bone < BONE_COUNT; bone++) {
    const ch = boneChannel(bone);
    quatNlerp(d, a + ch, d, b + ch, t, out, ch);
  }
}
