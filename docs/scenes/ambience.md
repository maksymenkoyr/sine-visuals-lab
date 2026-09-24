# Ambience (`ambience`)

An homage to the visualizers that shipped with the old Windows Media Player:
one hot colour on a near-black indigo ground, everything a soft flat glow,
nothing lit or textured. A regular lattice of glowing discs that mostly
lives as a sheet — rippling, bending, tumbling, stretched, seen in
perspective from a camera that sweeps between poses on bar boundaries — but
is really a set of dots free to take any formation (dot, line, sheet, tube,
cube, tesseract). A musical hit sends a swell running along one row or
column that balloons and merges the discs inside it into one blob. Draft, on
main.

## Where the code is

`src/render/scenes/ambience.ts`. Discs are instanced quads drawn from an
empty VAO (`gl_VertexID` for the corner, `gl_InstanceID` for the lattice
cell) — the first `drawArraysInstanced` in the repo — needed because swells
push a disc well past what `gl.POINTS` guarantees for point size. Discs
composite with premultiplied "over" blending rather than additive, so two
same-colour discs union into one flat shape instead of blooming white; the
glow is a low-intensity skirt on the same sprite carrying its own alpha.
There is no depth test — same-colour flat discs look identical whichever is
in front, letting the sheet fold over itself.

`formation(id)` blends two formations by a transition progress with a
per-dot stagger, then `flip4` turns the sheet's plane into a fourth axis and
projects with w-perspective (so the sheet passes through a line and
re-expands mirrored), then a 3D tumble about the current look target. The
tesseract formation is a genuine 4D lattice, `latticeDims` factoring the dot
count into four sides. Motion streaks come from evaluating each dot at this
frame's and the previous frame's animation state (`uAnim`/`uAnimPrev`) and
stretching the sprite into a capsule along its screen-space velocity — not a
post pass. `createChoreographer` owns everything animated on the JS side:
the camera/curvature/tumble/stretch pose, the flips, and the journeys
(`JOURNEYS`, `OPENING_LEGS`) — sequences of formation legs timed in bars,
started every few bars and on a section drop, and once at the start as the
opening unfold. Swells are a small pool of travelling pulses
(`createPulsePool`, `MAX_PULSES`, `PULSE_REFRACTORY_SEC`, `PULSE_TAIL`),
each a row or column with a head position and strength, fired from anim's
latched edges (see `renderLatch.ts`) rather than `FeatureFrame.onset`
directly, since a render-capped tick can drop the raw flag. Colour is the
active palette's hot stop (`HOT_T`, the magenta on the default palette) with
a hue-preserving chroma push; the ground is a dark indigo tinted by the same
colour, so another palette recolours the whole scene consistently. `dt`
comes from `anim.timeSec` deltas rather than `anim.dtSec`, same reasoning as
`storm.ts` and `meshGrid.ts`. Tests: `tests/ambience.test.ts`.

## References

Studied from a short WMP-style visualizer clip
(youtube.com/shorts/bLAImDIOIIE, "Drake — Not You Too (Windows Media Player
Visualizer)", channel Daniel Lepua): pale magenta on indigo, a lattice of
glowing dots. This scene predates the `/ref` bundle workflow — reference
frames were pulled directly with `yt-dlp` and `ffmpeg` rather than through a
`tools/.cache/refs/<id>/` bundle, so there's no bundle for it.

## Decisions and pivots

- Initial build: paired a comet "sunburst" for quiet sections with the
  dot-lattice sheet for loud ones, crossfaded by section intensity with
  hysteresis and pinnable via a Mode setting — a two-look scene matching the
  reference's quiet/loud alternation.
- Second pass, same day: after a closer look at the reference from later in
  the clip, the request was for more dynamic sheet motion — flipping,
  stretching, and a few more transitions connected through a dot or a line,
  including a 4D transition. This added the formation system (`FORM`:
  dot/line/sheet/tube/cube/tesseract), the choreographer running `JOURNEYS`
  on bar boundaries, the 4D `flip4` turn, the real 4D tesseract lattice, and
  motion streaks.
- Third pass, same day: on request, the comet/sunburst path was removed
  entirely — its programs, the Mode picker, the crossfade and its threshold
  are gone. The lattice now opens through `OPENING_LEGS` (dot to line to
  sheet) and is the whole scene; a quiet-section-specific look, if wanted
  again, would need to be rebuilt from scratch (the removed comet shaders
  exist only in pre-removal branch history, not in any file on main).
- A scene-local uniform once collided with a setting's auto-generated
  `u<Key>` uniform name, causing a silent GLSL redefinition and a fallback
  to a different scene entirely — resolved by renaming the scene-local
  uniform; any new scene-local uniform needs to avoid every setting key's
  generated name.

## Tuning notes

Premultiplied "over" blending (colour and alpha scaled together for fog, the
row window, and the phase crossfade) is required for merged blobs to read as
flat unions rather than rings — scaling alpha alone leaves dark rings, and a
halo floor that doesn't reach zero at the quad edge shows as a faint box
around each disc. Disc size is derived in world units from the lattice
spacing and projected, with a pixel floor so far rows don't dissolve, so
quality-tier lattice density changes (`gridDimsForQuality`) and the
governor's render scale can't blow the sprites up or shrink them away.
`SETTING_GROUPS` ordering (Form/Motion/Look/Camera/Post) is enforced
contiguous by `tests/settingGroups.test.ts`, same constraint noted in the
Kaleidoscope scene's record.

## Known issues and next steps

The `glow` setting's description ("soft halo around every disc and comet")
still refers to "comet" even though the comet/sunburst path was removed in
the third pass — leftover wording from before that removal, not a live
feature.

## Resume here

`npm run dev`, then `/?audio=synthetic&bpm=120#/v/ambience`. `__viz.setParams`
ignores `settings` unless `scene` is also passed. If the dev tuning bus
re-applies `autoPin:true` shortly after load, apply `autoPin:false` a couple
of seconds after page load to keep a manual override from being overwritten.
Device-menu range inputs are found by `aria-label` matching the setting's
label. For another instanced-sprite scene, `ambience.ts`'s instanced-quad +
premultiplied-halo pattern is the one to start from.

## History

- `#80` (2026-09-04, merged) — Ambience added: a WMP-style dot-lattice sheet
  with formation journeys and 4D turns, built and tuned same-day through the
  comet-sunburst-then-removed sequence described above.
