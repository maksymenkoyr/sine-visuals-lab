# LED Hearts (`ledhearts`)

Draft. Glowing magenta hearts on a wall of round LEDs, zooming out from the
centre forever. Most hearts face the viewer and rock; a few turn all the way
round and show violet edge-on. Near hearts swell, soften to dim red and fade.
The music speeds the zoom and lifts the glow with its level, kicks push the
zoom, hits set the hearts spinning, and a drop sends a wave of light out from
the centre. First pass, not on main yet: it sits in this PR.

## Where the code is

- `src/render/scenes/ledhearts/index.ts`: the scene module. `SETTINGS` holds
  the dials, grouped Form / Motion / Look; `extraUniforms` reads the three hit
  drivers and the Level rush value every frame, adds up the zoom (`zoomLog`)
  and the spin clock, and hands each layer's scale, seed and fades to the
  shader. `onInit` starts it all over on a mount.
- `src/render/scenes/ledhearts/motion.ts`: the pure part. `layerAt` turns the
  zoom into the layers (how they wrap and fade, in its header), `wrapSpin`
  keeps the spin clock small without a visible jump, `decay` the envelopes.
- `src/render/scenes/ledhearts/glsl.ts`: `FRAG`. `layerLight` draws one
  lattice of hearts (`sdHeart`, the 2×2 lookup, spin, colours, the drop
  wave); `main` samples it at each LED's centre for the dots and at the pixel
  for the haze.
- `tests/ledheartsMotion.test.ts`: no pop at a layer wrap, a new seed per
  wrap, the layer spacing, seed range, and the spin wrap.
- Plugs into: the drive engine (`src/render/drives.ts`; Kick push, Hit spin
  and Drop wave are hit drivers, so `tests/hitDrivers.test.ts` covers them),
  and `src/render/noiseHash.ts` (`hash2Cell` on integer cells, with the
  layer seed wrapped in `motion.ts`).

## References

"Flying Black and Purple Y2k Neon LED Lights Heart Background || 1 Hour
Looped HD" by the YouTube channel Gradient and Colour,
https://youtu.be/-TaRL--y9Xc, studied 2026-10-21 at 30–60 s with `/ref` as
bundle `-TaRL--y9Xc` (kept here as `yt-TaRL--y9Xc`, see Materials). Studied
as inspiration for the look: the LED dot wall, the heart field, the flat
zoom, the spin, the fading near hearts. The scene is an independent design,
and the video's audio is silent, so every reaction is ours. The media stays
in the local cache and the private archive and never enters this repo.

## Measurements

Dated 2026-10-21. The scan's lit-object numbers count single LED dots on
this picture (thousands of tiny "blobs", a flat size law, flow near 0), so
the heart numbers come from the purpose-built `hearts.py` and `chains.py`
(Materials), at 60 fps full resolution.

Reference:

- Audio silent (−91 dB flat). The video is an exact 6.000 s loop: frame 360
  differs from frame 0 by 1.76 against a 32.7 median.
- No hard cuts at 30 fps. The scan's 20 "transitions" fall off the beat with
  no onset, four per loop: near hearts fading. A timer.
- LED grid fixed to the screen: pitch 6.67 px at 720 px tall (108 rows);
  lit dots fill 31% of a lit heart (a round dot of 0.63 pitch); gap 0.25 vs
  dot 0.76; glow e-fold 12–14 px.
- Hearts: about 59 per frame; size in half-heights p10 0.07, p50 0.16,
  p90 0.44, largest about 1.0. Bigger is brighter (0.20 → 0.31) and softer.
- Colour: magenta about 304° for nearly all lit area, rose about 9%, violet
  on edge-on hearts; ground `#0f030e`.
- Motion: a flat zoom out from the centre, radial speed / r ≈ 0.30/s for
  every size band (the scan: +0.335 log-scale/s); no global rotation.
  Hearts turn about their vertical axis, mostly near face-on (width / height
  0.82–0.97).

Reference vs ours, at the same moments (`ref-shoot`, silent, the
`tools/.cache/refs/<bundle>/` compare plus a blur-and-label pass on both at
960×540), final pass:

