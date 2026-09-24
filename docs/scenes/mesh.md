# Mesh Grid (`mesh`)

A hidden-line spectrogram terrain: frequency runs across the grid (mirrored
so bass sits as a ridge down the middle), time runs into it, with the newest
spectrum frame at the front and older frames receding toward a fogged
horizon. Grid lines and dots ride the surface and light up with the music;
optional Circle/Sphere layouts fold the same grid into a disc or globe. A
draft scene (listed in `DRAFT_SCENE_IDS`), on `main`.

## Where the code is

`src/render/scenes/meshGrid.ts` (`meshGridScene`, id `mesh`) — its own header
comment is the up-to-date mechanism reference; read it before changing
anything. Exported pure helpers, each covered by `tests/meshGrid.test.ts`:
`gridDimsForQuality` (base vertex-grid resolution per quality tier),
`buildGridPositions`/`buildGridTriangles` (row-major grid geometry),
`createSpectrumHistory` (the rolling spectrum ring buffer), `historyRowFor`
(mirrors the vertex shader's history-row lookup for testing), and
`mirroredBinFor` (mirrors the shader's spectrum-bin fold). `buildGrid()`
inside the scene closure rebuilds the GPU buffers whenever Grid Density
changes.

GLSL is inlined as template strings: `CAMERA_GLSL` (camera/projection/horizon,
shared verbatim by the mesh vertex/fragment shaders and `BG_FRAG` so the
horizon line always agrees), `MESH_VERT`/`MESH_FRAG` (the terrain surface,
including the fwidth-based procedural grid lines), `BG_FRAG` (the room/dome
backdrop). Shares `COMMON_UNIFORMS_GLSL`/`ROOM_UV_GLSL`/`settingUniformName`/
`uploadCommonUniforms` from `sceneCommon.ts`, `PALETTE_GLSL` from
`palette.ts`, and resolves settings through `autoTune.ts`'s
`resolveSceneSetting`. Reads `anim.onset` (not `frame.onset` directly) for
Beat Expand, per `renderLatch.ts`'s one-tick-edge convention. `SETTINGS` uses
the `SettingGroup` vocabulary from `sceneSettings.ts` (Form/Motion/Look/
Camera/Post).

## References

None — original design.

## Decisions and pivots

- **2026-08-30, PR #22 ("Rebuild Mesh Grid as a hidden-line spectrogram
  terrain")** — an earlier Mesh Grid was replaced in #22. The rebuild kept
  the audio machinery (history texture, CPU dampening, spectral-flux
  envelope, panorama projection, settings/auto system, full-coverage BG
  pass) and replaced the visual treatment. Landed as one sequence of
  sub-commits, all under this PR:
  - Rectangular frustum-hugging grid with real perspective depth via
    `CAMERA_GLSL` (the opaque fill pass is the occluder, giving genuine
    hidden-line occlusion instead of draw-order tricks); grid lines moved
    from a separate `gl.LINES` pass into the fill fragment shader via
    `fwidth` (no MSAA on this context, so hardware lines would moiré); room
    palette + `col/(1+col)` tonemap; fill fog-mixes toward the same
    `bgColor()` the background paints, closing the seam. Settings: `bend`
    renamed to `valley` (meaning changed, so the key had to change too, or a
    reused key would clamp a user's stale pinned value), `radialMix`/
    `jaggedness` dropped, Surface Fill repurposed as the occluder's tint,
    Scan Sweep now travels in Z.
  - Camera Distance/Height/Tilt added as settings, replacing hardcoded
    `CAM_POS`/`CAM_TARGET` constants; default distance doubled so the
    terrain sits further back. Each row's half-width switched to depend on
    view-space depth so the frustum-hugging trapezoid stays edge-to-edge at
    any tilt.
  - Zoom setting added — scales the projection like a focal length
    (independent of the frustum-hugging width), so the terrain can actually
    be made to look smaller with sky visible around it.
  - Circle layout added: columns become angle, rows become radius, newest
    ring on the outside; displacement fades toward the center to keep the
    pole flat.
  - Circle squeezed into an ellipse (depth-vs-width ratio) so the near rim
    stays in frame from the default camera; Wave Height/Valley/camera/Zoom
    defaults set from a saved tuning mark for the first time.
  - Circle Squeeze exposed as its own setting, replacing a `CIRCLE_SQUEEZE`
    constant.
  - Background Mesh made actually visible (it had been added near-invisible)
    — soft per-line halo, full-sky mask, Background Mesh Intensity setting
    scaled by overall energy.
  - Background Dome (sky lattice lifted onto a sphere around the camera,
    evaluated in azimuth/elevation) and Sphere layout (grid wrapped onto a
    globe, time mirrored about the equator) added, each behind its own
    checkbox; every setting default refreshed from a new saved mark.
  - Background Dome reworked from camera-centered sphere (which read as a
    flat wall at normal zoom, masked incorrectly by screen elevation) to a
    ray-cast ball centered on the scene, dimmed inside the disc/globe's
    silhouette by `shapeCover()` so it sits behind the shape.
  - Background Dome reworked again into a placeable globe the camera sits
    outside of (Dome Distance/Dome Radius), since a ball around the camera
    can't show its own curvature — only a limb crossing reads as a sphere.
    Waves Outward added (which ring is "newest" — center-out vs rim-in),
    splitting the vertex shader's geometry parameter (`gNorm`) from its age
    parameter (`tNorm`).
  - Only one globe face drawn (near face opaque from outside, far face as a
    dome from inside) instead of both, which had read as two lattices
    fighting. Center Spike added, replacing an always-on pole fade: at 0 the
    disc's center / globe's poles stay flat, above 0 the displacement is
    boosted there into a crown of spikes (dots still always fade at the
    pole).
  - Grid Density and Dome Density sliders added (replacing a
    `gridSizeForQuality`-only sizing and a `DOME_SCALE` constant); the
    spike's crown made to glow via a `vPole` term since the grid lines fade
    exactly where they converge. Defaults moved to a steep look-down
    reference framing: closer/steeper camera at Zoom 1.4, true circle, Grid
    Density 2 (fill on, contours off), dome centered on the scene at a
    coarser Dome Density, Center Spike 1.5 — the last point Camera Tilt's
    range extended to -75 and Surface Tint's to 4.
  - Background Dome's axis unified with the disc/globe's tilt (it had been
    evaluating its lattice in world-up/down while the shape itself is
    tipped toward the viewer) by rotating the ray into the same tilted frame
    before the azimuth/elevation lookup.
  - Waveform Rings + Beat Ripple + Beat Expand added: a ring holds one value
    around its whole circumference (the frame's absolute level, eased,
    stored about a baseline of 0.5) instead of a per-band spectrum slice,
    so waves read as waves instead of noise; Beat Ripple stamped a crest on
    every beat; Beat Expand (`uBeatEnv`) swelled the whole shape through a
    new `shapeScale()` that every use of the shape's radius routes through.
  - Waveform Rings and Beat Ripple removed one commit later — real music
    barely moved `frame.level`, so nearly all visible motion was the
    identical beat impulse. Replaced with rows driven by each band's change
    against its own recent average (Wave Memory setting, soft-clipped by
    Wave Gain) — a kick moves the bass side of a ring, a hat the treble
    side, a pad nothing — since the plain per-band-AGC-normalized spectrum
    has a standing shape that repeats every frame regardless. Beat Expand's
    envelope changed to a two-stage attack/release cascade (Beat Smooth) so
    it breathes instead of snapping. Defaults reset to a clean baseline:
    Sphere centered in a Background Dome sized to surround it, Flowing Noise
    at 0 (motion should come from the music), Valley 0, Center Spike 0, Dots
    at half, a coarser dome lattice — this is close to what ships today.
- **2026-08-30, PR #55** — unrelated cleanup that happened to touch this
  file: `frame.beat` swapped for `anim.onset` (one line) so Beat Expand
  doesn't drop under the render-rate cap; see `renderLatch.ts`.
- **2026-09-03, PR #69** — unrelated cleanup: `SETTINGS[].group` strings
  regrouped onto the shared `SettingGroup` vocabulary (Form/Motion/Look/
  Camera/Post in `sceneSettings.ts`). Reordering and labeling only — no key,
  default, or auto value changed.

## Tuning notes

- **Form** settings shape the geometry and what rides on it: Wave Height
  (ridge amplitude, has an `auto` mapping to dynamics/brightness), Valley
  (canyon vs. ridge curvature), Grid Density (vertex-grid multiplier,
  rebuilds buffers on change), Circle / Sphere (layout toggles — Sphere
  overrides Circle when both are on), Circle Squeeze (ellipse/ellipsoid
  ratio for either layout), Wave Gain (how hard a band's change is pushed
  before soft-clipping), Center Spike (pole/center treatment for Circle and
  Sphere), Noise Scale, Dots / Dot Reactivity, and the Background Mesh /
  Background Dome / Dome Distance / Dome Radius / Dome Density group for the
  sky lattice.
- **Motion**: Waves Outward (which ring counts as newest), Wave Memory
  (window a band's change is measured against — short is twitchy, long is
  slow swells), Beat Expand / Beat Smooth (the shape-swell envelope),
  Waterfall (`flow`, how far back in time the horizon reads, has an `auto`
  mapping to tempo/pulse), Flowing Noise / Flux Reactivity (transient-driven
  undulation), Motion Dampening (CPU-side temporal smoothing).
- **Look**: Surface Tint / Tint Reactivity, Line Reactivity, Color Intensity,
  Background Mesh Intensity, Wireframe Only (the one true see-through mode —
  Surface Tint can't be made translucent because alpha doesn't affect the
  depth test), Scan Sweep / Sweep Speed, Contour Lines / Contour Density.
- **Camera**: Camera Distance / Height / Tilt, Zoom (a focal-length scale
  independent of the frustum-hugging grid width).
- **Post**: Scanlines / Scanline Intensity, Posterize / Posterize Steps.
- Good-look reference points, both from the dated log above: the "reference
  framing" mark (closer/steeper camera, Zoom 1.4, true circle, Grid Density
  2, fill on/contours off, Center Spike 1.5, coarse dome) for a fine
  cloth-like disc with a glowing spike and a dense dark dome; and the later
  "clean baseline" mark (Sphere inside a surrounding Background Dome,
  Flowing Noise 0, Valley 0, Center Spike 0, Dots at half) that today's
  defaults sit close to. Most numeric settings also carry a slider default
  taken from one of these saved marks rather than a guess.
- Quality tiers change the base vertex-grid resolution via
  `gridDimsForQuality` before Grid Density multiplies it; `buildGrid` is the
  one place that rebuilds GPU buffers, so switching tiers or dragging Grid
  Density both go through it.
- No true time-domain waveform reaches scenes (`waveformAnalyser.ts` is a
  phone-display-only tap that never crosses the wire), so anything that
  reads as a "waveform" here is actually the frame-rate loudness/flux
  envelope, not a real oscillogram.

## Known issues and next steps

- No open follow-ups are recorded against this scene beyond the settled
  state above; nothing in the log flags a currently-known visual defect.

## Materials

- Nothing beyond the code: no `/ref` bundle, saved scripts or artifacts.

## Resume here

- `npm run dev`, then open `/?audio=synthetic&bpm=120#/v/mesh` (any query
  params go before the `#`).
- `tests/meshGrid.test.ts` covers every exported pure helper
  (`gridDimsForQuality`, `buildGridPositions`, `buildGridTriangles`,
  `createSpectrumHistory`, `historyRowFor`, `mirroredBinFor`) headlessly —
  run `npm run test` before and after any geometry/history change.
- Read the file's own header comment first; it is kept current and explains
  the mechanism (depth/occlusion, procedural grid lines, frustum-hugging
  trapezoid, row-vs-band semantics, Circle/Sphere/Background Dome geometry)
  in more depth than this record repeats.
- Gotcha carried over from PR #55: scenes must read the latched
  `anim.onset`/`anim.*` edges, never the raw one-shot `FeatureFrame` fields,
  or beats get dropped whenever the render cap skips a tick.

## History

- `179c2eb` / #22 (2026-08-30) — Rebuild Mesh Grid as a hidden-line
  spectrogram terrain (squashed merge; see the dated sub-commit log above).
- `076fdc8` / #55 (2026-08-30) — Fix dropped beats, expose onset strength,
  clarify beat/onset naming; touches meshGrid.ts only for the
  `frame.beat` → `anim.onset` swap.
- `88aab06` / #69 (2026-09-03) — Introduce a shared vocabulary for scene
  setting groups; regroups meshGrid's `SETTINGS[].group` strings onto
  `SettingGroup`, no behavior change.
