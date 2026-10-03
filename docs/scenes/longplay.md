# Long Play (`longplay`)

One long scene made of many "views", after a VJ set: each view is a looped
neon look on black (a strobing square tunnel, a ring-pulsing reactor HUD, an
edge-lit sea, …), and Auto change mixes from one to the next every few
minutes on a phrase start. Hits launch squares or rings out of the centre and
flash the picture; a glitch layer blinks parts of it off on its own timer.
Some views are Pro content and locked outside a dev build. Draft, not yet on
main.

## Where the code is

- `src/render/scenes/longplay/index.ts` — the scene: `VIEWS` (the view list,
  in tour order, with each view's `pro` flag), `LONGPLAY_SETTINGS`, the
  per-frame shared state (launch pool, phrase count, flicker mask, strobe),
  and the render that draws one child program per view and blends the next
  one over it during a mix. The header has the sync mapping.
- `src/render/scenes/longplay/tour.ts` — which view shows and when it mixes:
  a pure state machine (`stepTour`, `nextOpenView`, `mixWeight`).
- `src/render/scenes/longplay/glsl.ts` — what every view shares: the uniforms
  index.ts uploads, pixel-sized `stroke`/`glow`, `layerOn` for the flicker
  mask, `fbm`, and `viewFragBody`, which wraps a view in a `main()` applying
  the onset flash and strobe by the view's own `FLASH_W`/`STROBE_W`.
- `src/render/scenes/longplay/views/*.ts` — one file per view, each exporting
  `vec3 viewColor(vec2 p)` in half-height units, with its measured numbers in
  its header.
- `src/render/pro.ts` — the one Pro switch (`proUnlocked`,
  `setProUnlocked`); `SceneSetting.proOptions` and `isProLocked` in
  `src/render/sceneSettings.ts` are the lock, and `createPickerRow`'s
  `pro`/`locked` (`src/ui/controlsKit.ts`) draw it.
- `tests/longplay.test.ts` — the tour and the Pro lock.
- Drives: Launch and Flash both default to the onset (`feature.onset`).

## References

- **Altum, "Techno Mix (2022) with 4K Visuals ft. Emily Compton [Altum
  006]"** — https://youtu.be/kMJVNerOtRI, a 90-minute techno set with
  continuous VJ visuals (no uploader chapters). Studied as inspiration for the
  idea of one long scene of many looped views, and measured for each view's
  geometry, palette, stroke and timing. The filmed-footage views (crowd
  silhouettes, a robot face, statues) and the channel's logo were not used.
  Bundles, one per window, in `tools/.cache/refs/`:
  - `alt-tunnel` 6:20 +40 s — the red square tunnel (Tunnel);
  - `alt-hud` 74:30 +40 s and `alt-hudblue` 84:00 — the reactor HUD (Reactor);
  - `alt-ocean` 36:30 — the edge-lit sea (Ocean);
  - `alt-bloom` 32:05 — the red-core paint bloom (Bloom);
  - `alt-ink` 9:20, `alt-wings` 35:00, `alt-terrain` 41:20, `alt-kaleido`
    44:00, `alt-chip` 51:10, `alt-circuit` 54:30, `alt-earth` 57:20,
    `alt-rings` 62:00 — candidate Pro views, measured but not built yet;
  - `alt-x-kaleido` 43:20 +50 s — across a view change (terrain → kaleido).
  A 15-second contact survey of the whole set and a whole-set cadence
  measurement (`scripts/survey.py`, `scripts/cadence.py`) chose the windows.

## Measurements

2026-10-03, `/ref` on kMJVNerOtRI (reference at 129.2 bpm throughout):

- **View changes vs track changes (whole set, `cadence.py`)**: 30 picture
  regime changes vs 40 audio novelty peaks; median distance from a view
  change to the nearest track change 43.5 s, chance 34 s; within 20 s: 9/30,
  chance 31%. Views hold 1.5–10 min.
- **View change shape (`alt-x-kaleido`)**: a mix over ~4–8 s, not a cut.
- **Phrase starts**: brightness / colour / zoom speed react most at rank-16
  beats in 9 of 14 windows (z +0.26 … +1.51).
- **Tunnel (`alt-tunnel`)**: red 0° 96–100%, black ground; strokes 6.7 px,
  glow e-fold 1.5–8.9 px; squares at r 0.17/0.47/0.75–0.84; zoom-in +1.908
  log/s; 60 hard cuts in 40 s, holds 67–5533 ms (median 300); strobe every
  0.96 beat; brightness flashes on onsets z +0.40; reference frames at −80 ms
  and +160 ms around a beat are black. Ours: onset within 60 ms of 90% of
  theirs, tempo ×1 95%.
- **Reactor (`alt-hud`)**: red 0° / rose 330°; 8-fold 0.70–0.80; rings at
  r 0.19/0.42/0.75/0.95; strokes 1.9 px (2.8 px outer); 95 hard cuts in 40 s
  (median hold 67 ms); brightness flashes on onsets z +0.32 within a frame.
  Ours: onset 89%, tempo ×1 73%.
- **Ocean (`alt-ocean`)**: blue 240° 71–81%, violet, azure; strokes 1.9 px,
  glow e-fold 2.1–2.4 px; 533 of 580 lit objects bars; 2-fold 0.74–0.87;
  flow 0.07 half-heights/s, mixed; no hard cuts, no onset flash; zoom speed
  z +0.88 and colour z +1.35 at phrase starts. Ours: onset 99%, tempo ×1 98%.
