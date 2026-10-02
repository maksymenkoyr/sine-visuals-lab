# Riso (`riso`)

A simulated risograph print: flat geometric blobs sized by band groups,
laid down as two halftone ink screens (different angles) over paper grain,
with `uBeatPulse` briefly jolting the two screens out of registration the
way a poorly-aligned riso print shifts on press. The header comment is
explicit about the intent: "a printed poster, not a demo." Small, original
scene; a draft (in `DRAFT_SCENE_IDS`), on `main` since the initial commit.

## Where the code is

- `src/render/scenes/riso.ts` — one fragment shader body (`FRAG`) passed to
  `createFullscreenScene()`. No `settings`, no `extraUniforms`, no
  per-scene helper module.
- `shapeField(p)` unions a fixed small set of band-sized blobs into one
  scalar field. `halftone(screenUv, value, angleDeg, scale)` turns a scalar
  into a rotated dot-grid ink screen. Two calls to `halftone()` at
  different angles and small beat-driven offsets (`offA`/`offB`) are
  composited over a paper-grain base color.
- The halftone grid is computed from `screenUv` (raw `vUv` scaled by
  resolution), not `roomUv()` — deliberately, per the header comment: the
  ink stays physically fixed to the display while the artwork (built from
  `roomUv()`-based `p`) spans the shared room-space canvas. Any edit that
  moves ink registration needs to respect that split.
- Uses `sampleBands()` for the blobs' sizes and the room palette's first
  two inks (`uPalInk[0]`, `uPalInk[1]` — `src/render/palette.ts`) for the
  two ink colours.
- No dedicated test file.

## References

None — original design (a simulated print process, not a studied video).

## Decisions and pivots

- 2026-08-27 (`5fe4b3c`, initial commit) — scene added. No further history
  on `main` — this is the one scene of the five in this record set that
  `4b8d342`'s quality/tier rename didn't touch (it references neither
  `uQuality` nor `minTier`).
- 2026-10-02 — review fix: the beat "out of register" shake was
  `uBeatPulse * 0.006` added to `screenUv`, which is already in halftone-cell
  units, so it moved the dot grid by 0.006 of a cell (a fraction of a pixel)
  and the misregistration the header promises never showed. It now shifts
  each ink's artwork (`shapeField(p + off)`) by 0.012 in `p`, 0.6 % of the
  short side, which is the 0.006-of-the-short-side the old constant was
  aiming at, with the dot grids still fixed to the display. Off the beat
  (`uBeatPulse` = 0) the picture is identical to before.
- 2026-10-02 — the inks come from the room palette's `inks` role instead of
  `palette(0.15)` and `palette(0.65)`. Those two points on the cosine curve
  landed on a dark colour in most palettes (Sunset's 0.65 is a near-black
  maroon), and the scene multiplies each ink over the paper, so the print
  went to rust or mud. Every palette now promises inks that are readable and
  distinct (`tests/palette.test.ts`), so the overprint stays bright. Under
  Neon the picture changes from a magenta-over-green overprint to pink over
  blue.

## Tuning notes

No `SceneSetting`s — every knob is a shader literal: the blob count/sizing
in `shapeField` (fixed at 6 blobs, radius `0.12 + band * 0.32`), the two
halftone screen angles (`15.0`, `75.0` degrees) and their relative ink
strength (`v` vs. `v * 0.75 + 0.12`), the misregistration gain on
`uBeatPulse` (`* 0.006`), and the paper grain amount. Judge the look by
whether the halftone dots read as print (crisp, evenly rotated grids) at
normal viewing distance rather than moiré noise, and whether the
beat-driven misregistration reads as a print-press jolt (brief, snappy)
rather than a constant jitter.

## Known issues and next steps

None recorded — no open PR or issue references this scene
beyond its creation.

## Materials

- Nothing beyond the code: no `/ref` bundle, saved scripts or artifacts.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/riso` (query before the
  hash).
- No settings and no test file — tuning means editing the shader literals
  directly and reloading. If retuning the ink registration, remember the
  screen-vs-room UV split noted above.

## History

- `5fe4b3c` (2026-08-27) — initial commit adds the scene; unchanged since.
