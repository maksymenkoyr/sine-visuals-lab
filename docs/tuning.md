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

Tune against synthetic audio so a result is comparable across sessions, and add
`&tune=<slot>` to open the page as a tuning session:

```
https://localhost:5173/?audio=synthetic&bpm=<bpm>&tune=A#/v/<sceneId>
```

The query goes *before* the hash: `src/app.ts` reads options through
`router.ts`'s `parseOptions`, which prefers the real query string. A
hash-carried query is also accepted, but it's the ambiguous form — prefer the
one above.

`src/audio/synthetic.ts` is the feed this drives. Real music is still the final
check — synthetic audio is for comparing runs, not for judging how a scene feels.

## Sessions run in slots

`?tune=<slot>` (see `src/tuning/session.ts`) scopes a session's param file, its
marks, and — in dev — its device id. Two windows on different slots don't
interfere, so one can keep being driven by hand while a tool drives the other.
The default slot keeps `tuning/params.json`; any other gets
`tuning/params.<slot>.json`.

Without `?tune=`, a page is not a tuning session: the device menu keeps writing
saved settings the way it does for a user, and no draft rows appear.

## The loop

1. **Param bus.** Edit `tuning/params.json`. `vite-tuning-plugin.ts` (dev-only
   Vite plugin) watches it, rebroadcasts it over Vite's HMR socket as event
   `viz:params`, and serves `GET /__tuning/params` for a client that connects
   after the edit. `src/tuning/bus.ts` applies the payload to the override layer
   on the next frame. Audio keeps playing; nothing reloads.
2. **Point and scrub.** A `focus` list in the params file names the settings
   under discussion, each with the phrase that prompted it. `src/tuning/focus.ts`
   holds them; the device menu (already generic over each scene's
   `SceneSetting[]`) rings those rows, prints the phrase, dims the rest and
   scrolls to the first. You move the dial — which is the half a conversation
   can't do — and the value routes to the override layer rather than your saved
   settings, then POSTs back to the params file. Run `tools/tune-watch.mjs` to
   see each landed value as a `TUNED` line.
3. **Mark.** Alt+M (wired in `src/tuning/debug.ts`) captures one frame plus a
   probe snapshot and POSTs it to `/__tuning/mark`; the plugin writes
   `tuning/marks/<slot>-<timestamp>.png` and `.json` (both gitignored — marks
   are working scratch, not committed artifacts).
4. **Numeric probe.** `src/tuning/probe.ts` builds a compact per-frame snapshot:
   each setting's `base` (plain default), `resolved` (what actually reached the
   shader), and `mode` (`"override" | "auto" | "manual"`). Its own stated
   principle, worth keeping: *answer with numbers, not pixels* — read the probe
   before trusting your eyes on whether a change landed. Drive it headlessly with
   `tools/tune-probe.mjs`.
5. **Contact sheet.** `tools/tune-sheet.mjs` (backed by `src/tuning/capture.ts`)
   tiles N frames into one PNG — `--frames`, `--every`, `--settle` control the
   sampling. Use this to see a setting's effect across a stretch of audio at a
   glance, instead of scrubbing frame by frame.
6. **A/B.** `tools/tune-ab.mjs` runs two param sets in parallel pages against the
   same synthetic-audio timecode, for a direct side-by-side.

## When the number isn't a dial yet

Most of what shapes a look isn't a `SceneSetting` — it's a constant in a
scene's shader or JS, often interpolated straight into the shader source, so
every trial value costs a rebuild. Promoting one is cheap because the plumbing
is generated: add an entry to the scene's settings array and reference its
`u<Key>` uniform, and `fullscreenScene.ts` declares and uploads it while the
device menu renders the row. Nothing else has to know it exists.

So the loop is **promote → scrub → keep, draft, or bake**:

- **Promote** the constant so it gets a slider. Mark it `draft: true`
  (`SceneSetting.draft`) — it then renders only in a tuning session, under its
  own collapsed "Dev" section, and persists to a dev-only store rather than to
  a user's saved settings.
- **Scrub** it with the visualization in front of you.
- **Keep** it (drop the flag, give it a real label, description and `auto`
  weights), leave it a **draft**, or **bake** the value back into a constant
  and delete the entry.

Deciding after you've felt the parameter is the point. Keeping is the one that
costs: every kept setting is a permanent uniform and a permanent row in the
user's menu, so it should be deliberate rather than the default outcome of
having tuned something. `/wrap` asks about each promotion for that reason.

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