- **Bloom (`alt-bloom`)**: magenta 300° / rose 330° with a red core; strokes
  1.9 and 6.7 px; glow e-fold ~12 px; 63 hard cuts in 40 s (median 333 ms);
  activity flashes on onsets z +0.47; paint ring grows centre → edge in ~5 s
  (slit-scan). Ours: onset 88%, tempo ×1 82%.
- **Our analyser over all 14 windows**: onsets within 60 ms of 87–99% of the
  reference's; tempo held ×1 in most windows but ≈173 bpm (×4/3) on wings,
  earth and rings; `section` showed no rise near any audio section boundary.

## Decisions and pivots

- 2026-10-03 — The user asked for "one long scene with multiple views", 2–3
  free and the rest Pro. Decisions (asked before building): name Long Play;
  free views Tunnel, Reactor, Ocean; Pro views **locked now** — not
  selectable outside a dev build until a subscription exists; Auto change =
  timer + phrase-aligned mix.
- Sync hypotheses, and how they held:
  1. View changes are a timer (cadence above), mixed over two bars from our
     16-beat count — built as Hold + `tour.ts`. Our count has no downbeat, so
     the phrase phase is arbitrary (to-do in `beatClock.ts`).
  2. Within-view changes on phrase starts — `uPhrase`/`uPhraseN`/`uPhraseAge`
     from the same 16-beat count (Ocean surges and turns hue, Bloom's ring
     blooms once per phrase).
  3. The glitch layer is a timer (median holds 67–333 ms) — Flicker's random
     holds; strobe runs one flash per beat for a bar after a phrase start.
  4. Onset flashes only where measured — per-view `FLASH_W`.
- Pivot (same day, from `ref-shoot` at the same beats): Tunnel first drew a
  steady picture; the reference exists only in a ~one-frame flash per beat,
  so Tunnel became flash-gated — each hit lights every square in flight at
  its current size.
- Pivot: Reactor first kept rings in flight all the time; the reference
  swings between sparse (gear only) and bursts, so about one hit in three is
  a burst (rings + salmon band + arrows), the rest one thin ring.
- Pivot: Ocean was first a strong-perspective wireframe — wrong kind of
  picture (an edge-filtered sea of horizontal strands); it became anisotropic
  contour strokes over wide bright patches, mild perspective, not mirrored.
- "View" is not a `variant`: Auto change plays a view with the settings on
  screen, and a variant would hand it another view's tuning profile; the
  settings are shared instead.
- Bloom shipped in the first PR as the first Pro view so the lock can be seen
  working (dim PRO chip on a build, selectable in dev).

## Tuning notes

- Flicker 0.5 is the reference's glitch density; 0 shows every layer.
- Launch drives everything that leaves the centre (Tunnel squares, Reactor
  rings and bursts, Bloom squares); turn it to 0 for a calm look.
- Judge Tunnel at the beat, not between beats — it is meant to be black
  between flashes.

## Known issues and next steps

- Pro views still to build from the measured bundles: Wings, Circuit, Chip,
  Acid (rings + digit grid), Marble, Star (build on Kaleidoscope's fold
  code — extend, don't duplicate), Earth, Ink.
- Reactor's colour range is narrower than the reference's (no blue side
  blobs, weaker orange arrows); a blue Reactor (`alt-hudblue`) could be a
  palette option or its own Pro view.
- Ocean is a little more lavender than the reference's 240° blue.
- No phrase phase in the runtime (`beatClock.ts`), and the tempo tracker
  slips to ×4/3 on some tracks (`src/audio/`) — both shift when phrase
  reactions land.
- Picking the same View chip again while Auto change has moved on does
  nothing (the pick didn't change); pick another and back.
- When Pro exists, `setProUnlocked(true)` is the only switch to flip.

## Materials

- `longplay/alt-tunnel/`, `longplay/alt-hud/`, `longplay/alt-ocean/`,
  `longplay/alt-bloom/` — our half of each bundle (report, data, our shots),
  saved with `tools/ref-keep.py`.
- `longplay/scripts/` — `survey.py` (contact sheets of a long video every N
  seconds), `cadence.py` (view-change vs track-change cadence), `digest.py`
  (Findings + picture lines of many bundles at once), `shot.mjs` (headless
  shots per view), `tour.mjs` (Auto change check), `panel.mjs` (the View
  row's chips and the Pro lock).
- The reference media and the other bundles: the local `/ref` cache only.

## Resume here

- `npm run dev`, then the printed Long Play link (`/#/v/longplay`).
- `node docs/scenes/longplay/scripts/shot.mjs <outPrefix> --port P --views 0,1,2,3`
  for a sheet per view; `node tools/ref-shoot.mjs tools/.cache/refs/alt-hud
  --scene longplay --port P --settings '{"view":1,"auto":0}'` to compare.
- Gotchas: Homebrew ffmpeg on this machine needs the old x265 on
  `DYLD_FALLBACK_LIBRARY_PATH` (SIP strips it through `/bin/bash` — use
  wrapper scripts); run `ref-scan` one at a time (≈470 MB each, and parallel
  runs corrupted numba's cache — `NUMBA_CACHE_DIR`); close stdin for ffmpeg
  inside `while read` loops; from a worktree, `--report-only` and
  `ref-keep.py` need the cache reachable from the worktree.
- Backticks inside a GLSL comment end the JS template string.

## History

- 2026-10-03 — first draft: tour, Pro lock, Tunnel, Reactor, Ocean, Bloom
  (this PR).
