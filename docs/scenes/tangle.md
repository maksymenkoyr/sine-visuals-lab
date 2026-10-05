# Tangle (`tangle`)

A sphere of thin white light that a noise field folds, within a second or
two, into long straight chords and triangles meeting in flaring white knots,
with a colour fringe on whatever moves. A bass hit pulls the lines part of
the way back out toward a crinkled sphere and they fold up again; a drop
brings back the whole sphere; the mids speed up how the shape drifts. Draft;
on its own branch, not yet on main.

## Where the code is

- `src/render/scenes/tangle/index.ts` is the scene: `SETTINGS`, the drive
  reads (`drives.fired`/`drives.value` for Re-inflate and Reset on drop,
  `drives.value` for Drift), the fixed-step warp loop (`STEP_DT`,
  `MAX_STEPS_PER_FRAME`), the crinkle envelope (`CRINKLE_TAU`,
  `CRINKLE_PER_PULL`), and the passes in order: sim, segments into the
  history ring (`RING_SLOTS`), line glow, flares, composite. Its header says
  the model and the sync mapping.
- `src/render/scenes/tangle/glsl.ts` holds the programs: `SIM_FRAG` (one
  warp step: a hand-made bilinear tap of the position texture at uv + noise,
  continued across the poles, then the pull home), `SEG_VERT`/`SEG_FRAG`
  (one capsule per pair of neighbouring texels), `KNOT_VERT`/`KNOT_FRAG`
  (the flare density), `GLOW_SRC_FRAG`, `BLUR_FRAG` (with a knee),
  `COMPOSITE_FRAG`.
- `src/render/scenes/tangle/core.ts` is pure: `SIDE_BY_PRESET`, `pickSlot`
  (which history frame a delayed colour channel reads), the `Glide` that
  spreads a pull home over several steps, `cameraRotation`.
  `tests/tangle.test.ts` covers it.
- Plugs into: drives (`src/render/drives.ts`), the integer noise hash and
  `wrapFlow` (`src/render/noiseHash.ts`) for the drifting noise, the
  quality preset for the texture side (`src/render/quality.ts`). Position
  state is 16 bits an axis in RGBA8 pairs, packed as powder.ts packs its own.

## References

- "3D noise feedback", r/creativecoding, by u/codex992 —
  <https://www.reddit.com/r/creativecoding/comments/1m1dnck/3d_noise_feedback/>
  (video `v.redd.it/kkzfb00xu8df1`, 720×720, 30 fps, 15.1 s, **no audio
  track**). Studied as inspiration: the look (a sphere of fine light lines
  collapsing into straight chords, white knots with flares, chromatic
  fringes on motion) and its timing. The author's comments name the tool and
  the idea — TouchDesigner, "noise and displace connected to feedback, then
  all to geo instancing", and an RGB delay for the colour. No project file
  or code was published or used; the mechanism here (a texture of sphere
  positions resampled through a noise offset, drawn as segments between
  neighbouring texels) was worked out from the frames and checked in our own
  numpy prototype (`tangle/scripts/proto.py`) before any GL was written.
- Measured in the `/ref` bundle `tools/.cache/refs/noise-feedback/` (whole
  clip, 0–15.1 s). Silent, so the beat grid in that report is a uniform
  placeholder and no sync was measured.

## Measurements

2026-10-05, reference (bundle `noise-feedback`, `report.md` and frames read
at full size) beside ours (headless Metal shots at 720×720 with
`tangle/scripts/shot.mjs`, `?audio=synthetic&bpm=124`, Re-inflate and Reset
on drop at 0 so it collapses undisturbed, as the silent reference does):

| What | Reference | Ours |
|---|---|---|
| Audio | none (no audio stream) | — |
| Hard cuts | none at 30 fps in 15 s | none |
| Opening sphere radius | ≈0.93 half-heights (frame 0) | 0.93 at Size 1 |
| Sphere → long straight chords | ≈1.4 s | ≈1.4 s |
| After ~3 s | near-still (11–12 s max- and mean-projection almost equal) | slow slide from Drift |
| Vertices at 11 s | ≈15–20 | ≈20 at Detail 14 |
| Stroke | 1.9 px | 1.9 px at 720 tall |
| Glow e-fold | 13.6 px | line glow sigma from it |
| Biggest flare | ≈130 px across, core about a third of that (read off frames) | core sigma 8 px, halo 30 px; every big knot flares |
| Ground | `#060607`, lum 0.027 | `#060607` |
| Saturation | 0.03 overall; colour only as fringes on motion | white; fringe only on motion |
| Rotation | mean −0.5°/s, \|rot\| 1.5°/s | Spin 0.25 ≈ 5°/s orbit |

2026-10-05, on real music (the audio of bundle `CL-893hKSzI` as the mic,
defaults, frames at 3–30 s in `tangle/noise-feedback/ours-tangle/music-*`):
bass hits keep re-crinkling it, so it stays a living, half-folded tangle
with flaring knots; long chords re-form between hits. It never settles to
the reference's sparse still state while the music plays, by design.

## Decisions and pivots

2026-10-05 (all on branch `worktree-tangle-scene`):

- **Sync hypotheses.** The reference is silent, so none could be measured;
  every trigger is ours. Its one transition (0.27 s, the sphere starting to
  fold) is the recording's own reset — off any grid, no audio — and its two
  zoom-direction flips (4 s, 12 s, +1.2σ/+1.3σ) are weak drift, ignored. The
  user picked "hits re-inflate" (bass hits pull the lines home, a drop
  resets, the mids speed the drift) over "a new tangle each bar" and "both".
  The runtime sees all three triggers (`anim.lowOnset`, `anim.dropOnset`,
  `anim.mid`); on real music they held up.
