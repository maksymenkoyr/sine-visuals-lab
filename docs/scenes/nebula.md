# Nebula (`nebula`)

A slow flight through a glowing gas cloud: violet, blue and magenta masses
whose edges burn white-blue with a red-orange fringe, fine veins inside
them, and dark voids full of stars ahead. The music brightens the cloud
(Glow), flares its edges white on hits (Flare) and speeds the flight up as a
section builds (Surge); in silence it only drifts, and its colours wander
round the wheel over most of an hour. In development.

## Where the code is

- `src/render/scenes/nebula/card.ts` — the scene's card, loaded with the page: id, name,
  `SETTINGS`, the `gallery` record and `loadBody`. The body spreads the card, so the
  registered settings are the body's own objects.
- `src/render/scenes/nebula/index.ts` — the body: the rest of the scene, loaded after first
  paint. The three draws (gas, scale-up with glare, stars), `GAS_HEIGHT` per quality preset,
  and the flight constants (`BASE_SPEED`, `SURGE_GAIN`).
- `src/render/scenes/nebula/volume.ts` — `bakeVolume`: the gas as a
  tileable 3D texture, baked on the GPU once per mount (gas, detail and two
  warp channels).
- `src/render/scenes/nebula/glsl.ts` — `GAS_BODY`, the raymarch (edge band,
  inner shells and veins integrated per step, edge emphasis, the tunnel,
  hue-keeping tone map) and `OUT_BODY`, the scale-up with glare. The band,
  shell, tunnel and colour constants sit at the top.
- `src/render/scenes/nebula/flight.ts` — the camera on the JS side: the
  weaving path (`PATH_X`, `PATH_Y`, tunnel radius `PATH_R`), the roll
  (`ROLL`), the colour wander (`HUE_WANDER`) and the repeats every sampled
  field shares (`PERIOD`, `PERIOD_Z`). Nothing that grows reaches the GPU
  (noiseHash.ts's header says why).
- `src/render/scenes/nebula/stars.ts` — the stars as GL points: a field,
  Plummer clusters and a disk band; power-law brightness that falls with
  distance; pale blackbody tints; halo and spikes on the bright ones; and
  gas that dims and reddens them up to the depth the gas pass leaves in its
  alpha.
- `tests/nebulaFlight.test.ts` — bounded uniforms, an orthonormal view, no
  jump at the camera's wrap, deterministic stars.
- Drives (src/render/drives.ts): `glow` on `anim.energy`, `flare` on
  `anim.lowOnset` (read as a level in GLSL), `surge` on
  `anim.sectionIntensity` (read in JS through `drives.value`).

## References

- "Electric Space 4K Screensaver: Glowing Violet Filament Drift" —
  https://youtu.be/hKckckhpbYY (a 2-hour silent Blender render, no
  chapters; the uploader describes procedural volumetric shaders and
  particle stars). Studied for the look (rim colour order, glow, how much
  of the frame is lit, hues, stars), the motion (a weaving fly-through
  that rolls back and forth) and the slow colour wander over the two hours.
  The video is silent by design, so it says nothing about sync: every
  reaction here is this scene's own design. The picture is independent
  work; nothing of the render was used beyond the measured numbers.
  `/ref` bundles: `violet-filament` (60–100 s, first PR) and `violet-loop`
  (0–200 s, the whole loop, second attempt).

## Measurements

2026-10-21, `violet-filament` (60–100 s of the video), first PR, reference
vs ours.

- Audio: silent (`NO USABLE AUDIO`); no hard cuts at 30 fps in 40 s; the two
  STROBE lines are false: brightness held 0.21–0.22 through both.
- Motion (report): zoom +0.005 log-scale/s mean; rotation −0.6 to −1.6°/s
  (clockwise) per regime; radial flow ∝ r^0.45–1.23 at 0.04–0.05
  half-heights/s at r 0.5 (a flat zoom, not a tunnel); 63–73% of elongated
  objects lie along the radius.
