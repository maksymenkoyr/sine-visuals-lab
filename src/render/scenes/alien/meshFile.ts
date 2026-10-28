/**
 * The alien's model as the scene loads it: MESH_URL, the ALM1 file
 * tools/alien-model/build.py writes from Blender (#772; its header has the
 * layout). decodeAlienMesh() turns it into mesh.ts's AlienMesh, plus which
 * vertices are eyeball (drawn black, glsl.ts) and the squeeze shape key
 * (#774).
 *
 * The file is indexed; the decoder de-indexes it, because the fragment
 * shader draws each triangle's own edges from a barycentric made from
 * gl_VertexID, which only works when no vertex is shared (mesh.ts's header).
 *
 * Pure and DOM/GL-free — tests/alien.test.ts decodes the real file under node.
 */
import { bindPose, MAX_INFLUENCES, type AlienMesh } from "./mesh.ts";

/** Under public/media/, so it is never replaced (src/pinnedAssets.ts's
 *  header, "Scene media"): a rebuilt model is a new file, mesh-v2.bin. */
export const MESH_URL = "/media/alien/mesh-v1.bin";

const MAGIC = "ALM1";
const HEADER_BYTES = 12;
/** A normal's fourth byte on an eyeball's vertices (0 on the skin). */
const EYE_FLAG = 127;
const NORMAL_SCALE = 127;

export interface AlienModel extends AlienMesh {
  /** 3 bytes per triangle: 1 on an eyeball, 0 on the skin. */
  eye: Uint8Array;
  /** 9 floats per triangle: the squeezed head's place less the normal one,
   *  in bind-pose metres; 0 below the neck. */
  squeeze: Float32Array;
  /** 9 floats per triangle: the squeezed head's unit normals. */
  squeezeNormal: Float32Array;
}

export function decodeAlienMesh(buf: ArrayBuffer): AlienModel {
  if (buf.byteLength < HEADER_BYTES || String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== MAGIC) {
    throw new Error("alien mesh: not an ALM1 file");
  }
  const view = new DataView(buf);
  const nv = view.getUint32(4, true);
  const triCount = view.getUint32(8, true);
  const expected = HEADER_BYTES + nv * (12 + 4 + MAX_INFLUENCES * 2 + 12 + 4) + triCount * 6;
  if (buf.byteLength !== expected) throw new Error(`alien mesh: ${buf.byteLength} bytes, the layout reads ${expected}`);

  // Views straight onto the file: every section starts aligned for its type,
  // and ALM1 is little-endian like every platform the app runs on.
  let o = HEADER_BYTES;
  const take = <T>(make: (at: number) => T, bytes: number): T => {
    const out = make(o);
    o += bytes;
    return out;
  };
  const pos = take((at) => new Float32Array(buf, at, nv * 3), nv * 12);
  const nrm = take((at) => new Int8Array(buf, at, nv * 4), nv * 4);
  const bns = take((at) => new Uint8Array(buf, at, nv * MAX_INFLUENCES), nv * MAX_INFLUENCES);
  const wts = take((at) => new Uint8Array(buf, at, nv * MAX_INFLUENCES), nv * MAX_INFLUENCES);
  const sqz = take((at) => new Float32Array(buf, at, nv * 3), nv * 12);
  const sqn = take((at) => new Int8Array(buf, at, nv * 4), nv * 4);
  const index = take((at) => new Uint16Array(buf, at, triCount * 3), triCount * 6);

  const corners = triCount * 3;
  const position = new Float32Array(corners * 3);
  const normal = new Float32Array(corners * 3);
  const bones = new Uint8Array(corners * MAX_INFLUENCES);
  const weights = new Uint8Array(corners * MAX_INFLUENCES);
  const eye = new Uint8Array(corners);
  const squeeze = new Float32Array(corners * 3);
  const squeezeNormal = new Float32Array(corners * 3);
  for (let c = 0; c < corners; c++) {
    const v = index[c];
    if (v >= nv) throw new Error(`alien mesh: index ${v} at corner ${c}, past ${nv} vertices`);
    for (let k = 0; k < 3; k++) {
      position[c * 3 + k] = pos[v * 3 + k];
      normal[c * 3 + k] = nrm[v * 4 + k] / NORMAL_SCALE;
      squeeze[c * 3 + k] = sqz[v * 3 + k];
      squeezeNormal[c * 3 + k] = sqn[v * 4 + k] / NORMAL_SCALE;
    }
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      bones[c * MAX_INFLUENCES + k] = bns[v * MAX_INFLUENCES + k];
      weights[c * MAX_INFLUENCES + k] = wts[v * MAX_INFLUENCES + k];
    }
    eye[c] = nrm[v * 4 + 3] === EYE_FLAG ? 1 : 0;
  }
  return { triCount, position, normal, bones, weights, bind: bindPose(), eye, squeeze, squeezeNormal };
}
