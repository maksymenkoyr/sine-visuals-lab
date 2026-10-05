# Sweep (`sweep`)

A shape swept along a curve, stamped as a trail of copies from where it
started to where its head is now. Each copy is coloured a step further along
an iridescent palette, outlined, and the oldest copies are blurred and faded,
all on a light ground. Draft scene.

## Where the code is

- `src/render/scenes/sweep/pieces.ts`: the pure model. `RECIPES` (one per
  measured piece of the reel), `rollPiece`, the head's eased motion
  (`headOf`), `stepSweep`, and `packPiece` into the shader's `uSw` array.
  Pinned by `tests/sweep.test.ts`.
- `src/render/scenes/sweep/glsl.ts`: the per-pixel front-to-back composite of
  every copy of every path.
- `src/render/scenes/sweep/index.ts`: settings and drives into `stepSweep`.

## References

- "Colorem" by Fabio Catapano (u/fcatapano), r/creativecoding, studied as
  inspiration:
  https://www.reddit.com/r/creativecoding/comments/rn2yty/behance_featured_my_generative_series_colorem/
  A silent 20 s reel (720×720, 30 fps). Bundle `colorem`.

## Measurements (2026-10-05)

- The reel cuts to a new piece every 2.000 s exactly (bundle `series.tsv`
  `act` spikes at 2, 4 … 18 s). The CUTS finding saw only 7 cuts, because the
  histogram detector misses cuts between light grounds. The audio is silent
  (−91 dB), so no sync can be measured.
- Per piece, `docs/scenes/sweep/scripts/measure_pieces.py`: grounds from
  `#d7dfec` to `#e4e4e4`, plus `#b6c1cc` (Rings) and `#c8c6e8`. Objects take
  0.04–0.27 of the frame (Haze 0.97). Moving heads travel about 0.13
  half-heights/s. Contours shows 10 stripes over 1.62 half-heights. The
  palettes in `RECIPES` are its k-means colours.
- GPU per 1080p frame, `tools/gpu-bench.mjs`, each recipe pinned: 0.9–3.4 ms.
  Haze cost 17 ms at 40 copies and 3.4 ms at 10, against caustics at 4.2 ms
  in the same run.

## Decisions and pivots

- 2026-10-05, user's picks: all the sweep pieces (the mosaic and the
  contour-band pieces were left out), a new piece on each phrase, head speed
  from energy, and the name Sweep.
- Sync hypotheses, all from a silent reel, so none was measured:
  - pieces cut on a fixed timer, which ours maps to a phrase. New piece is
    driven by the 2-bar grid, with ticks counted in JS, because `beatGrid.ts`
    has no phrase stop. A phrase start isn't aligned to the downbeat (no
    downbeat detector).
  - motion within a piece is continuous: ours moves the head by Speed × its
    drive level, with no floor.
- Speed defaults to All level (`anim.energy`), which reads mic hiss. Move it
  to Level (`feature.level`) once draft #368 merges.

## Materials

- `docs/scenes/sweep/scripts/measure_pieces.py`: the per-piece measurer.

## Resume here

- Not yet done: `ref-keep.py colorem sweep`, `ref-archive.py colorem`, a
  `/tune` pass on real music, and Smear still reads as a ball with a shadow
  next to the reel's two-lobe figure.
