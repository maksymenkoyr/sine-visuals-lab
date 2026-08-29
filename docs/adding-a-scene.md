# Adding a scene

## The mechanical path

1. Implement `Scene` (`src/render/scene.ts`) — usually via `createFullscreenScene`
   (`src/render/fullscreenScene.ts`), which builds `init`/`render`/`dispose` from
   just a fragment shader body plus a `settings` array. Look at an existing scene
   in `src/render/scenes/` close in spirit to what you're building before writing
   one from scratch — `sceneCommon.ts` documents what every fullscreen scene gets
   for free (`COMMON_UNIFORMS_GLSL`, `roomUv()`, `palette()`, band sampling).
2. Each entry in `settings: SceneSetting[]` (spec'd in `sceneSettings.ts`) becomes
   a `uniform float u<Key>` in your shader, plus a slider/checkbox in the device
   menu. `min`/`max`/`step`/`default` are the slider; `label`/`description`/`group`
   are what the user sees (`description` is the hint that unfolds under the row
   on hover/focus); `type: "boolean"` renders a toggle instead. Mark a setting
   `advanced: true` to tuck it behind a collapsed "show N more" disclosure within
   its group (`src/ui/controlsKit.ts`'s `createAdvancedSection`) — for a real,
   tunable constant that most people will only ever move as part of a `macro`
   group, not something worth doubling the group's row count for everyone.
3. Register the scene as a side effect in `src/render/scenes/index.ts`
   (`registerScene(yourScene)`) and export it there like its neighbours.
4. If it should degrade or disable below some hardware quality, set `minQuality`
   on the `Scene` object — see `src/render/quality.ts` for what each preset means.

Typecheck (`npm run typecheck`) catches a mismatched uniform name or a `Scene`
missing a required method; nothing here needs a special build step.

## The invariant you can't get from typecheck

This is the one piece of scene-authoring knowledge that has no single owning
file — you write the mistake in `src/render/scenes/yourScene.ts`, but the rule
it violates lives in `src/render/autoTune.ts`. Get it wrong and the scene won't
error or fail a test; it'll just look subtly off on ordinary music, in a way
that reads as "needs more tuning" rather than "this is a bug."

**If a setting has an `auto` weight table, all dials at `NEUTRAL`
(`src/render/musicProfile.ts`) must reproduce that setting's plain `default`.**
This isn't enforced by the type system — it falls out of how `autoTune.ts`
resolves a setting, but only if you don't fight it. Don't hand-bias a weight
table to compensate for a default you don't like; fix the default instead.

**Same rule for `macro`, anchored to the driver instead of NEUTRAL.** A
setting with a `macro` (its own knob folded into a master, e.g. caustics'
Sparkle sub-params following `sparkle`) must reproduce its plain `default`
when the driver sits at *its* default — see `computeMacroTarget` in
`autoTune.ts`. A weight of `0` is a legitimate choice, not a bug: it opts a
sub-param out of the master entirely (see `sparkleGrain`) rather than forcing
every knob under a group to move together.

**Auto is the default for every setting, with no extra work on your part.**
`vibe.sceneAuto` (the manual-pin store `autoTune.ts` reads) only ever lists
settings a user has explicitly taken manual control of. A key that's never been
touched — including every key on a scene you just added — is auto from the
first run. You don't need to seed anything for this to work; you'd only break
it by adding code that writes to that store unprompted.

**Weight-authoring convention:** `autoTune.ts`'s own header comment states the
recommended magnitude range for `|weight|` per dial and its per-setting sum —
check there for the current numbers rather than trusting a copy here, and see
the `auto:` tables in `caustics.ts` and `meshGrid.ts` for worked examples. Not
enforced in code — it's what keeps a music-driven deviation feel like the same
scene reacting, not a different scene taking over. The dials themselves are
`MUSIC_DIALS` in `src/render/musicProfile.ts`, along with the file-header note on
why each one is computed the way it is.

## Before you call it done

Use the tuning loop (`docs/tuning.md`) against your new scene with `?audio=
synthetic` at a couple of BPMs, and check the probe output (`src/tuning/probe.ts`
via `tools/tune-probe.mjs`) shows every setting's `mode` as `"auto"` until you
touch it in the device menu, and `"manual"` after — never stuck one way.