| | ref | ours |
|---|---|---|
| mean brightness | 0.158 | 0.146 |
| p95 brightness | 0.505 | 0.480 |
| lit share | 0.345 | 0.342 |
| dark share | 0.25 | 0.29 |
| dot contrast | 0.36 | 0.43 |
| heart size p50 / p90 (half-heights) | 0.146 / 0.51 | 0.139 / 0.43 |
| hearts per frame | 53 | 71 |
| zoom (log-scale/s, at rest) | 0.30–0.335 | 0.32 (`BASE_ZOOM`) |

`tools/tune-real.mjs` (Levitating, then silence; 30 s from 4 s):

| source | change med | change p95 | hits/min | energy |
|---|---|---|---|---|
| song | 19.57 | 23.14 | 352 | 0.66 |
| silence | 7.92 | 9.19 | 0 | 0.00 |

Song p95 is 2.5× silence; the silence row is the zoom and spin the scene
has by design.

## Decisions and pivots

- 2026-10-21, sync hypotheses from the silent reference: zoom, spin and the
  near-heart fades run on a timer (no onset under any transition), and
  nothing cuts. So there was nothing to copy for sync; the owner accepted the proposed
  reactions: zoom speed rides the level, a kick pushes the zoom, hits spin
  the hearts, the level lifts the glow, a drop sends a wave out.
- 2026-10-21, drawn as a field of light sampled through a screen-fixed LED
  grid rather than hearts built from dots: the reference's dots stay put
  while hearts slide under them.
- 2026-10-21, a flat zoom of stacked lattices (`motion.ts`), not a 3D fly-
  through: the reference's radial speed per distance is the same for small
  and big hearts, which parallax would not give.
- 2026-10-21, first comparison had no black (dark share 0.02 vs 0.25), too
  many hearts, and every heart spinning (long violet streaks). Fixed by a
  darker ground, fewer hearts, softer edges with a brighter centre, and
  making most hearts rock while only a share (`SPIN_SHARE`) turn fully.

## Tuning notes

- Hearts, Haze and the ground decide the dark share; check it beside the
  reference, since it is half of the look.
- Level rush stacks on Zoom speed; on a loud track the zoom runs about 1.4×
  its rest speed before kicks. Turn Level rush down for calmer music.
- Hit spin defaults to Mid hit (snares, claps) so it alternates with the
  kick's push instead of landing on the same beat.

## Known issues and next steps

- The drop wave was not seen in a capture yet: Levitating's 30 s window may
  not hold a detected drop. Check it on a track with a clear drop.
- Ours has more, smaller hearts than the reference (71 vs 53 per frame,
  p90 size 0.43 vs 0.51); the smallest layer could thin further.
- No auto weight tables yet: every setting is manual.

## Materials

- `ledhearts/yt-TaRL--y9Xc/`: our half of the `/ref` bundle, saved with
  `tools/ref-keep.py` — `report.md`, `audio.json`, `series.tsv`, our shots
  (`ours-ledhearts/`), and `hearts-measured.md` with the scripts behind it
  (`hearts.py`, `chains.py`; run on frames pulled with ffmpeg). The scan's
  `look.json` was left out: 6 MB of single-LED detections that describe the
  dots, not the hearts.
- The reference media (video, frames, bursts, sheets, comparison images):
  the local cache `tools/.cache/refs/-TaRL--y9Xc/` and the private archive
  (`tools/ref-archive.py`), never this repo.

## Resume here

- `npm run dev`, then `https://localhost:<port>/?audio=synthetic&bpm=120#/v/ledhearts`.
- Compare: `node tools/ref-shoot.mjs tools/.cache/refs/-TaRL--y9Xc --scene ledhearts --port <port> --max-beats 6`.
- Real audio: `node tools/tune-real.mjs ledhearts --wav tools/.cache/tempo-tracks/levitating/audio.wav --port <port>`.
- Gotchas: Homebrew ffmpeg needs `DYLD_LIBRARY_PATH` pointed at the old x265
  keg, and yt-dlp left the streams unmerged (join them with `ffmpeg -c copy`).
  The bundle name starts with `-`, so pass `--` before it to `ref-keep.py`.

## History

- #654: first pass (draft).
