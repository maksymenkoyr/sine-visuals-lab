# Panel: three columns, with sound-transforming nodes in the middle

The controls panel becomes a patch bay in three columns: input nodes on the left (the meters, unchanged), sound-transforming nodes in the middle, animation nodes (a scene's reactive settings) on the right. A middle node takes one input node and sends a shaped copy out of its own jack, and any number of settings can plug into it. Focusing any node lights its whole chain across the three columns. This plan hands the build to a later session; branch `worktree-three-column-panel` already carries the plumbing (see "What the branch has").

Researched 2026-10-14 and 2026-10-15.

## Decisions

- The left column stays as it is (grouped meter cards, one jack per input node). The first prototype split it into one card per input node; the user: "for now lets keep inputs as they are."
- The middle nodes take over what a setting's own input controls hold today, rather than new controls. The user: "middles just move out what animation inputs had." The Patch Focus prototype reads that as Window (Min/Max), Smoothness, Length and Height moving into the node, while the setting keeps its wires, each wire's weight, the Mix and Reaction. **Not confirmed yet** (see Open questions).
- Focus works across all three columns. The user: "when u focus on input node u can see all sound transforming nodes that are connected to it and animation nodes. if u focus on sound transforming node u can see to which input node it connected and which animation nodes connected to it. and the same with animation."
- It should feel like a node editor. The user: "it should work kind of like in Vizibeat. and probably some other similar software." In Vizibeat a Normalize → Tail chain is built once, written out as a named signal, and read anywhere (memory note on the Vizibeat reel, `tools/.cache/refs/reel-1012/analysis.md` in the main checkout).
- Start from main, not from closed PR #512 (a V2 switch that moved a pinned setting's wire panel into its own column). The user: "ignore 512 and what was done in different session."

### Taken as answers on 2026-10-15 (the user said "implement", not confirmed point by point)

The build session read Patch Focus as the answer and filled each open question with its default. Each line can be overturned; say which.

- Into the node: Window (Min/Max, On/Off), Smoothness (how far the window softens, On/Off), Length and Height. Window and Smoothness reuse the setting gate's tracker and window math (`src/render/gateWindow.ts`), so a node's window behaves exactly like a setting's.
- ~~A setting still takes an input node straight, with no node between.~~ Overturned 2026-10-16: the user, on Treble sparkle's plain Hats + Any hit wires, "hats and any hit should be already in a modifier". Every input wire now arrives through a shared neutral modifier (`src/render/wireModifiers.ts` header): scene defaults, saved wires and new plugs alike.
- Each wire keeps its own weight. Mix and Reaction stay on the setting.
- Length is a new per-node fall time (seconds, 0 = off) on top of the Hits card's shared tail, not a replacement for it.
- Scene-handled thresholds (Dose, Cut, Ring threshold) and a hit driver's standout threshold stay on the setting: they are the scene's own, not the generic gate.
- What users already saved keeps working: the engine still honours a setting's own Window/Smoothness and a wire's Height (Looks and share links carry them). The wire panel shows those rows only while one is in effect (the gate switched on, a wire on Fixed or Loud). A wire's Shape button makes a node from that wire and carries them into it: the wire's Height always, the setting's window when the wire is its only one.
- A node made by Shape starts with its window off, so the picture doesn't change until the node is edited; a node made from "+ New shaping node" starts with it on.
- Focus: input rows and node cards light their chain on hover; a node pins with a click on its monitor row or input port, and Escape lets go. While a node is pinned, a click on an input jack makes the node read that input. Pinning a node unpins a setting and the other way round.
- Name, decided 2026-10-16: **modifier** (the user: "agree on modifier", after hearing that Notch calls these modifiers and Bitwig modulators). The panel says modifier; the code and stored data keep "shaping node"/`shaped` (#547 had already shipped to Insiders, so stored names stay), and `docs/vocabulary.md` maps the two.

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

- Each answer under "Taken as answers on 2026-10-15" above still needs the user's yes.

## What the branch has

Built by haiku-coder from a session plan, on top of main @ 76817850. Typecheck, the full test suite and `node tools/check.mjs` pass. The session read the `deviceMenu.ts` wiring; `src/render/shapingNodes.ts` and `src/ui/shapingColumn.ts` were not reviewed line by line. In the browser on Caustics, the column renders between the meters and the settings, cables run from the input jacks into the nodes and from a node's jack into a setting's port, and the wire panel names the wire "Bass level shaped".

Keep (the plumbing a middle node needs, whatever its controls):

- `src/render/shapingNodes.ts`: the device-wide store `vibe.shapingNodes` (synced to the pop-out and a room's TV like every `vibe.*` key; listed in `tests/syncedScope.test.ts`), ids that are never reused, a per-engine bank stepped once per tick at the top of `DriveEngine.accumulate`, and `DriveEngine.shaped(id)` for the panel (works with the panel closed, so heat keeps recording).
- A new wire source `{ source: "shaped", id }` (`DriveSourceChoice` in `src/render/drives.ts`): read like a level input, keyed `shaped:<id>`; a wire to a node that no longer exists reads 0. `remapShapedSources` rewrites ids.
- `src/render/driveStore.ts`: the sanitizer accepts it; `removeShapedSource(id)` unplugs a removed node everywhere.
- `src/render/sceneLooks.ts`: a Look carries the nodes its wires use (`h` in the share code), because node ids are per device; applying it reuses an identical local node or makes one (`adoptShapingNodes`).
- `src/ui/driveSources.ts`: labels ("Bass level shaped", "… shaped 2"), colour from the input, `driveAddGroups()` with a Shaped group, `shapingInputGroups()`.
- `src/ui/shapingColumn.ts`: the middle column. Each node is a card with a monitor row (an input port before the label, the node's jack beside its readout), an in/out graph that never rescales, a heat strip, the controls and "+ New shaping node". It is wired into `src/ui/deviceMenu.ts` through the same jack logic as the meters (`jackPatch`), and the node-input cables ride the cable layer's static fan group (`feedGroups`).

The first session's node controls (Expansion, Threshold, one-pole Smoothness) were replaced in phase 1.

## Phases

Built on 2026-10-15/16 in this one PR rather than one PR per phase (the user: "continue with pr 547. implement. use haiku coder"); each phase is its own commit.

- [x] **0. Answers** taken from Patch Focus, not confirmed point by point: "Taken as answers on 2026-10-15" above.
- [x] **1. The node's controls become the setting's input controls.** Window, Smoothness, Length, and Height for a hit input. The gate tracker, its knee and the Fixed/Loud envelope moved from `drives.ts` into `src/render/gateWindow.ts`, which both use; `drives.ts`'s behaviour is unchanged.
- [x] **2. The wire panel loses what moved.** The generic Window/Smoothness rows show only while a setting's own gate is on, a wire's Height only while it carries Fixed/Loud; the engine still honours both. A Shape button on a catalogue wire (`shapeSource` in `drives.ts`) inserts a node and carries those values into it.
- [x] **3. Focus across the columns, and drag to connect.** `src/ui/patchChain.ts` computes a chain; `deviceMenu.ts`'s `refreshChain` dims what's off it and `litSignalFan` draws the chain's wires. Kept the setting-only `pinned`/`preview` and added `pinnedNode`/`hoverNode` beside them, instead of one focus model replacing both: smaller change, same behaviour. An input row lights on hover or keyboard focus but doesn't pin. Drag: a jack onto a setting row, a node card, or the middle column (`dropTargetAt`/`dropJack`; `cableLayer.ts`'s `setDrag`). The column's placement beside an open Power card is JS (`placeShapingColumn`): it drops below Power when the gap is narrower than `SHAPE_COL_MIN_PX`.

Still open:
- The user's yes on the answers above.
- Known small edge: a drag cancelled with Escape and released on its own jack still clicks it.
- A line-by-line review of `shapingNodes.ts` and `shapingColumn.ts` beyond the session's own diff reads.

## How to check

- In a worktree, run the binaries directly: `node node_modules/typescript/bin/tsc -b`, `node node_modules/vitest/vitest.mjs run`, `node tools/check.mjs`.
- See it: serve with an untracked config that lets Vite read the symlinked node_modules fonts (`server.fs.allow`), open `/?audio=synthetic&bpm=124#/v/caustics`, open the panel with `#menuBtn`. Seed nodes and a wire with an init script: `localStorage.setItem("vibe.shapingNodes", JSON.stringify({ next: 3, nodes: [...] }))` and `localStorage.setItem("vibe.drives", JSON.stringify({ caustics: { causticDensity: { patch: { source: "shaped", id: "n2" } } } }))`.
- Press panel controls with a real press (mouse down, wait 250 ms, up), never `el.click()`: the panel rebuilds rows under the pointer.
