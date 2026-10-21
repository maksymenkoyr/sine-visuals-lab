# Cosmic Cloud (`cloud`)

Saturated blue cloud on near-black: soft blobs with fine curling threads
through their edges, boiling in place, with no pan, zoom, spin or cut. With
no music it keeps churning at its resting pace. Music speeds the churn, kicks
light the whole cloud, and hits flash the threads. Draft, not yet on main.

## Where the code is

`src/render/scenes/cloud.ts`, built on `createFullscreenScene`. The picture is
a noise field (`fbmBoil`) read through two nested domain warps, plus a ridged
noise layer for the threads, weighted toward the cloud's edges. Two kinds of
motion, both computed in JS so the shader never sees a growing coordinate
(`src/render/noiseHash.ts`'s header):

- `churnOffsets`: each warp's and the threads' offset runs on a closed
  Lissajous path (`CHURN_PATHS`), bounded by its radius.
- `boilDepths`: the cloud field itself has time as a third lattice axis
  (`vnoise3`/`hash3Cell`, periodic like the other two). Each octave's depth
  is wrapped into `NOISE_PERIOD` and staggered (`BOIL_STAGGER`) so the octaves
  don't lose contrast together. `BOIL_RATE` and `BOIL_OCTAVE_GROWTH` set the
  pace.

The tone curve maps the cloud value in standard units (`CLOUD_SPREAD`) to blue
alone, fitted to the reference's percentiles, with a soft shoulder near full
brightness instead of a clip. `CLOUD_GAIN` is the cloud fbm's octave gain.
The pure helpers (`churnOffsets`, `boilDepths`, `advanceChurn`,
`advanceFlare`) are tested in `tests/cloud.test.ts`.

Settings: Form `scale`, `warp` (Curl), `filaments`; Motion `churn`, `surge`;
Look `light` (Brightness), `glow`, `flare`, `colours`. Drives (drives.ts):
`surge` ← All level (`frame.energy`), `glow` ← Bass hit (`uLowPulse`),
`flare` ← Any hit, a hit driver (`drives.fired` + `hitSize`), decaying at
`FLARE_DECAY_PER_SEC`. `colours` blends toward the room palette's ramp, the
same pattern as Echoes.

## References

- "Cosmic Cloud Blue Background Screensaver 4K | No Sound", ALIVE SCREENS on
  YouTube, https://youtu.be/bo8_Igv-Lyg. Studied 2:00–2:40 for the look and
  the motion: colour, feature size, how fast it changes, and that it changes
  in place. `/ref` bundle `tools/.cache/refs/bo8_Igv-Lyg/`. The video is
  silent by design (its title says so), so nothing about audio sync was
  taken from it. Every reaction here is our own mapping.

## Measurements

2026-10-21, reference 2:00–2:40 vs ours at rest (silence), frames at
640×360 (scripts in `cloud/scripts/`):

| | reference | ours |
|---|---|---|
| R, G channels | 0 | 0 |
| blue percentiles 5/25/50/75/95 | 0.224 / 0.338 / 0.476 / 0.654 / 0.852 | 0.202 / 0.337 / 0.492 / 0.654 / 0.844 |
| share of pixels below 0.15 blue | 0.3 % | 0 % |
| spatial autocorrelation at 8 / 32 / 64 px | 0.79 / 0.38 / 0.15 | 0.83 / 0.44 / 0.12 |
| frame-to-frame correlation at 0.5 / 1 / 2 / 3 s | 0.86 / 0.61 / 0.15 / −0.17 | 0.77 / 0.50 / 0.15 / 0.05 |
| frame-mean blue over time | 0.502 ± 0.019 | 0.502 ± 0.029 |
| frame contrast (std) over time | 0.198 ± 0.006 | 0.197 ± 0.013 |
| global shift (phase correlation, 0.5 s) | none | none by construction |

Reference only: one 8.00 s clip on repeat (self-correlation 0.98 at 240
frames; not a palindrome, 0.72), the file's seam every 16 s. Its negative
correlation at 3 s comes from that loop; ours doesn't loop. The scan's
"dark frames 100 %" is a luma artefact: pure blue carries only ~7 % of luma.

2026-10-21, `tools/tune-real.mjs cloud` (Levitating, then silence, 30 s from
4 s; change = % of full scale per 100 ms):

| source | change med | change p95 | hits/min | energy |
|---|---|---|---|---|
| song | 2.55 | 3.66 | 354 | 0.66 |
| silence | 1.28 | 1.65 | 0 | 0.00 |

Song p95 / silence p95 = 2.2×. Silence change is the designed churn. Song
frame median blue 0.58 vs 0.48 in silence.

## Decisions and pivots

- 2026-10-21: `/ref` showed a silent loop with no sync to measure, so
  reactions were the owner's to pick. Asked "build it, new or a look in an
  existing scene, what reacts?" and got "new". The reactions are my guess:
  churn speed, glow, thread flare.
- 2026-10-21: first build (strong domain warp, plain fbm) read as liquid
  marble: 29 % of pixels below 0.15 blue, features 1.4× too large, folded
  ribbon edges. Fixed by fitting the tone curve to the reference's
  percentiles, a slower-falling octave gain for the cloud, and half the
  warp (Curl 0.5 judged closest side by side, then baked in as Curl 1).
- 2026-10-21: moving only the warps left the large shapes in place
  (correlation stuck near 0.6 after 3 s). Gave the cloud field a time axis.
  Scaling that axis per octave made fine detail flicker away early, so all
  octaves now boil at one rate. Octaves crossing the half-slice point together
  made the contrast breathe (±0.018), so their depths are staggered (±0.013).
- 2026-10-21: on a real song, Glow on the bass *level* and a slow flare kept
  the whole picture lifted and clipped to flat blue. Glow now follows Bass hit
  pulses, the flare decays faster, and a soft shoulder replaces the clip.

## Tuning notes

- Judge the resting look in silence against the reference side by side
  (`ref-shoot`), and re-measure with `cloud/scripts/measure.py`: matching
  percentiles alone once hid the marbled structure.
- Curl is the setting that moves the look most. Above ~1.5 it turns back
  into marble.
- Flare on a busy song fires several times per beat; the fast decay is
  what keeps it reading as flashes.

## Known issues and next steps

- The reference has a little more crisp, crunchy fine detail in its dark
  areas; ours is softer there.
- Ours loses its likeness to itself a bit faster in the first half-second
  (0.77 vs 0.86), then matches by 2 s.
- The reactions are unconfirmed guesses; the owner may want different ones.

## Materials

- `cloud/bo8_Igv-Lyg/`: our half of the `/ref` bundle (report, data, our
  shots at the reference's beats, the half-second motion series
  `ours-cloud-t/`), saved with `tools/ref-keep.py`.
- `cloud/scripts/`: `measure.py` (blue percentiles, spatial
  autocorrelation), `tcorr.py` (frame correlation at half-second lags),
  `pulse.py` (brightness and contrast over time), `modes.mjs` (probe modes
  with Auto off and on, two BPMs).
- The reference video, frames and audio: the local `/ref` cache and the
  private archive (`tools/ref-archive.py`), never this repo.

## Resume here

- `npm run dev`, then `/#/v/cloud` (`/?audio=synthetic&bpm=120#/v/cloud` for
  a headless check).
- Side by side: `node tools/ref-shoot.mjs tools/.cache/refs/bo8_Igv-Lyg
  --scene cloud --port <p>`; motion series: add `--min-rank 1 --max-beats 24
  --out <bundle>/ours-cloud-t`, then `tcorr.py ref <bundle>/frames ours
  <bundle>/ours-cloud-t`.
- From a worktree, pass the bundle by its main-checkout path: the cache is
  per checkout.
- Homebrew ffmpeg was broken again on 2026-10-21 (libx265). The scan ran with
  static-ffmpeg binaries on PATH (`uvx --from static-ffmpeg
  static_ffmpeg_paths`), after merging yt-dlp's separate video and audio
  downloads by hand.

## History

- #653 (2026-10-21): first draft, built from `/ref` on `bo8_Igv-Lyg`.
