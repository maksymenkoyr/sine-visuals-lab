/**
 * The bake page: draws any frame of any loop with the live renderer
 * (renderer.ts) so tools/alien-bake.mjs can save it. Loaded only by
 * tools/alien-bake/index.html on the dev server — the app never imports it.
 *
 * `window.__bake`:
 *   - `ready`: resolves once the clip library is in, with each loop's clip,
 *     captured length in seconds, and `pivot` — where the floor under the
 *     alien lands in the frame (0..1, y up), averaged over the loop: the
 *     point the scene's Bounce squashes toward;
 *   - `frame(loop, phase)`: draws that loop at `phase` (0..1 of the loop)
 *     and returns the frame as a PNG data URL.
 * `?w=&h=` sets the frame size.
 */
import { decodeClipLibrary, sampleClip, type ClipLibrary } from "../dancers/clipFormat.ts";
import { B, CH_LIFT, createPose, createRigWorld, forwardKinematics, groundToFloor } from "../dancers/rig.ts";
import { createAlienRenderer, projectToFrame } from "./renderer.ts";
import { clipSeconds, LOOPS } from "./reel.ts";

/** Poses averaged per loop for its pivot. */
const PIVOT_SAMPLES = 32;
const BLOOM_PASSES = 2;

const params = new URLSearchParams(location.search);
const width = Number(params.get("w") ?? 1280);
const height = Number(params.get("h") ?? 720);
const canvas = document.createElement("canvas");
canvas.width = width;
canvas.height = height;
document.body.appendChild(canvas);
const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
if (!gl) throw new Error("bake: no WebGL2");
const renderer = createAlienRenderer(gl);
const pose = createPose();
const world = createRigWorld();
let library: ClipLibrary | null = null;

function clipFor(loop: number) {
  const clip = library?.byName.get(LOOPS[loop].clip);
  if (!clip) throw new Error(`bake: no clip ${LOOPS[loop].clip}`);
  return clip;
}

/** The floor point under the pelvis, averaged over the loop, in the frame. */
function pivotFor(loop: number): [number, number] {
  const clip = clipFor(loop);
  let x = 0, z = 0;
  for (let i = 0; i < PIVOT_SAMPLES; i++) {
    sampleClip(clip, i / PIVOT_SAMPLES, pose);
    forwardKinematics(pose, world);
    groundToFloor(world, pose[CH_LIFT]);
    x += world.pos[B.pelvis * 3];
    z += world.pos[B.pelvis * 3 + 2];
  }
  return projectToFrame(LOOPS[loop].camera, width / height, [x / PIVOT_SAMPLES, 0, z / PIVOT_SAMPLES]);
}

const ready = fetch("/src/render/scenes/dancers/clips.bin")
  .then((res) => res.arrayBuffer())
  .then((buf) => {
    library = decodeClipLibrary(buf);
    return {
      width,
      height,
      loops: LOOPS.map((l, i) => ({ clip: l.clip, seconds: clipSeconds(clipFor(i)), pivot: pivotFor(i) })),
    };
  });

(window as unknown as { __bake: unknown }).__bake = {
  ready,
  frame(loop: number, phase: number): string {
    sampleClip(clipFor(loop), phase, pose);
    renderer.draw(pose, LOOPS[loop].camera, BLOOM_PASSES);
    return canvas.toDataURL("image/png");
  },
};
