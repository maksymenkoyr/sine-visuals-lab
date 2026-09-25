# Adding a scene

If the scene is meant to look like a reference video, run `/ref` on it
first (`docs/tuning.md`, "Tuning against a reference video") — a contact
sheet shows the look, not the motion, and the motion is the sync.

Every scene ships with its record, `docs/scenes/<id>.md`, started from
[the template](scenes/_template.md) — the standing rule in `CLAUDE.md` says
what goes in it and what never does.

A **paid** scene is built the same way but lives elsewhere: in its own folder
of the private scenes repo, checked out at `src/render/scenes/private/<id>/`,
with an `index.ts` exporting `scene` (and `draft = true` while it's rough),
its tests next to it, and its record as `RECORD.md` there. It is never
registered in `scenes/index.ts` by hand, and nothing about it goes in this
repo. `src/render/scenes/privateScenes.ts` has the contract.

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
3. Register the scene as a side effect in `src/render/scenes/index.ts`
   (`registerScene(yourScene)`) and export it there like its neighbours. A new
   scene goes *first* among the drafts — that file's header comment owns the
   ordering rule and why.
4. If it should degrade or disable below some hardware quality, set `minQuality`
   on the `Scene` object — see `src/render/quality.ts` for what each preset means.
5. If the scene needs data it can't compute (the dancers' captured moves are
   the precedent — `src/render/scenes/dancers/clipFormat.ts` and the `clips.bin`
   beside it), generate it with a script under `tools/` and commit the output;
   import it with Vite's `?url` and `fetch` it when the scene is created,
   guarded so the module still imports under node (the tests import every
   scene), and dance something sensible until it arrives. Third-party data
   gets an entry in `THIRD-PARTY-NOTICES.md` like the fonts do.

Typecheck (`npm run typecheck`) catches a mismatched uniform name or a `Scene`
missing a required method; nothing here needs a special build step.

Once it renders, keep `npm run dev` running and give whoever is reviewing a
direct link to the scene rather than the gallery root — the dev server prints
one per scene at startup, and a scene registered first among the drafts is the
first draft link in that list. The standing rule in `CLAUDE.md` spells out the
URL form (query before the hash).

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