- Picture (report): glow e-fold 7–13 px at 720p; lit 9–11.5% of pixels;
  ground `#1a0d26`–`#231135`; lit hues magenta 300° 43–74%, violet 270°
  24–53%, rose 330° up to 25%.
- Frame statistics (`scripts/stats.py`, 640×360): reference frames luma
  0.18–0.23, p50 0.11–0.17, p90 0.37–0.47, >0.6 1.2–4.4%, saturation
  0.54–0.61, lit hue 270–278°. First PR at rest: luma 0.17–0.20, p90
  0.34–0.37, lit hue 253–259°.
- `tools/tune-real.mjs` (Levitating, 30 s from 4 s, first PR): song change
  median 4.39 / p95 6.96, 352 hits/min; silence 0.91 / 1.15, 0 hits.

2026-10-24, `violet-loop` (0–200 s) and the whole video, second attempt.

- The flight is an exact 200 s loop: a frame's gradient map correlates
  0.995 with the frame 200, 400 and 600 s later (`scripts/loop.py period`).
  The first scan's 40 s window saw a fifth of it.
- The colour grade wanders the whole wheel over the two hours, back and
  forth, never stepping: lit hue 267° at 0 s, 3° at 600, 211° at 1200, 142°
  at 2280, 2° at 2760, 290° at 3600, 0° at 4560, 66° at 6000, 287° at 7080
  (`scripts/loop.py hue`, one frame every 2 min). Every 10 min the geometry
  is the same frame in a different colour.
- No lens split: the shift that best aligns the red channel's edges to the
  blue's is 0 px in every tile of two full-resolution frames (`scripts/ca.py`,
  correlation 0.6–1.0). The red-orange fringe is a colour band of the gas.
  At 4× zoom a rim runs, from the void inward: dark maroon, red, orange,
  white, blue, violet.
- Camera, per 10 s of the loop (`series.tsv`): zoom −0.035 to +0.036
  log-scale/s (in and out), roll −1.2 to +2.75°/s, brightness 0.13–0.27
  (lowest at 130–160 s, crossing open space). 67–76% of elongated objects
  lie along the radius in every regime.
- 20–26 s carry the channel's animated SUBSCRIBE button; most of the scan's
  "transitions" from 17 to 26 s are that overlay, and its three STROBE lines
  are false like the first scan's.
- Motion, frame-to-frame correlation at fixed lags (`scripts/lagcorr.py`,
  160×90 grey; ours from a real-time recording at rest):

  | lag | 0.25 s | 0.5 s | 1 s | 2 s | 4 s | 8 s |
  |---|---|---|---|---|---|---|
  | reference (4 × 50 s of the loop) | 0.96–0.97 | 0.90–0.92 | 0.77–0.83 | 0.56–0.66 | 0.33–0.46 | 0.15–0.25 |
  | ours | 0.95 | 0.88 | 0.75 | 0.62 | 0.47 | 0.30 |

- Frame statistics at the same six phrase beats (ref-shoot, 8–48 s, ours at
  rest; `scripts/stats.py`): reference luma 0.19–0.24, p50 0.16–0.20, p90
  0.36–0.50, >0.6 0.8–5.4%, saturation 0.60–0.65, lit hue 270–280°; ours
  luma 0.16–0.23, p50 0.11–0.17, p90 0.34–0.51, >0.6 2.0–6.4%, saturation
  0.65–0.68, lit hue 262–275°. Over 20 frames of the whole loop the
  reference spans luma 0.15–0.25 and p90 0.33–0.49.
- Hue shares of lit pixels (luma > 0.21, `scripts/hues.py`): reference, 7
  frames of the loop, violet 39–62%, blue 17–30%, magenta 16–21%, rose
  4–14%, red 1–8%; ours at the six beats violet 48–79%, blue 1–40%, magenta
  8–16%, rose 1–4%, red 0–2%.
- `tools/tune-real.mjs` (Levitating, 30 s from 4 s, on main's audio engine
  v5):

  | source | change med | change p95 | hits/min | energy | fps |
  |---|---|---|---|---|---|
  | song | 4.88 | 6.64 | 324 | 0.66 | 112 |
  | silence | 1.83 | 2.75 | 0 | 0.00 | 112 |

  The silence row is the designed flight, now at the reference's measured
  pace; the song moves the picture 2.4× more at p95.
