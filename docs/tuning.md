# Tuning loop

This is "the plan" that `src/tuning/probe.ts`'s header comment refers to — it
didn't exist before this doc. It's the live-tuning workflow used to dial in
per-scene defaults and `auto` weights against real (or reproducible synthetic)
audio, without reloading the page or stopping playback.

Everything here is dev-only. `src/tuning/overrides.ts` is gated on
`import.meta.env.DEV`, so none of it compiles into a production build, and it can
never clobber a real user's saved settings (`sceneSettings.ts`'s localStorage
store) — overrides sit in front of that store, not inside it. `src/tuning/pins.ts`
is the same idea with one difference: a pin is set by hand, by typing a value past
a slider's end into its readout (below), not by the param bus, and it persists across a
reload where an override doesn't. `resolve()` (`src/render/autoTune.ts`) checks
an override first, then a pin, then auto-pin, so a value the param bus explicitly
sets always wins over a pin left over from an earlier by-hand session.

`tuning/params.json`'s `autoPin` ships `false`, so a dev session resolves Auto
exactly like the deployed site — the music keeps pushing auto-driven settings
around, same as production. A tuning run that wants to hold a value still
while judging it sets `"autoPin": true` in `tuning/params.json` (or passes it
to `window.__viz.setParams`) to stop the music from pushing it around. Every
`setParams` or `params.json` push is a full snapshot — a dropped `autoPin`
means false, like a dropped setting — so a script that wants the pin passes it
on every call.

## Reproducibility

Tune against synthetic audio so a result is comparable across sessions:

```
https://localhost:5173/?audio=synthetic&bpm=<bpm>#/v/<sceneId>
```

The query sits *before* the hash — `src/app.ts` reads `location.search`, and
`#/v/<sceneId>?audio=…` silently lands on the gallery instead.
`src/audio/synthetic.ts` is the feed this drives. Real music is still the final
check — synthetic audio is for comparing runs, not for judging how a scene feels.

## The loop

1. **Param bus.** Edit `tuning/params.json`. `vite-tuning-plugin.ts` (dev-only
   Vite plugin) watches it, rebroadcasts it over Vite's HMR socket as event
   `viz:params`, and serves `GET /__tuning/params` for a client that connects
   after the edit. `src/tuning/bus.ts` applies the payload to the override layer
   on the next frame. Audio keeps playing; nothing reloads.

   The controls panel is a second, by-hand entry point into the same idea.
   Every slider row's readout takes a typed value, in every build
   (`src/ui/typedValue.ts`), and one inside the slider's range is just the
   setting, saved like a drag. In a dev build, on a scene-setting or Input-card
   row, one typed outside that range becomes a pin instead of clamping
   (`src/tuning/pins.ts`) — unclamped, marked with `*`, persisted, and cleared
   by emptying the field, dragging the slider, pressing its ↺, or handing the
   row to auto.
2. **Mark.** Alt+M (wired in `src/tuning/debug.ts`) captures one frame plus a
   probe snapshot and POSTs it to `/__tuning/mark`; the plugin writes
   `tuning/marks/<timestamp>.png` and `<timestamp>.json` (both gitignored — marks
   are working scratch, not committed artifacts).
3. **Bake.** Once a setting's dialled-in value is the one you want to ship,
   Alt+D (also `src/tuning/debug.ts`) rewrites it straight into the scene's
   own `default:` literal on disk — this is a real source edit, not a local
   preference, so it becomes the app's default for every user once committed
   and pushed. It's a two-press flow: the first Alt+D previews the file and
   the exact old→new numbers without writing anything; a second Alt+D within
   the window commits it, which triggers Vite's full reload (no scene module
   has an HMR boundary) — the confirmation survives that reload as a
   persistent notice. A setting currently held by a pin or an override is
   skipped and named in the notice, since baking it would just be clamped
   back on the next load. Review the resulting `git diff` before committing —
   a trailing `// comment` explaining the old value survives the rewrite
   verbatim and can go stale.
4. **Numeric probe.** `src/tuning/probe.ts` builds a compact per-frame snapshot:
   each setting's `base` (plain default), `resolved` (what actually reached the
   shader), and `mode` (`ProbeSettingValue["mode"]` — override/pin/auto/manual),
   plus the device-wide scene master's dials: `getSceneMaster`, which every
   `resolved` has already passed through, and `getSceneExpansion`, which
   reshapes every drive reading — leave them at their identity defaults
   while tuning, or read them off the snapshot before trusting a delta.
   Its own stated principle, worth keeping: *answer with numbers, not pixels* —
   read the probe before trusting your eyes on whether a change landed. Drive it
   headlessly with `tools/tune-probe.mjs`.

   The probe's settings are only ever what a scene *declares*; they carry no
   sense of "more intense" a master dial could read. The Master card's own
   Picture block answers that by measuring the rendered picture itself instead
   — see `src/render/pictureMeter.ts` for what it measures and why.
   `tools/master-sweep.mjs` drives the same measurement headlessly across
   every scene and master value, and writes a report page: which scenes the
   dial barely moves, which measure it moves most, and where a scene clips.
   It's also what the display scales in `PICTURE_MEASURES` are calibrated
   from — rerun it after changing a measure.
5. **Contact sheet.** `tools/tune-sheet.mjs` (backed by `src/tuning/capture.ts`)
   tiles N frames into one PNG — `--frames`, `--every`, `--settle` control the
   sampling. Use this to see a setting's effect across a stretch of audio at a
   glance, instead of scrubbing frame by frame.
6. **A/B.** `tools/tune-ab.mjs` runs two param sets in parallel pages against the
   same synthetic-audio timecode, for a direct side-by-side.

## The debug surface

`window.__viz` (wired from `src/app.ts`, DEV-only) exposes `probe()`, `probeText()`,
`capture()`, `mark()`, `setParams()`, `clearPins()`, `bakeDefaults()` — the same
primitives the CLI tools above (and Alt+D) drive headlessly, available from the
browser console for quick checks. `clearPins()` is for a scripted run: it drops
every pin left over from an earlier by-hand panel session before that run pushes
its own params. `bakeDefaults()` always dry-runs (mirrors Alt+D's first press,
never writes) — a script that wants the actual write posts to `/__tuning/defaults`
itself, the same endpoint the hotkey's second press calls.

## Tuning against a reference video

The loop above tunes against synthetic audio. When the target is a video
someone handed over — "make it do what this does" — the sibling loop is
`/ref` (`.claude/commands/ref.md`): `tools/ref-scan.py` measures what the
reference does on its own beat grid and writes it up, `tools/ref-hear.mjs`
records what our own analyser hears on the same audio so the write-up can say
whether the runtime can see each trigger, and `tools/ref-shoot.mjs` replays
that audio into our scene and shoots the same beats side by side. The tools'
headers own the details; nothing here restates them.

`tools/audio-latency.mjs` measures real mic-to-onset latency with a
generated click track, for the same reason: its own header owns the method.

## Recording what you learn

Whenever a session resolves a natural-language phrase ("brighter", "less
frantic") into a concrete param change, append one line to `tuning/VOCAB.md` in
its documented format. That file is the only record of what your own words have
meant in the past — without it, every tuning session starts translating from
scratch.
