// Synthetic clip libraries for the dancers tests: every frame a valid,
// distinct pose, with energies/bigness the picker can be tested against.
import { buildLibrary, type Clip, type ClipLibrary } from "../src/render/scenes/dancers/clipFormat.ts";
import { BONE_COUNT, CH_LIFT, CH_ROOT_X, CH_ROOT_Z, POSE_LENGTH, createPose, setBoneEuler } from "../src/render/scenes/dancers/rig.ts";

export interface SyntheticClipSpec {
  name: string;
  family?: string;
  energy?: number;
  bigness?: number;
  beats?: number;
  nativeBpm?: number;
  /** Rotation amplitude in radians — how far this clip's poses swing. */
  amplitude?: number;
}

export function makeClip(spec: SyntheticClipSpec): Clip {
  const beats = spec.beats ?? 8;
  const frames = beats * 16;
  const amp = spec.amplitude ?? 0.8;
  const data = new Float32Array(frames * POSE_LENGTH);
  const pose = createPose();
  const seed = spec.name.length;
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    pose[CH_ROOT_X] = 0.1 * Math.sin(t * 6.28 + seed);
    pose[CH_ROOT_Z] = 0.05 * Math.cos(t * 6.28);
    pose[CH_LIFT] = 0.02 * (1 + Math.sin(t * 12.56));
    for (let b = 0; b < BONE_COUNT; b++) {
      setBoneEuler(pose, b, Math.sin(t * 6.28 + b + seed) * amp, Math.cos(t * 6.28 + b * 0.3) * amp * 0.6, Math.sin(b + seed) * amp * 0.5);
    }
    data.set(pose, f * POSE_LENGTH);
  }
  return {
    name: spec.name,
    family: spec.family ?? "test",
    beats,
    nativeBpm: spec.nativeBpm ?? 120,
    frames,
    energy: spec.energy ?? 0.5,
    bigness: spec.bigness ?? 0.5,
    mirrorOf: -1,
    source: "synthetic",
    data,
  };
}

/** Four clips across the energy range, two families. */
export function makeLibrary(): ClipLibrary {
  return buildLibrary([
    makeClip({ name: "chill", family: "swing", energy: 0.1, bigness: 0.2 }),
    makeClip({ name: "groove", family: "street", energy: 0.4, bigness: 0.4 }),
    makeClip({ name: "bounce", family: "street", energy: 0.7, bigness: 0.6 }),
    makeClip({ name: "wild", family: "party", energy: 1.0, bigness: 1.0 }),
  ]);
}