- **Mechanism first, in numpy.** The prototype showed that resampling a
  sphere's position texture at uv + noise gives exactly the reference's
  topology: patches copy one point (knots), borders hold blends that lie on
  the chord between knots, triple junctions make triangles.
- **Segments, not points.** The prototype's splatted points read grainy; a
  capsule between every pair of neighbouring texels draws a border pair as
  the whole chord, so lines are continuous and crisp at any texture side.
- **Collapse speed.** A first cut stepped at 30 Hz and took ~3 s to reach
  what the reference shows at ~1 s; 60 Hz steps match its ≈1.4 s.
- **Re-inflate default and glide.** At 0.5, a bass hit every beat of the
  synthetic feed kept it a sphere forever → 0.15. A pull applied in one step
  teleported the lines and the fringe doubled the whole picture red/cyan →
  spread over `INFLATE_STEPS`.
- **Poles.** Clamping the warp at the poles left a dark hole round the north
  pole for the first half-second → a row past a pole continues half a turn
  round on the far side.
- **Flares.** An 8-bit target clips a knot at the same white as a line. Tried
  in order: a second, scaled-down channel in the history (no visible
  flares), faint points at half and eighth res (too faint, then fog over the
  whole opening sphere), a knee before the blur (localised but soft blobs);
  kept: quarter-res points, knee, then a tight blur for the core and a wide
  blur of that for the halo.
- **Fine octave as a crinkle.** Held on, its small cells outnumbered the
  coarse ones and the tangle became a dense geodesic mesh by 11 s → the fine
  octave is an envelope set by a reset or a hit and fading over
  `CRINKLE_TAU`, so the coarse cells take over as in the reference.
- **3D drift of the positions — rejected.** Tried so knots could settle
  inside the sphere (the reference's late scribble has interior knots);
  it pulled the whole structure into one corner and shrank it.
- **Detail** went 6 → 8 → 10 → 14 to reach the reference's vertex count.

## Tuning notes

- Detail sets the knot count (cells round the sphere); Pull how fast the
  sphere folds; Wiggle the crinkle a hit or drop brings.
- Re-inflate is the balance between the reference's sparse look and a busy
  one: with a bass hit every beat, above ~0.3 it never gets to fold.
- Judge the collapse with hits off (`{"inflate":0,"reset":0}`) at the
  reference's sample times, side by side with its frames
  (`tangle/scripts/compare.py`); judge the music with a real wav, since the
  synthetic feed's bass hits are far more regular than a track's.
- Quality presets change only the texture side (`SIDE_BY_PRESET`); low and
  floor look the same, a little coarser.

## Known issues and next steps

- The reference opens with sharp sawtooth zigzags about 175 periods round
  the sphere — finer than a 256-texel texture resolves. Ours opens with
  smooth crinkles.
- The reference has one or two dominant flares; ours flare every big knot
  about evenly.
- The reference's late picture is a scribble with knots inside the sphere;
  ours keeps its knots on the sphere's skin and can read as a polyhedron
  after a long quiet stretch.
- No `auto` weight tables: Auto has nothing to act on yet (all settings
  probe `manual`).
- Not yet seen by the user on a real screen; GPU cost not measured
  (`tools/gpu-bench.mjs`): at high it draws two instanced capsules per
  texel of a 256² texture every frame.

## Materials

- `tangle/noise-feedback/` — our half of the `/ref` bundle, saved with
  `tools/ref-keep.py`: `report.md`, `audio.json`, `look.json`, `series.tsv`,
  and our own shots in `ours-tangle/` (`nohit-*` at the reference's sample
  times, `music-*` on real music).
- `tangle/scripts/proto.py` — the numpy mechanism prototype.
- `tangle/scripts/shot.mjs` — headless frames at chosen seconds (synthetic
  or a wav as the mic); used for every comparison above.
- `tangle/scripts/compare.py` — reference frames over ours at the same
  seconds; its output holds the reference's pixels and stays out of the repo.
- The reference media (video, frames, comparison sheets): the local `/ref`
  cache and the private archive (`tools/ref-archive.py`), never here.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=124#/v/tangle`.
- Re-measure: `uv run tools/ref-scan.py noise-feedback --report-only`; the
  video is `tools/.cache/refs/_downloads/noise-feedback.mp4`.
- Compare: `node docs/scenes/tangle/scripts/shot.mjs <prefix> --port <p>
  --settings '{"inflate":0,"reset":0}'`, then
  `uv run docs/scenes/tangle/scripts/compare.py out.png
  tools/.cache/refs/_downloads/noise-feedback.mp4 <prefix>`.
- Gotchas: Reddit blocks scripts — the post's `.rss` gives the comments and
  the `v.redd.it` id, the video is `DASH_720.mp4` from its
  `DASHPlaylist.mpd`. Homebrew's ffmpeg was broken (missing libx265); `uvx
  --from static-ffmpeg static_ffmpeg_paths` prints a working one. A closure
  inside `render()` over the scene's `let` programs loses TypeScript's null
  narrowing — copy them to a `const` first.

## History

- `5ba77502` — first version (WIP).
- #371 — draft PR: two-scale knot flares, the crinkle envelope, tests and
  this record.