- GPU, `tools/gpu-bench.mjs` at 3024×1890 on the M1 Pro (high): 9.3 ms a
  frame, against Caustics 7.7 ms in the same run. The first full-resolution
  march measured 112 ms; stars searched per pixel cost 8.5 ms, as points
  0.4 ms.

2026-10-24, realistic stars (same day, after the volume merged).

- GPU, `tools/gpu-bench.mjs` at 3024×1890 on the M1 Pro, main then this
  change in the same session: Nebula 13.36 → 13.62 ms, inside the noise
  (Caustics moved 12.48 → 10.08 ms between the same two runs; the machine
  was loaded, hence both above the earlier 9.3 ms).
- `tools/tune-real.mjs` (Levitating, 30 s from 4 s):

  | source | change med | change p95 | hits/min | energy | fps |
  |---|---|---|---|---|---|
  | song | 4.63 | 6.32 | 246 | 0.66 | 113 |
  | silence | 1.76 | 2.59 | 0 | 0.00 | 115 |

  Song over silence at p95 stays 2.4×: the stars don't react, and the
  reactions are unchanged.
- First paint JS: output.html and tv.html each grew about 1.7 kB gzipped,
  since every scene loads eagerly; their budgets went up 1 kB each.

2026-10-25, a sharper scale-up (the owner: "a bit blurry").

- `tools/gpu-bench.mjs` at 3024×1890 on the M1 Pro (high), median of three
  interleaved rounds, by the gas target's height: 540 (high's) 9.3–10 ms,
  720 16 ms, 900 24 ms, 1080 33 ms. The march's cost follows its pixel
  count.
- Sharpness as mean luma gradient over two fixed bench frames (90, 240):
  bilinear at 540 1.53 / 1.65; Catmull-Rom at 540 1.61 / 1.73; bilinear at
  720 1.61 / 1.74; Catmull-Rom with the glare off at 1080 1.86 / 2.00;
  Catmull-Rom plus unsharp 0.5 at 540 1.82 / 1.96; unsharp 1.0 2.05 / 2.20
  (grainy). Mean luma moved under 0.1%.
- Cost of the chosen scale-up, same bench, interleaved: 9.27 → 9.89 ms;
  Caustics 7.65 ms in both.

2026-10-25, a leaner march.

- A stats frame: 73% of the march's steps lie wholly in empty space (about
  35 of a pixel's 48 on average), and no pixel reaches the step cap. The
  march is bound by arithmetic, not by its texture reads.
- `tools/gpu-bench.mjs` at 3024×1890 on the M1 Pro (high), prototype on a
  quiet machine: 8.99–9.10 → 4.21–4.24 ms (skipping void steps alone 5.76,
  the exp-form tanh alone 6.61–6.67); Caustics 7.62 ms throughout. This
  build against main, loaded machine, two interleaved rounds: 16.62 / 15.44
  → 8.14 / 8.50 ms, Caustics 11.8–15.9 ms.
- Bench frames 30 and 150 against main: 122 and 373 of 5.7 M pixels differ,
  by at most 2/255.
- Tried and dropped, no gain: skipping the detail read in empty space,
  ending rays at a lower transmittance, skipping the tunnel's exp far from
  its axis. A per-frame table for the tunnel path saved 0.3 ms and moved
  pixels by up to 9/255.
- `tools/tune-real.mjs` (Levitating, 30 s from 4 s):

  | source | change med | change p95 | hits/min | energy | fps |
  |---|---|---|---|---|---|
  | song | 4.81 | 6.51 | 330 | 0.66 | 119 |
  | silence | 1.89 | 2.79 | 0 | 0.00 | 119 |

  Song over silence at p95 2.3×, as before: the look and the reactions are
  unchanged.

## Decisions and pivots

