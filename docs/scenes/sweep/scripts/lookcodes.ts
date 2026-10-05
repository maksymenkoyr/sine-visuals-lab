// node node_modules/vite-node/vite-node.mjs docs/scenes/sweep/scripts/lookcodes.ts docs/scenes/sweep/scripts/pieces.json
// — prints one Look share link per reel piece
// (every Sweep setting at its default, then the piece's own values).
import { readFileSync } from "node:fs";

const { encodeLook } = await import("../../../../src/render/sceneLooks.ts");
const { sweepScene } = await import("../../../../src/render/scenes/sweep/index.ts");
const pieces = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const [i, p] of pieces.entries()) {
  const manual = {};
  for (const s of sweepScene.settings) manual[s.key] = s.default;
  Object.assign(manual, p.s, { path: 100 + i });
  const code = encodeLook({ name: `Colorem ${p.name}`, sceneId: "sweep", manual });
  console.log(`${p.name}\t?look=${code}#/v/sweep`);
}
