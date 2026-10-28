/**
 * The bake page: draws any frame of any loop with the live renderer
 * (renderer.ts) so tools/alien-bake.mjs can save it. Loaded only by
 * tools/alien-bake/index.html on the dev server — the app never imports it.
 *
 * `window.__bake`:
 *   - `ready`: resolves once the clip library and the model are in, with each loop's clip,
 *     captured length in seconds, and `pivot` — where the floor under the
 *     alien lands in the frame (0..1, y up), averaged over the loop: the
 *     point the scene's Bounce squashes toward;
 *   - `frame(loop, phase)`: draws that loop at `phase` (0..1 of the loop)
 *     and returns the frame as a PNG data URL.
 * `?w=&h=` sets the frame size.
 */
import { CLIP_LIBRARY_URL, decodeClipLibrary, sampleClip, type ClipLibrary } from "../dancers/clipFormat.ts";
import { createPose } from "../dancers/rig.ts";
import { FULL_VIEWPORT } from "../../scene.ts";
import { createAlienRenderer, floorPivot, NO_SQUASH, projectToFrame, type AlienRenderer } from "./renderer.ts";
import { clipSeconds, LOOPS } from "./reel.ts";
import { decodeAlienMesh, MESH_URL } from "./meshFile.ts";

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
let renderer: AlienRenderer | null = null;
const pose = createPose();
let library: ClipLibrary | null = null;

function clipFor(loop: number) {
  const clip = library?.byName.get(LOOPS[loop].clip);
  if (!clip) throw new Error(`bake: no clip ${LOOPS[loop].clip}`);
  return clip;
}

/** The floor point under the pelvis, averaged over the loop, in the frame. */
function pivotFor(loop: number): [number, number] {
  const [x, z] = floorPivot(clipFor(loop));
  return projectToFrame(LOOPS[loop].camera, width / height, [x, 0, z]);
}

const bytes = (url: string): Promise<ArrayBuffer> => fetch(url).then((res) => res.arrayBuffer());
const ready = Promise.all([bytes(CLIP_LIBRARY_URL), bytes(MESH_URL)])
  .then(([clips, mesh]) => {
    library = decodeClipLibrary(clips);
    renderer = createAlienRenderer(gl, decodeAlienMesh(mesh));
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
    if (!renderer) throw new Error("bake: frame() before ready");
    renderer.draw(pose, LOOPS[loop].camera, BLOOM_PASSES, FULL_VIEWPORT, NO_SQUASH);
    return canvas.toDataURL("image/png");
  },
};
