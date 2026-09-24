# Kaleidoscope (`kaleidoscope`)

A mirror-tiled lattice of mandalas, each carrying a ring of smaller
mandalas that are whole copies of itself (children all the way down), with
a camera that continuously zooms into one child forever. Four selectable
styles — Mandala, Portal, Prism, Burst — reframe what's painted inside each
mandala's cell while sharing the same fold/recursion/zoom machinery. Draft
scene, merged to main across two PRs (#79, #83).

## Where the code is

- `src/render/scenes/kaleido/index.ts` — the `Scene` (via
  `createFullscreenScene("kaleidoscope", "Kaleidoscope", FRAG, …)`), the
  `SETTINGS` table (`style` as the scene's `variant`; `symmetry`, `spread`/
  `rings` (Nesting), `spectrum`, `bass`, `morph`, `flow`, `zoom`, `pulse`,
  `ease`, `spin`, `breathe`, `twist`, `ink`, `tint`), and the JS-side phase
  accumulators (flow/morph/spin/zoom, `advanceBeatSurge`). `main()`'s
  per-pixel recursive descent — the camera transform `T_t` is the
  continuous power of the similarity mapping a parent mandala onto its top
  child, taken about that map's fixed point, so the fixed point stays put
  on screen while the parent slides off and the child grows into its
  place; because a child *is* the parent, the picture at a cycle's end is
  the picture at its start one level deeper, and `uZoomPos` just keeps
  counting. The parent's own parent is drawn too (the root frame) so the
  surroundings at a cycle's end match the surroundings at its start.
- `src/render/scenes/kaleido/glsl.ts` — `KALEIDO_COMMON_GLSL`: the fold,
  petal profile, value noise/fbm including the scale-cycling zoom noise
  (`zfbm`), and the posterised palette read shared by every style.
- `src/render/scenes/kaleido/styles.ts` — one GLSL function per style
  (`MANDALA_GLSL`, `PORTAL_GLSL`, `PRISM_GLSL`, `BURST_GLSL`,
  `STYLE_NAMES`), each handed the same frame (cell coordinates, cell size,
  beat-swelled radius, raw angle, fold count, pixel size, palette base) and
  returning a colour. The tiling rule every style must respect: depend only
  on radius and a *folded* angle, and mask any rotation to zero before
  radius reaches the cell edge.
- `tests/kaleidoscope.test.ts` — pins the beat-surge shape (attack/release,
  `ease` not changing total displacement) and other pure pieces.
- Shared systems: `src/render/gridPulse.ts`'s Beat grid (the per-scene
  Hits/1-8/1-4/1-2/1-bar/2-bar picker row in the Rhythm card, shipped in
  PR #79 as a feature every scene benefits from — `createPickerRow` moved
  to `controlsKit.ts` for it); `SceneSetting.variant` +
  `variantDefaults`/`settingDefault` (shipped in PR #83 for `style`) — every
  non-`style` setting keeps its own value/auto-state/default per style, so
  tuning one style never disturbs another.

## References

Four YouTube shorts, one per style, sorted by a single rule: anything that
is still "fold the plane, build a field of the folded angle, band it"
became a style here; two further Mandelbrot/Julia zoom references were set
aside for a separate, unbuilt Fractal scene (different pipeline — a deep
zoom or Julia morph at float precision, not a fold).

- **Mandala** — studied from "Kaleidoscope Visuals" (video id `IHRMKsTh0Sk`):
  nested hard-edged contour bands flowing outward, petals morphing between
  round lobes, zigzag stars and pointed drops.
- **Portal** — studied from video id `CPu8pZPClww`: a disc of densely
  petalled, nested-contour annuli drifting outward; measured as silent (no
  audio track in the source).
- **Prism** — studied from video id `XDNSvjOIxQA`: a hexagonal-lattice
  mirror kaleidoscope of stepped rainbow stripes.
- **Burst** — studied from video id `Lj4Ae4T3XP0`: a Voronoi-like field of
  radial crystal shards rushing outward from a dark jagged star core, with
  chromatic streaks.

No `tools/.cache/refs/` bundle exists for these — they were scanned before
that bundle/report.md workflow existed; frames and shot scripts from the
sessions that built this scene are not part of the repo.

## Measurements

Log-polar frame registration against librosa onsets, run against all four
reference shorts (2026-09-04/05, pre-dating the current `/ref` bundle
tooling): every short zooms in continuously (Prism at roughly half a log
unit per second, Burst at about a seventh of that); Prism's zoom kicks on
every beat; brightness tracks loudness and pops per beat in every short
that has audio; the Portal short has no audio track at all (an early
`yt-dlp` download without `+ba` had dropped it from the other shorts too,
and had to be re-fetched).

## Decisions and pivots

- **PR #79 (2026-09-05), original scene:** a square mirror-tiled lattice of
  mandalas, each drawn as nested hard-edged contour bands (a concentric
  ramp plus ring families from a radial-cosine envelope times a folded-angle
  petal profile), quantised into bands and read through the room palette
  with alternating warm/cool cycles. `symmetry` steps by 2 so a mandala
  mirrors across its own axes for free. Audio: spectrum shapes ring
  amplitude bass-in/treble-out, bass stretches inner petals, section drops
  flip warm/cool, centroid drifts tint; the beat is a damped-velocity push
  plus an attack–release swell (`advanceBeatSurge`), not a snap — an
  earlier version jumped the phase on every beat and read as a redraw.
  Also shipped: the Beat grid Rhythm-card row, generalized from this
  scene's own need for it.
- **fwidth is wrong on a fold's mirror lines**, found while building #79:
  the neighbouring pixel across a mirror line is the mirror image, so a
  screen-space derivative reads near zero there, dotting every fold seam.
  An analytic upper bound over-read and greyed out the centre instead. The
  fix: carry exact `dF/dr` and `dF/dangle` alongside `F` and use
  `|grad F| * pixelSize` for both ink antialiasing and the moiré fade — the
  noise-based styles still use `fwidth` for their ink lines, where the
  under-read only costs a pixel of antialiasing, not a seam.
- **PR #83 (2026-09-05, stacked on #79), several rounds in one PR:**
  1. Moved the scene into the `kaleido/` folder split (`index.ts`/`glsl.ts`/
     `styles.ts`); gave Mandala gaussian rosette rings beside the cosine
     ones, an eight-fold corner motif, Bar breathe (petals split once per
     bar under tempo lock), Spin (alternate rings counter-rotate, masked to
     zero before the cell edge so rotation never meets a mirror), Twist (a
     mirror-safe shear along the folded angle); added Portal/Prism/Burst as
     new `style` options from three of the five additional references,
     following the fold-vs-different-pipeline split rule above.
  2. Added a Surge ease slider (how long a beat's push/swell takes, ~100ms
     snap to ~600ms roll) — displacement per beat stays constant across the
     range, only timing changes.
  3. Shipped `SceneSetting.variant` + `variantDefaults`/`settingDefault` as
     general scene-settings architecture, `style` as its first user.
  4. The first Portal/Prism/Burst pass was rejected as not good enough —
     rebuilt from the log-polar/onset measurement above: Portal became big
     ornate petals with nested contours and lace rings; Prism a
     hexagonal-lattice mirror of stepped rainbow stripes; Burst a Voronoi
     field of radial crystal shards with chromatic streaks around a jagged
     dark star core. Added a `zoom` slider/accumulator and routed the beat
     surge into it for the texture styles, plus a brightness lift on the
     swell everywhere; each style redesigned to dive in coordinates where
     its own zoom is exact (Mandala's ramp went logarithmic, Portal's
     annuli log-spaced, Prism's stripes log spirals with a scale-cycling
     noise warp `zfbm`, Burst log-polar).
  5. Motion inside a cell (bands/rings/stripes drifting) didn't read as
     zoom — a zoom needed to be the lattice itself scaling. Fix: the cell
     grows from the Nesting (then still called Tiling) size to the size
     whose core covers the screen; each mandala's core is a window onto the
     lattice one level down, opening only once a level's cell exceeds the
     Nesting size; three levels drawn per pixel for a seamless infinite
     dive. Every style moved to cell-relative units for this (Mandala had
     used absolute radii); in-cell motion stayed on Flow, camera motion on
     Zoom, so the two wouldn't double up.
  6. That lattice-with-windows zoom still didn't read as the intended
     "recursive progression." Final design: the framing became fully
     recursive — every mandala carries a ring of smaller mandalas, each a
     whole copy of it, children all the way down; `main()` descends per
     pixel to the deepest mandala it belongs to and paints that one's body,
     so a pixel costs one style evaluation regardless of depth. The zoom
     became the continuous power of the similarity mapping a parent onto
     its top child, about that map's fixed point (see "Where the code is").
     Nesting (renamed from Tiling) now sets child size; Symmetry also sets
     how many children sit on a ring. The flat lattice and its hexagonal
     variant were removed entirely. Landed after three prior sketched
     "zoom" meanings had each been rejected in turn.
- Palette pitfall found along the way: the room palette's cosine ramp runs
  blue at `t≈0.33`, not where an unbiased guess (something greener) would
  put it — worth checking before hand-tuning a hue-cycle phase in this
  scene's palette usage.

## Tuning notes

- `style` is the scene's `variant` — every other setting (except `style`
  and `twist`, both pure framing choices with no auto weights) keeps a
  separate value/auto-state/default per style; a dev `setParams` override
  on a non-variant setting only applies if read through the variant
  resolver, or it silently fails to switch a style's profile.
