# Panel: three columns, with sound-transforming nodes in the middle

The controls panel becomes a patch bay in three columns: input nodes on the left (the meters, unchanged), sound-transforming nodes in the middle, animation nodes (a scene's reactive settings) on the right. A middle node takes one input node and sends a shaped copy out of its own jack, and any number of settings can plug into it. Focusing any node lights its whole chain across the three columns. This plan hands the build to a later session; branch `worktree-three-column-panel` already carries the plumbing (see "What the branch has").

Researched 2026-10-14 and 2026-10-15.

## Decisions

- The left column stays as it is (grouped meter cards, one jack per input node). The first prototype split it into one card per input node; the user: "for now lets keep inputs as they are."
- The middle nodes take over what a setting's own input controls hold today, rather than new controls. The user: "middles just move out what animation inputs had." The Patch Focus prototype reads that as Window (Min/Max), Smoothness, Length and Height moving into the node, while the setting keeps its wires, each wire's weight, the Mix and Reaction. **Not confirmed yet** (see Open questions).
- Focus works across all three columns. The user: "when u focus on input node u can see all sound transforming nodes that are connected to it and animation nodes. if u focus on sound transforming node u can see to which input node it connected and which animation nodes connected to it. and the same with animation."
- It should feel like a node editor. The user: "it should work kind of like in Vizibeat. and probably some other similar software." In Vizibeat a Normalize → Tail chain is built once, written out as a named signal, and read anywhere (memory note on the Vizibeat reel, `tools/.cache/refs/reel-1012/analysis.md` in the main checkout).
- Start from main, not from closed PR #512 (a V2 switch that moved a pinned setting's wire panel into its own column). The user: "ignore 512 and what was done in different session."

## Prototypes

Three Column Panel (the user's first prototype: Sound, Shaping, Scene)
https://claude.ai/artifact/Du31dd12XN2WEVGKh3mz4k

Patch Focus (the session's reading of the decisions above: focus chains, controls moved into the node, drag a jack onto a port, Shape on a direct wire). Shown to the user, not yet confirmed.
https://claude.ai/artifact/3QHry9fsgTsZ9HTDXeNxM9

## Rejected

- One card per input node in the left column, for now ("keep inputs as they are").
- The first prototype's node controls as new controls: Expansion around the node's own running mean, a plain Threshold and a one-pole Smoothness. The branch has them built; phase 1 below replaces them.
- A V2 switch that only moves the wire panel into a column of its own (#512).

## Open questions

- Is Patch Focus what the user means? In particular, which controls move into the node: Window and Smoothness only, or Length and Height too? Blocks phase 1.
- Can a setting still take an input node straight, with no node between (Patch Focus allows it: Energy → Glow)? Blocks phase 2.
- Does each wire keep its own weight, or does weight move into the node? Blocks phase 2.
- Reaction (Flat/Sized) on hit settings: stays on the setting in Patch Focus. Confirm. Blocks phase 2.
- What happens to what users already saved: a setting's own Window/Smoothness (`vibe.drives` entries' `threshold`, `windowMax`, `smoothness` fields) and a wire's Height (`DriveSource.height`, also inside Looks' `d`, and links in the wild outlive the schema, `src/render/sceneLooks.ts` header). Options: turn each into a node on first load, or keep honouring the old fields without showing them. Blocks phase 2.
- Scene-handled thresholds (`SceneSetting.drive.threshold`: Physarum 2's Dose, Alien's Cut, Caustics' Ring threshold) and hit drivers' standout detector (`drive.hit`) are the scene's own, not the generic gate. Do they stay on the setting? Blocks phase 2.
- "Length" today is the Hits card's tail per lane, shared by every setting (`vibe.hitTail*`), not a per-setting control. Is a node's Length a new per-node tail on top of it? Blocks phase 1.
- Name: the user says "sound transforming node"; the branch's code and `docs/vocabulary.md` say "shaping node". Pick one before any string ships. Blocks merging.
- The middle column's CSS centres it in the gap between the meters and the settings, ignoring the Power card's width when Power is open: they overlap at roughly 1000 to 1430 px wide with Power open. Fix in phase 3.

## What the branch has

Built by haiku-coder from a session plan, on top of main @ 76817850. Typecheck, the full test suite and `node tools/check.mjs` pass. The session read the `deviceMenu.ts` wiring; `src/render/shapingNodes.ts` and `src/ui/shapingColumn.ts` were not reviewed line by line. In the browser on Caustics, the column renders between the meters and the settings, cables run from the input jacks into the nodes and from a node's jack into a setting's port, and the wire panel names the wire "Bass level shaped".

Keep (the plumbing a middle node needs, whatever its controls):

- `src/render/shapingNodes.ts`: the device-wide store `vibe.shapingNodes` (synced to the pop-out and a room's TV like every `vibe.*` key; listed in `tests/syncedScope.test.ts`), ids that are never reused, a per-engine bank stepped once per tick at the top of `DriveEngine.accumulate`, and `DriveEngine.shaped(id)` for the panel (works with the panel closed, so heat keeps recording).
- A new wire source `{ source: "shaped", id }` (`DriveSourceChoice` in `src/render/drives.ts`): read like a level input, keyed `shaped:<id>`; a wire to a node that no longer exists reads 0. `remapShapedSources` rewrites ids.
- `src/render/driveStore.ts`: the sanitizer accepts it; `removeShapedSource(id)` unplugs a removed node everywhere.
- `src/render/sceneLooks.ts`: a Look carries the nodes its wires use (`h` in the share code), because node ids are per device; applying it reuses an identical local node or makes one (`adoptShapingNodes`).
- `src/ui/driveSources.ts`: labels ("Bass level shaped", "… shaped 2"), colour from the input, `driveAddGroups()` with a Shaped group, `shapingInputGroups()`.
- `src/ui/shapingColumn.ts`: the middle column. Each node is a card with a monitor row (an input port before the label, the node's jack beside its readout), an in/out graph that never rescales, a heat strip, the controls and "+ New shaping node". It is wired into `src/ui/deviceMenu.ts` through the same jack logic as the meters (`jackPatch`), and the node-input cables ride the cable layer's static fan group (`feedGroups`).

Replace in phase 1: the node's controls (`ShapingNodeDef`, `stepShapingNode`, the three control rows in `shapingColumn.ts`, their tests).

## Phases

Each phase is one build session and one PR. Line numbers below are from main @ 76817850; search by symbol.

- [ ] **0. Confirm Patch Focus and answer the open questions** marked "blocks phase 1/2". Update this file's Decisions.
- [ ] **1. The node's controls become the setting's input controls**
  - Window Min/Max on the input's own learned floor and peak, and the Smoothness knee: reuse the generic gate's tracker and math in `src/render/drives.ts` (`GateTrackerState`, `advanceGateTracker`, the window read in `forScene`'s `applyGenericGate`; defaults `GENERIC_THRESHOLD_DEFAULT`, `GENERIC_WINDOW_MAX_DEFAULT`, `GENERIC_SMOOTHNESS_DEFAULT`) rather than writing a second copy.
  - Height (Graded/Fixed/Loud) needs the input's edge and its decay rate: `heightTailLane`, `heightDecayPerSec`, `loudLevel` in drives.ts. Move or export them so the node can use them.
  - Length: per the answer above.
  - Touches: `src/render/shapingNodes.ts`, `src/render/drives.ts`, `src/ui/shapingColumn.ts`, `tests/shapingNodes.test.ts`, `src/render/sceneLooks.ts` (the `h` def shape), `docs/vocabulary.md`.
- [ ] **2. The setting's wire panel loses what moved**
  - The Window/Threshold and Smoothness rows (`buildPatchPanel` ~4209 and the threshold/smoothness builders ~3400–3520 in `src/ui/deviceMenu.ts`), the per-wire Height seg (`buildHeightSeg`, used in `buildSourceLine` ~3739), plus the migration chosen above. Add a Shape button on a direct wire that inserts a node and rewires through it.
  - Touches: `src/ui/deviceMenu.ts`, `src/render/driveStore.ts`, `src/render/drives.ts` (keep or drop the per-setting gate), `src/render/sceneLooks.ts`, their tests; every scene record whose defaults or notes mention a setting's Window, if any change (`docs/scenes/<id>.md`).
- [ ] **3. Focus across the three columns, and drag to connect**
  - A focus model `{ kind: input | node | setting, id }` that replaces today's setting-only `pinned`/`preview` (`togglePin` ~4724, `pinSetting`, `previewDrive`, `activePreview`, `shownSelection` in deviceMenu.ts), and generalizes today's hover fan from a meter row (`litSignalFan` ~5214, `hoverJackRow`).
  - The chain: an input's nodes and every setting it reaches; a node's input and its settings; a setting's wires, their nodes and those nodes' inputs. Dim everything off the chain: meter rows (audioMeters' `jackRegistry` feedEl), node cards, drive rows (`driveRowHandles[].rowEl`). Draw the chain's cables bright.
  - Drag a jack onto a port; drop an input jack on the middle column to make a node. Today a jack only clicks (`onJackClick` ~4944 via `jackTarget`). `src/ui/cableLayer.ts` needs a temporary path for the drag.
  - Fix the column's overlap with an open Power card.
  - Touches: `src/ui/deviceMenu.ts`, `src/ui/audioMeters.ts`, `src/ui/shapingColumn.ts`, `src/ui/cableLayer.ts`, `src/ui/controlsTheme.ts`.

## How to check

- In a worktree, run the binaries directly: `node node_modules/typescript/bin/tsc -b`, `node node_modules/vitest/vitest.mjs run`, `node tools/check.mjs`.
- See it: serve with an untracked config that lets Vite read the symlinked node_modules fonts (`server.fs.allow`), open `/?audio=synthetic&bpm=124#/v/caustics`, open the panel with `#menuBtn`. Seed nodes and a wire with an init script: `localStorage.setItem("vibe.shapingNodes", JSON.stringify({ next: 3, nodes: [...] }))` and `localStorage.setItem("vibe.drives", JSON.stringify({ caustics: { causticDensity: { patch: { source: "shaped", id: "n2" } } } }))`.
- Press panel controls with a real press (mouse down, wait 250 ms, up), never `el.click()`: the panel rebuilds rows under the pointer.
