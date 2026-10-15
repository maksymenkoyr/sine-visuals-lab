// The page half of tools/perf.mjs's scene list: every registered scene with
// its gallery stage, published on window.__scenes. Paid scenes are left out
// even when a private checkout is present — nothing measured about them may
// land in this public repo (src/render/scenes/privateScenes.ts header).
import { listScenes } from "../../src/render/scene.ts";
import * as registry from "../../src/render/scenes/index.ts";

const r = registry as unknown as { sceneStage?: (id: string) => string; PAID_SCENE_IDS?: ReadonlySet<string> };
(window as unknown as { __scenes: unknown }).__scenes = listScenes()
  .filter((s) => !r.PAID_SCENE_IDS?.has(s.id))
  .map((s) => ({ id: s.id, name: s.name, stage: r.sceneStage?.(s.id) ?? null }));
