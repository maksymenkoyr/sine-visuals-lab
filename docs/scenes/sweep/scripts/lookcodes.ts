// node node_modules/vite-node/vite-node.mjs docs/scenes/sweep/scripts/lookcodes.ts [--json]
// — prints one Look share link per reel piece (src/render/scenes/sweep/pieces.ts:
// everything a Presets pill writes); with --json, the pieces as JSON instead
// ({name, ref, s} each), the input shoot_pieces.mjs and pair_pieces.py read.
const { encodeLook } = await import("../../../../src/render/sceneLooks.ts");
const { sweepScene } = await import("../../../../src/render/scenes/sweep/index.ts");
const { PIECES, presetValues } = await import("../../../../src/render/scenes/sweep/pieces.ts");
const pieces = PIECES.map((p) => ({ name: p.name, ref: p.ref, s: presetValues(p, sweepScene.settings ?? []) }));
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(pieces, null, 1));
} else {
  for (const p of pieces) {
    const code = encodeLook({ name: `Colorem ${p.name}`, sceneId: "sweep", manual: p.s });
    console.log(`${p.name}\t?look=${code}#/v/sweep`);
  }
}