- 2026-10-21 — Sync hypotheses from the scan: no trigger at all (silent
  reference); continuous drift only; no cuts; no strobes. So the reactions
  were designed, and the owner chose them from a proposal: loudness → Glow,
  hits → Flare, sections → Surge.
- 2026-10-21 — Stacked noise planes instead of a raymarched volume: the
  reference measured as a flat zoom, and planes give the parallax at a
  fraction of the GPU cost.
- 2026-10-21 — Rims tried as `fwidth`-sized iso-lines: read as a
  topographic map and speckled on the high octaves. Replaced by a rim width
  that grows with the plane's scale.
- 2026-10-24 — Second attempt, asked for by the owner ("one more try"):
  the planes read as flat glowing sheets where the reference has volumetric
  masses. Kept the id, the record and the owner's reactions; replaced the
  picture with a raymarch through a baked, tileable 3D noise texture, where
  the gas glows only in a band around one density. Rims, inner folds and
  necks come from rays grazing that band, the way a lit shell looks.
- 2026-10-24 — Sync hypotheses held from the whole-loop scan: still no
  trigger; the camera's weave and roll are continuous; the colour wander is
  a timer, not a section response. The reactions stay the owner's design.
- 2026-10-24 — Point samples of the thin band drew wood-grain contours; each
  step now integrates the band from the density at both ends (erf), which
  also lets steps stay long. The same integral lights the inner shells and
  the veins.
- 2026-10-24 — Full-resolution marching cost 112 ms at Retina size: the gas
  now marches into a target capped per quality preset and is scaled up with
  a mip-chain glare; stars moved from a per-pixel search to GL points.
- 2026-10-24 — The gas is stretched along the flight by giving z a longer
  repeat than x and y. A first version stretched the sample coordinate
  instead, which broke the repeat the camera wraps by; every sampled field
  now repeats a whole number of times per period.
- 2026-10-24 — A smooth shell's limb brightening left bodies as bright as
  their rims ("glassy"). Edge emphasis scales the band by how slowly the
  ray crosses it, a deliberate non-physical step toward the reference's
  rim-over-body contrast.
- 2026-10-24 — The tunnel of open space around the camera's path fades with
  distance, so the vanishing point holds distant clouds instead of an empty
  hole.
- 2026-10-24 — Colour drift is on by default at the reference's measured
  pace, starting from violet on every mount. My call, not yet confirmed by
  the owner.
