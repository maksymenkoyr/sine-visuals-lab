# Long Play (`longplay`)

One long scene made of many "views", after a VJ set: each view is a looped
neon look on black (a strobing square tunnel, a ring-pulsing reactor HUD, an
edge-lit sea, …), and Auto change mixes from one to the next every few
minutes on a phrase start. Hits launch squares or rings out of the centre and
flash the picture; a glitch layer blinks parts of it off on its own timer.
Some views are Pro content and locked outside a dev build. In development, on
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
- **Views not built yet** — what each measured as, and how to build it.
  "Seen" means its `look.png` was checked by eye; the others have only
  their numbers and a 15-second survey thumbnail, so open their
  `look.png` (and `slitscan.png` if motion matters) before designing.
  Every one is mirrored left/right unless noted, strokes ≈1.9 px, near-black
  ground.
  - **Wings** (`alt-wings`, seen): magenta 300° 76–90% / violet 270°;
    dense fibrous wire mesh shaped like two mirrored wings or a ribcage
    (2-fold 0.96–0.99), made of thousands of short vertical bars and dots
    (≈1 100–1 800 objects, lit 5–17% of pixels); glow e-fold 12–30 px; slow
    backward fly-through (0.06–0.25 half-heights/s). No hard cuts and no
    onset flash; brightness and colour change at phrase starts (z +0.47,
    +0.80). Build: an anisotropic noise field (stretched vertically),
    mirrored, drawn as fine contour strokes with a soft magenta halo,
    receding slowly; phrase start lifts and shifts hue. Our tempo read
    ×4/3 here.
  - **Circuit** (`alt-circuit`): blue 240° 86–99%, ground dark navy
    (`#010149`-ish, not black); a top-down circuit-board/city grid of short
    bars (729–864 bars of ≈900–1 200 objects), mirrored 2-fold 0.92–0.98,
    rings of structure at r 0.67–0.75 and 1.06–1.34; glow 9–11 px; slow
    mixed drift 0.06–0.09 half-heights/s. No hard cuts. Activity follows
    the high band (r +0.36), brightness too (r +0.27); zoom direction
    reverses on bar/phrase starts. Build: a rectilinear trace grid (cells
    with random trace segments + pads), mirrored, flying slowly with zoom
    that flips direction every phrase; `high` drives trace brightness.
  - **Chip** (`alt-chip`, seen): a CPU-die square tunnel — nested squares
    with greeble "pins" around a white-hot core; red/rose/magenta in the
    bright phase (8-fold 0.91, glow ≈30 px), dimming to small cyan 180°
    bracket shapes (4-fold) between bursts. Zooms in +1.6 log/s, 118 hard
    cuts in 40 s (median hold 67 ms); brightness and colour jump at phrase
    starts (z +1.51, +1.06). Build: Tunnel's flight math plus a die
    texture (rect greebles on the square's sides, hashed per ring), a
    bright phase on phrase starts decaying to the cyan brackets.
  - **Acid** (`alt-rings`, seen): concentric neon rings (green 120–150°,
    magenta, blue, cyan) under a full-screen grid of scrolling digits with
    horizontal scanlines; a posterised white blob at the centre; 2-fold
    0.99. No hard cuts, no onset flash, nothing tracks a band. Build: thick
    concentric bands with a hue per band, a text-grid layer of digit glyphs
    (look for an existing glyph helper in the public scenes first), scanline mask. Our onsets fired 3× the reference's here and
    tempo locked only 20% — keep it timer-driven.
  - **Marble** (`alt-terrain`): azure 210° / cyan / spring-green 150°,
    with blue/violet; a colourful edge-lit terrain texture, 8-fold in parts
    (0.75–0.82) else 2-fold 0.95; glow 2–9 px; 227 hard cuts in 40 s
    (median 67 ms — very glitchy); brightness flashes on onsets (z +0.35,
    within a frame); activity follows loudness (r +0.43). Build: a domain-
    warped fbm coloured by a multi-stop ramp, edge-detected (contours),
    optional 8-fold kaleido fold toggled per phrase.
  - **Star** (`alt-kaleido` + `alt-x-kaleido`): blue 240° / azure 210°,
    white highlights; a radial kaleidoscope star/flower, 2-fold 0.91–0.97
    with 8-fold petals; zooms out continuously (−0.53 log/s, ×1.7/s;
    −0.40 in x-kaleido); no hard cuts; zoom reverses at bar/phrase starts.
    Build on `src/render/scenes/kaleido/` (its fold and infinite-zoom
    code) rather than a copy — extend, don't duplicate.
  - **Earth** (`alt-earth`): blue 240° / azure 210°, ground navy
    (`#03002f`); a planet's limb with city lights and a sun, behind dense
    horizontal scanlines; 2-fold 0.94–1.00. No hard cuts, no onset flash;
    picture regime changed at 4/4 audio section boundaries. Build: a lit
    sphere limb (rim glow), noise-placed city-light dots on the night side,
    a sun flare, a scanline mask. Our tempo read ×4/3 here.
  - **Ink** (`alt-ink`): red 0° / orange / yellow, ground dark red
    (`#2e0000`); red ink washes with the square tunnel over them; 70 hard
    cuts in 30 s; brightness pulsed on the beat (contrast 1.51σ) and
    flashing on onsets; activity follows the low band (r +0.44). Close to
    Tunnel + Bloom's ink — likely a Tunnel option (ink wash layer driven by
    `low`) rather than its own view.
  - **Reactor Blue** (`alt-hudblue`): Reactor in cyan 180° 64–78%, 144 hard
    cuts in 40 s, brightness on phrase starts (z +0.92) — a palette option
    on Reactor, not a new view.
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

- Pro views still to build — each one's measured picture and build sketch
  is under Measurements, "Views not built yet". Suggested order: Wings,
  Circuit, Chip (straightforward), then Marble, Earth, Acid, Star (Star
  builds on Kaleidoscope's code). Ink and
  Reactor Blue are better as options on Tunnel and Reactor. Per view: add
  `views/<name>.ts` (`viewColor` + `FLASH_W`/`STROBE_W`), add it to `VIEWS`
  with `pro: true`, shoot with `scripts/shot.mjs`, compare with
  `tools/ref-shoot.mjs` against its bundle (`--settings '{"view":N,"auto":0}'`),
  keep our half with `tools/ref-keep.py <bundle> longplay`.
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
