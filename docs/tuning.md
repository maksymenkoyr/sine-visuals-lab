# Tuning loop

This is "the plan" that `src/tuning/probe.ts`'s header comment refers to — it
didn't exist before this doc. It's the live-tuning workflow used to dial in
per-scene defaults and `auto` weights against real (or reproducible synthetic)
audio, without reloading the page or stopping playback.

Everything here is dev-only. `src/tuning/overrides.ts` is gated on
`import.meta.env.DEV`, so none of it compiles into a production build, and it can
never clobber a real user's saved settings (`sceneSettings.ts`'s localStorage
store) — overrides sit in front of that store, not inside it.

## Reproducibility

Tune against synthetic audio so a result is comparable across sessions:

```
https://localhost:5173/#/v/<sceneId>?audio=synthetic&bpm=<bpm>
```

`src/audio/synthetic.ts` is the feed this drives. Real music is still the final
check — synthetic audio is for comparing runs, not for judging how a scene feels.

## The loop

1. **Param bus.** Edit `tuning/params.json`. `vite-tuning-plugin.ts` (dev-only
   Vite plugin) watches it, rebroadcasts it over Vite's HMR socket as event
   `viz:params`, and serves `GET /__tuning/params` for a client that connects
   after the edit. `src/tuning/bus.ts` applies the payload to the override layer
   on the next frame. Audio keeps playing; nothing reloads.
2. **Mark.** Alt+M (wired in `src/tuning/debug.ts`) captures one frame plus a
   probe snapshot and POSTs it to `/__tuning/mark`; the plugin writes
   `tuning/marks/<timestamp>.png` and `<timestamp>.json` (both gitignored — marks
   are working scratch, not committed artifacts).
3. **Numeric probe.** `src/tuning/probe.ts` builds a compact per-frame snapshot:
   each setting's `base` (plain default), `resolved` (what actually reached the
   shader), and `mode` (`"override" | "auto" | "manual"`). Its own stated
   principle, worth keeping: *answer with numbers, not pixels* — read the probe
   before trusting your eyes on whether a change landed. Drive it headlessly with
   `tools/tune-probe.mjs`.
4. **Contact sheet.** `tools/tune-sheet.mjs` (backed by `src/tuning/capture.ts`)
   tiles N frames into one PNG — `--frames`, `--every`, `--settle` control the
   sampling. Use this to see a setting's effect across a stretch of audio at a
   glance, instead of scrubbing frame by frame.
5. **A/B.** `tools/tune-ab.mjs` runs two param sets in parallel pages against the
   same synthetic-audio timecode, for a direct side-by-side.

## The debug surface

`window.__viz` (wired from `src/app.ts`, DEV-only) exposes `probe()`, `probeText()`,
`capture()`, `mark()`, `setParams()` — the same primitives the CLI tools above
drive headlessly, available from the browser console for quick checks.

## Recording what you learn

Whenever a session resolves a natural-language phrase ("brighter", "less
frantic") into a concrete param change, append one line to `tuning/VOCAB.md` in
its documented format. That file is the only record of what your own words have
meant in the past — without it, every tuning session starts translating from
scratch.
