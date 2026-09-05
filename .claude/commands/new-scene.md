---
description: Walk the checklist for adding a new scene, including the auto-tune invariant
argument-hint: <sceneId>
---

Walk `docs/adding-a-scene.md` end to end for a new scene `$1`:

1. Implement `Scene` (`src/render/scene.ts`), normally via `createFullscreenScene`
   (`src/render/fullscreenScene.ts`). Look at an existing scene in
   `src/render/scenes/` close in spirit before writing from scratch.
2. Declare `settings: SceneSetting[]` — each key becomes a `uniform float
   u<Key>` and a device-menu control.
3. Register it: add to `src/render/scenes/index.ts` (`registerScene(...)`) —
   first among the drafts, per that file's header comment — and export it
   alongside its neighbours.
4. Set `minQuality` if the scene should degrade or disable below some hardware
   quality preset (`src/render/quality.ts`).
5. **Check the invariant before calling it done** — see `docs/adding-a-scene.md`
   for the full statement: every setting with an `auto` weight table must
   reproduce its plain `default` when all dials sit at `NEUTRAL`
   (`musicProfile.ts`), and the weight table itself should follow the magnitude
   convention in `autoTune.ts`'s header comment (worked examples in
   `caustics.ts`/`meshGrid.ts`).
6. Run `npm run typecheck` — catches a mismatched uniform name or a missing
   `Scene` method.
7. Start `npm run dev` and give the user the direct link it prints for `$1` —
   not the gallery root (see the standing rule in `CLAUDE.md` for the URL form).
8. Run the tuning loop (`/tune $1`) at a couple of BPMs with `?audio=synthetic`
   and confirm the probe shows every setting's `mode` as `"auto"` until you
   touch it in the device menu, `"manual"` after.

Report which steps are done and flag anything skipped.