- Seam-check any Mandala/Portal change at low `symmetry`/Nesting with `spin`
  at a nonzero value — that combination is what originally exposed tiling
  seams during PR #83's verification.
- `ease` changes only how long a beat's push/swell takes, never how far the
  material moves — the displacement per beat is constant across the slider,
  which `tests/kaleidoscope.test.ts` pins.
- Judge the recursive zoom by whether the dive reads as continuous through
  a full cycle wrap (child becoming parent), not by a single frame — three
  earlier "zoom" implementations each looked plausible in a still and were
  rejected once seen live.

## Known issues and next steps

- The two Mandelbrot/Julia zoom references were deliberately set aside for
  a planned, unbuilt Fractal scene (a Julia morph rather than a deep zoom,
  at float precision) — not part of this scene and not started.
- No `tools/.cache/refs/` bundle exists for any of the four style
  references; a rescan with the current `/ref` tooling (bundle + report.md)
  has not been done for this scene, unlike the later `/ref`-built scenes.

## Materials

- `kaleidoscope/scripts/` — the session scripts used to screenshot, probe or measure the scene, rescued from working sessions; each header says what it's for and how to run it, and they may need adjusting to the current code.

## Resume here

- Dev link: `npm run dev`, then `/?audio=synthetic&bpm=120#/v/kaleidoscope`.
- Style-specific dev links: append `&style=<Mandala|Portal|Prism|Burst>`
  logic goes through the variant `setParams` path — verify against the
  variant resolver, not a raw setting override, or the profile won't switch.
- `npm run typecheck` and `npm run test` (covers `tests/kaleidoscope.test.ts`
  plus the scene-wide settings/signals/variants tests, and
  `tests/gridPulse.test.ts` for the Beat grid) both need to pass before
  calling a change done.
- Gotcha for any fold-symmetric or tiled shader in this codebase: don't
  trust `fwidth`/screen-space derivatives near a fold's mirror lines —
  carry an analytic gradient instead, as `main()` does for the ink/moiré
  antialiasing here.

## History

- `#79` / `202a2e0` — Add Kaleidoscope: mirror-tiled contour-band mandalas
  (draft scene), plus the Beat grid Rhythm-card row. Merged 2026-09-05.
- `#83` / `72038e2` — Kaleidoscope: four styles (Mandala, Portal, Prism,
  Burst). Merged 2026-09-05, stacked on #79; squashed commit carries seven
  sub-commits: the four-style split, a Surge ease slider, the
  `SceneSetting.variant` architecture, the Portal/Prism/Burst rebuild with
  a zoom accumulator, the lattice-window zoom, and finally the recursive
  mandala-of-mandalas zoom that shipped.
