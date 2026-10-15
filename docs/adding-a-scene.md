# Adding a scene

If the scene is meant to look like a reference video, run `/ref` on it
first (`docs/tuning.md`, "Tuning against a reference video") — a contact
sheet shows the look, not the motion, and the motion is the sync.

Every scene ships with its record, `docs/scenes/<id>.md`, started from
[the template](scenes/_template.md) — the scene-record rule in `CLAUDE.md`
says what goes in it and what never does.

A **paid** scene is built the same way but lives elsewhere: in its own folder
of the private scenes repo, checked out at `src/render/scenes/private/<id>/`,
with an `index.ts` exporting `scene` (and `draft = true` while it's rough),
its tests next to it, and its record as `RECORD.md` there. It is
never a free scene module (no `gallery` record), and nothing about it goes in
this repo. `src/render/scenes/privateScenes.ts` has the contract.

## The mechanical path

1. Implement `Scene` (`src/render/scene.ts`) — usually via `createFullscreenScene`
   (`src/render/fullscreenScene.ts`), which builds `init`/`render`/`dispose` from
   just a fragment shader body plus a `settings` array. Look at an existing scene
   in `src/render/scenes/` close in spirit to what you're building before writing
   one from scratch — `sceneCommon.ts` documents what every fullscreen scene gets
   for free (`COMMON_UNIFORMS_GLSL`, `roomUv()`, band sampling, and the room
   palette — read it by role, `palRamp()`/`uPalInk`/`uPalGround`/`uPalAccent`,
   rather than sampling `palette()` at a `t` of your own; `src/render/palette.ts`'s
   header says what each role promises).
   A scene that writes its own `init()` creates all of its programs before it
   looks up a uniform or calls `use()` on one: a lookup waits for that program
   to compile, while the programs created before it compile alongside
   (`src/render/programCache.ts`'s header).
   A fallback that catches a compile error to switch something off must create
   that program on first draw, not in `init()`, where it is checked at once.
2. Each entry in `settings: SceneSetting[]` (spec'd in `sceneSettings.ts`) becomes
   a `uniform float u<Key>` in your shader, plus a slider/checkbox in the device
   menu. A setting that is an amount of reaction to the music also declares a
   `drive` and reads its signal through the generated `<key>Drive(…)` helper
   (or `drives.value`/`drives.fired` in JS), so the user can choose what it
   reacts to — `src/render/drives.ts`'s header is the full story. A setting
   read with `drives.fired` does one thing per hit: it also declares
   `drive.hit` (with `flatOnly` when its reaction has no size, like a cut),
   calls `fired()` every frame, and scales its reaction by
   `drives.hitSize(key)` (that header's "Hit drivers"; `tests/hitDrivers.test.ts`
   checks every scene). `min`/`max`/`step`/`default` are the slider; `label`/`description`/`group`
   are what the user sees (`description` is the hint that unfolds under the row
   on hover/focus; `group` is a closed vocabulary — see `SETTING_GROUPS`'s own
   doc comment in `sceneSettings.ts` for the rule that picks one);
   `type: "boolean"` renders a toggle instead, and `type: "enum"` with
   `options` renders a strip of named chips whose index is the stored value.
   If one enum decides what every other setting is even acting on (a style,
   a mode), mark it `variant: true` — the rest of the settings then keep a
   separate profile per option, with `variantDefaults` for a setting whose
   resting value differs by option; `SceneSetting.variant`'s doc comment in
   `sceneSettings.ts` owns the rules. Mark a setting
   `advanced: true` to tuck it behind a collapsed "show N more" disclosure within
   its group (`src/ui/controlsKit.ts`'s `createAdvancedSection`) — for a real,
   tunable constant that most people will only ever move as part of a `macro`
   group, not something worth doubling the group's row count for everyone.
   A scene with several identical, independently tunable instances of the
   same thing (several populations, emitters, objects) doesn't hand-write
   one `SceneSetting` per instance — see `src/render/sceneItems.ts`'s header
   for `defineItems`/`defineItemPairs`/`composeSettings`, and declare a
   `Scene.panel` entry (`scene.ts`) naming a widget from
   `src/ui/widgets/registry.ts` to show the group as boxes/rows instead of
   the plain per-setting loop (Physarum 2's Strains card is the worked
   example).
3. Make it a scene module: `src/render/scenes/<unit>.ts` or
   `src/render/scenes/<unit>/index.ts`, exporting the scene and
   `export const gallery = { stage: "draft", added: "<today>" } as const;` —
   `src/render/scenes/sceneModules.ts`'s header owns the contract and the
   ordering (each gallery section lists the newest first).
   `src/render/scenes/index.ts` finds it on its own; nothing shared is
   edited, so parallel branches adding scenes don't conflict. Once it's a
   scene module, it gets its own MAJOR.MINOR.PATCH automatically — `tools/sceneVersionLib.mjs`'s header owns
   how it's counted and how to raise its major by hand.
4. If it should degrade or disable below some hardware quality, set `minQuality`
   on the `Scene` object — see `src/render/quality.ts` for what each preset means.
5. If the scene needs data it can't compute (the dancers' captured moves are
   the precedent — `src/render/scenes/dancers/clipFormat.ts` and the library
   its `CLIP_LIBRARY_URL` names), generate it with a script under `tools/` and
   commit the output under `public/media/<scene>/`, with a version in its name
   (`<name>-v1.<ext>`), and add it to `tests/mediaManifest.ts`. Reach it
   through `sceneMedia()` and fetch it the first time the scene mounts, never
   at import, guarded so the module still imports under node (the tests import
   every scene); dance something sensible until it arrives.
   `src/pinnedAssets.ts`'s header has why, and why a committed file never
   changes. Third-party data gets an entry in `THIRD-PARTY-NOTICES.md` like
   the fonts do.

Typecheck (`npm run typecheck`) catches a mismatched uniform name or a `Scene`
missing a required method; nothing here needs a special build step.

Comment and indent shader code as freely as any other code: a production
build strips comments and indentation from every template literal that
reads as GLSL and keeps every line, so a compile error's line number still
matches (`vite-glsl-strip-plugin.ts`'s header has the rules, including the
templates it leaves alone).

Once it renders, keep `npm run dev` running and give whoever is reviewing a
direct link to the scene rather than the gallery root — the dev server prints
one per scene at startup, and a scene registered first among the drafts is the
first draft link in that list. Any query goes before the hash: one placed
after it lands on the gallery.

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

**A scene's own settings are manual by default — nothing to do on your part.**
`vibe.sceneAuto` (the auto-on store `autoTune.ts` reads) lists deviations from
each key's own default, not simply "the settings on auto." For a scene's own
settings, the default is manual, so a key that's never been touched —
including every key on a scene you just added — resolves to its plain
`default` (or `variantDefaults` entry) until someone explicitly switches it to
auto, via the row's own chip or the scene's master Auto button. You don't need
to seed anything for this to work; just don't add code that writes to that
store unprompted. (The one exception is the Input card's own Sensitivity/
Expansion/Smoothing pseudo-params — `autoTune.ts`'s `DEFAULT_AUTO_KEYS` — which
default to auto instead; that's the Input card's Auto button's territory, not
a scene's own settings, so it doesn't affect what you write.)

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
via `tools/tune-probe.mjs`) shows every setting's `mode` as `"manual"` until you
switch it to auto in the device menu, and `"auto"` after — never stuck one way.