- 2026-10-24 — Id, name, settings and gallery record moved to `src/render/scenes/nebula/card.ts`, so the scene's code loads after the page's first paint. Nothing visible changed. (#536)
- 2026-10-24 — The owner found the stars fake: every core clipped to white
  at one size, brightness spanned only 4× with the dimmest draw the
  brightest, one blue-white tint, an even scatter, and a hard cut behind
  gas. Four fixes were compared live side by side
  (https://claude.ai/artifact/GHxEyV9p1VWhAyyQkVvXqn); the owner picked all
  four together, bloom at 0.6, and a more physical clustering model if one
  exists. Built: brightness drawn from N(>L) ∝ L^-3/2 and dimmed as 1/d²;
  pale blackbody tints; the core capped at white with the rest going to a
  halo and four faint spikes (`BLOOM`); Plummer-profile clusters sized by
  the dN/dM ∝ M^-2 cluster mass function, an exponential disk band and a
  uniform field; gas optical depth that climbs to the opaque depth and
  takes blue first. The Stars setting now cuts on a draw of its own, so
  raising it fills the field at every brightness.
- 2026-10-24 — On the linear brightness most of the field fell below
  visibility at 720p and the voids read emptier than before; cores are now
  drawn on a stretched curve (`CORE_GAMMA`, `CORE_GAIN`), as astrophotos
  are, while halo and spikes stay linear.

- 2026-10-25 — The owner found the cloud a bit blurry. The gas target was
  stretched to the screen with bilinear filtering; raising its height buys
  little sharpness for a lot of GPU, since most of the softness is in the
  gas itself. Chosen: a Catmull-Rom scale-up plus an unsharp step against
  the target's first mip (`SHARPEN`), for 0.6 ms. Turning the glare off
  dimmed the picture more than it sharpened it, so it stays.
- 2026-10-25 — The march skips the light and absorption of a step whose
  both ends lie in empty space, and branches each erf to its clamp outside
  its range; both are exact. Metal's built-in tanh was a quarter of the
  march, so the erf spells it out through exp. Together they halve the
  scene's GPU time.

## Tuning notes

- Judge the look at rest (ref-shoot on the silent bundle) against the
  reference first, then on a real song; synthetic kicks keep Flare firing.
- Matched statistics hid a worse picture twice (milky bodies, then glassy
  ones): compare side by side, then check the numbers.
- Gas sets how much of the view is cloud; Roll how far the view swings;
  Colour turn rotates every colour about the grey axis (0 is the
  reference's violet); Colour drift sets how fast the wander runs.

## Known issues and next steps

- Hue varies by region more than the reference's does: blue takes 1–40% of
  the lit pixels per beat against its 17–30%, so some stretches read all
  violet.
- Bodies sit a little darker and glassier than the reference's busy,
  streaky masses (p50 0.11–0.17 against 0.16–0.20).
- The flight opens on the same stretch of gas on every mount.
- No `auto` weight tables yet; every setting is manual.
- The gas itself stays soft: a march at the screen's full height is only a
  little crisper than the sharpened scale-up. Finer detail would have to
  come from the volume (`VOLUME_SIZE`, the detail read), not the target.
- About 0.55× Caustics' GPU time at Retina size on high; lower presets
  shrink the gas target and the step count.
- The first frame stalls on the volume bake (about 10 ms) and, most likely,
  the gas shader compiling; pre-warming the program is untried.

## Materials

- `nebula/violet-filament/` and `nebula/violet-loop/` — the `/ref` reports,
  their data and our ref-shoot frames, kept with `tools/ref-keep.py`
  (`violet-filament` holds the first PR's frames).
- `nebula/scripts/`: `rest.mjs` (the scene with a wav as the mic, chrome
  hidden; `--video` for a real-time recording), `lagcorr.py` (motion as
  correlation at fixed lags), `stats.py` (luma, saturation, lit hue),
  `hues.py` (hue shares of lit pixels), `loop.py` (loop period and colour
  over the video), `ca.py` (lens-split test), `pair.py` (reference over
  ours tiles), `shot.mjs` (synthetic-audio screenshots, first PR).
- The reference video, frames and comparison sheets: the local `/ref` cache
  and the private archive (`tools/ref-archive.py violet-filament
  violet-loop`).

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/nebula`.
- Side by side at rest: `node tools/ref-shoot.mjs tools/.cache/refs/violet-loop --scene nebula --port P --min-rank 16 --max-beats 6 --size 1280x720`,
  then `scripts/stats.py` and `scripts/hues.py` on its frames.
- Motion: `node docs/scenes/nebula/scripts/rest.mjs <prefix> --port P --wav tools/.cache/refs/violet-loop/audio.wav --video 24`,
  then `scripts/lagcorr.py video` on the recording.
- `node tools/gpu-bench.mjs --port P --scenes nebula,caustics --w 3024 --h 1890` for cost; `node tools/tune-real.mjs nebula --wav <song.wav> --port P` for song vs silence.
- Homebrew ffmpeg needs `DYLD_LIBRARY_PATH=/opt/homebrew/Cellar/x265/4.2/lib`;
  through `uv run` that only works as ffmpeg/ffprobe wrapper scripts on `PATH`.
- A sampler named after a setting's uniform (`uGas`) fails to compile.

## History

- First PR (#651, 2026-10-21, closed unmerged): the scene as stacked noise
  planes, its record and the flight test.
- Second attempt (#681, 2026-10-24): the raymarched volume, measured
  against the whole 200 s loop.
- Realistic stars (#684, 2026-10-24).
- A sharper scale-up (#701, 2026-10-25).
- A leaner march (2026-10-25): half the GPU time, same picture.
