# Moiré 2 (`moire2`)

Three line gratings, each at a slowly drifting angle and spatial frequency
driven by a band group (low/mid/high), interfering into a hard-edged op-art
field. Beat frequencies emerge and sweep across the frame as the mix of
bands changes. A draft on main (in `DRAFT_SCENE_IDS`); `moire` is the newer Moiré build that replaced it under that name.

## Where the code is

- `src/render/scenes/moire2.card.ts` — the card, loaded with the page: id,
  name and the `gallery` record; `loadBody` imports the body.
- `src/render/scenes/moire2.ts` — the body (the scene module), loaded after
  first paint, exporting `moire2Scene`, built on
`createFullscreenScene` with no extra settings, uniforms or JS-side state —
the whole scene is one fragment shader. `grating()` draws a single hard-edged
band field from an angle and frequency; `bandAvg()` samples `sampleBands`
across a band range and averages it. Three gratings (`g1`/`g2`/`g3`), one per
band group, are multiplied together and coloured through the shared palette
uniforms (`uPalA`..`uPalD`). No dedicated test file.

## References

None — original design; not built from a measured reference the way `moire`
was.

## Decisions and pivots

- 2026-08-27: shipped in the initial commit as the repo's original Moiré
  scene, then under the id `moire`.
- 2026-09-18: `src/render/scenes/moire.ts` was rebuilt from a measured
  reference (see `moire`'s own record) and took the `moire` id; this file
  was renamed to `moire2.ts` / "Moiré 2" and kept unchanged otherwise (PR
  #104).
- 2026-10-24: Id, name and gallery record moved to `src/render/scenes/moire2.card.ts`, so the scene's code loads after the page's first paint. Nothing visible changed. (#536)
- 2026-10-30, #804: The colour phase moves with Level, which now reads audio v6's Loudness
  (the song's loudness on a fixed decibel scale), not the band mean.
  - tune-real on a real song (around-the-world) then silence, before →
    after: at full level change median 14.88 → 15.41, p95 17.84 → 18.88 on
    the song, median 3.47 → 3.45, p95 4.25 → 4.28 in silence; hits a minute
    400 → 402 on the song, 0 → 0 in silence; with the song 20 dB down change
    median 14.98 → 15.26, p95 17.82 → 18.57 on the song, median 3.48 → 3.47,
    p95 4.35 → 4.2 in silence; hits a minute 414 → 392 on the song, 0 → 0 in
    silence.

## Tuning notes

Unchanged since the initial commit; no tuning session recorded against it.

## Known issues and next steps

No open follow-ups recorded. It remains the cheapest of the Moiré-family
scenes to draw and is kept mainly for comparison against the newer `moire`.

## Materials

- Nothing beyond the code: no `/ref` bundle, saved scripts or artifacts.

## Resume here

`npm run dev`, then `/?audio=synthetic&bpm=120#/v/moire2`.

## History

- `5fe4b3c` (2026-08-27) — shipped in the initial commit, originally under
  the id `moire`.
- `#104` (2026-09-18, merged) — renamed to `moire2` / "Moiré 2" when
  `moire.ts` was rebuilt from a measured reference and took the `moire` id;
  otherwise unchanged.
