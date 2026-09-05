# Tuning loop

This is "the plan" that `src/tuning/probe.ts`'s header comment refers to — it
didn't exist before this doc. It's the live-tuning workflow used to dial in
per-scene defaults and `auto` weights against real (or reproducible synthetic)
audio, without reloading the page or stopping playback.

Everything here is dev-only. `src/tuning/overrides.ts` is gated on
`import.meta.env.DEV`, so none of it compiles into a production build, and it can
never clobber a real user's saved settings (`sceneSettings.ts`'s localStorage
store) — overrides sit in front of that store, not inside it. `src/tuning/pins.ts`
is the same idea with one difference: a pin is set by hand, from the panel's own
typed-entry field (below), not by the param bus, and it persists across a
reload where an override doesn't. `resolve()` (`src/render/autoTune.ts`) checks
an override first, then a pin, then auto-pin, so a value the param bus explicitly
sets always wins over a pin left over from an earlier by-hand session.

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

   The controls panel is a second, by-hand entry point into the same idea: any
   scene-setting or Input-card row's readout is a click-to-edit field. Type a
   value inside the slider's range and it's just the setting, saved like a drag.
   Type one outside that range and it becomes a pin instead (`src/tuning/pins.ts`)
   — unclamped, marked with `*`, persisted, and cleared by dragging the slider,
   pressing its ↺, or handing the row to auto.
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
   shader), and `mode` (`ProbeSettingValue["mode"]` — override/pin/auto/manual).
   Its own stated principle, worth keeping: *answer with numbers, not pixels* —
   read the probe before trusting your eyes on whether a change landed. Drive it
   headlessly with `tools/tune-probe.mjs`.
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
reference does on its own beat grid and writes it up, `tools/ref-shoot.mjs`
replays the reference's audio into our scene and shoots the same beats side
by side. Both tools' headers own the details; nothing here restates them.

## Recording what you learn

Whenever a session resolves a natural-language phrase ("brighter", "less
frantic") into a concrete param change, append one line to `tuning/VOCAB.md` in
its documented format. That file is the only record of what your own words have
meant in the past — without it, every tuning session starts translating from
scratch.
