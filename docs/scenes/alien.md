# Alien (`alien`)

One grey alien dancing as a glowing green wireframe on black, in three short
loops: each loop is one captured dance seen from its own angle. The music pays
for the frames: the Play setting's wire sets how fast the loop on screen plays,
and silence holds the frame. The Cut setting's wire cuts to another loop when
it rises over the line under its graph. A draft, not on main yet (#374).

## Where the code is

- `src/render/scenes/alien/index.ts`: the scene. It holds the two settings in
  `SETTINGS`, the passes (mesh, bloom, composite; the Gates pattern),
  `packSkin()`, the `?loop=<n>` DEV pin and the `window.__alien` DEV hook,
  which shows the reel and the last readings off both wires.
- `reel.ts`: the `LOOPS` table (clip + camera per loop) and the two rules,
  `advanceReel()`. Its header has the Play and Cut rules in words.
- `body.ts`: the alien's shape as data (`PARTS`, each part on a rig bone, in
  that bone's frame) and its distance field, `compileSet()`, with per-part
  bounding-sphere pruning.
- `mesh.ts`: the shape turned into a skinned triangle mesh once per page
  (`alienMesh()`): surface nets per set on the grids in `SET_CELLS`,
  relaxation, normals, skin weights, de-indexing.
- `glsl.ts`: GPU skinning, the barycentric wireframe, the fresnel rim and
  outline, the blur and composite.
- `src/ui/widgets/alienPlay.ts`: the Play readout under the Play row. It
  shows speed, frames bought per second, the loop on screen, and the loop as
  a strip of its frames with the playhead. It is fed by the scene's
  `probe()` and declared in `PANEL`.
- Reused, not copied: the dancers' rig, clip format and `clips.bin`
  (`../dancers/`); the drive system (`drives.value`, `drives.threshold`);
  the Level signal (`feature.level`) from PR #368.
- Tests: `tests/alien.test.ts`.

## References

- "Alien Dance VJ Loop 4K – 2.5 Hours", Alien Signal Lab:
  https://youtu.be/W78QGQtrS5k. Studied for the look only: the first 45 s
  (a crowd of grey aliens drawn as green triangle wireframes with bright
  outlines on black, a cyan tint toward the back, a close front hero framing).
  Our alien is an original model built from simple shapes; nothing of the
  video's mesh, motion or frames is used.
- The video's audio is a silence encode (−91 dB through the slice), so it
  shows nothing about music sync. Play and Cut come from the user's brief,
  not from the video.
- Hand-pulled slice and frames: `tools/.cache/refs/alien-dance/` (local
  cache, never in this repo). No `/ref` scan: with no audio, the scan's sync
  side had nothing to measure.

## Measurements

2026-10-05, headless Chromium (Metal) with a fake mic playing
`scripts/mkwav.py`'s test file (25 s acid techno from the `CL-893hKSzI` /ref
bundle, 12 s of white hiss at about −61 dBFS, 15 s more of the track), plus
30 s of the `vKJu9mfeDS8` bundle (123 bpm):

- Play on Level × `PLAY_GAIN`: speed 0.88–1.16 on the music, exactly 0 in
  the hiss; two frames 6 s apart in the hiss are pixel-identical.
- Hit signals as the Cut wire (Bass hit, Mid hit, Treble hit, Beat): pulses
  peak at 0.8–1.0 on almost every hit (Bass hit median peak 0.88), so a line
  anywhere from 0.3 to 0.95 cut every 0.4–1 s.
- Bass level with a hysteresis re-arm (fall under 0.65 of the line): 20
  cuts/min in one stretch, none in a sustained-bass stretch (the level never
  fell back through the band). A higher re-arm share cut every 0.8 s.
- Bass level, rising crossing, `MIN_SHOT_SEC` minimum (simulated offline at
  lines 0.8/0.85/0.9, then confirmed in the app at 0.85): about one cut
  every 2–4 s on the acid track in both stretches, about every 6 s on the
  123 bpm track, none in hiss.
- The mesh: about 23k triangles, built in about 0.26 s under node.

## Decisions and pivots

- 2026-10-05: the user, after Toon Rave "not exactly going where I want":
  try again from this video, something very simple. 3 short loops of one
  alien, each from a different angle, each with him dancing, and 2 drivers:
  a threshold driver for the clip switch, and music paying "units of music
  energy for each frame of video" (no music, he stays).
- Built as a new draft scene, not a Toon Rave mode. The loops are the
  dancers' captured clips (`expressive`, `twist`, `toprock2`) through fixed
  cameras: front close-up, three-quarter from above, low from the floor.
- A real triangle mesh, not the dancers' raymarcher: the reference's look is
  the mesh's own edges. The shape is meshed from a distance field so it can
  be reshaped as data, then skinned to the rig on the GPU.
- Mesh density matched to the reference: the head on a finer grid than the
  body (the reference's face is denser than its torso), the hands finer
  still. A uniform fine grid filled the body with wire at mid-distance, so
  the wire also dims as on-screen triangles shrink.
- Play: Level, not All level. All level is auto-gained and reads mic hiss
  as mid-range (PR #368), so the alien would keep dancing in silence.
- Cut: Bass level, rising crossing, a minimum shot (Measurements has why).
  First built on Bass hit with a hysteresis band; both cut far too often.
- 2026-10-05, the user: "expose more info on this part that makes alien
  move". Asked whether that meant an explanation or the panel, they picked a
  live readout under Play (the mockup's lines: speed, "buying N fr/s", loop,
  a strip with the playhead, the frame number). In silence it reads 0 and
  the strip greys and stops, with "held" after the frame number.

## Tuning notes

- Play's slider multiplies the wire: 1 plays a loud song at about captured
  speed. Raise it for a faster dance on quiet material.
- Cut's line is the cut rate: lower, more cuts. On a busy track the minimum
  shot is what sets the rhythm.
- Judge the look in loop 0 (`?loop=0`), whose framing is the closest to the
  reference. Mid-distance loops show the wire dimming.

## Known issues and next steps

- The dance speeds up and slows down with the level all the time. That is
  the brief ("pay per frame"), but it may look rubbery; snapping to steps
  like Toon Rave's Energy would be the next thing to try if it does.
- A head nod can push the neck's top through the back of the skull: the
  neck and head are separate surfaces.
- The hero framing crops the top of the head when the dance lifts it.
- Only one alien; the reference has a crowd.
- Portrait screens only pull the lens back a little (`NARROW_FOCAL_MIN`);
  no per-loop focus point yet.
- About 5 of the mesh's triangles face inward at creases and are culled.

## Materials

- Working scripts: `alien/scripts/`. `shot.mjs` takes headless shots,
  `realmusic.mjs` drives a fake mic and logs the reel, and `mkwav.py` builds
  the music/hiss/music test file. `summarize.py` and `simhold.py` read the
  logs. `meshcheck.ts` and `clipcheck.ts` run under
  `node --experimental-strip-types`, and `tile.py` makes contact sheets.
- Reference media: `tools/.cache/refs/alien-dance/` (local only).

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=128#/v/alien`. Add `&loop=<n>`
  to pin one loop.
- Real music: `node docs/scenes/alien/scripts/realmusic.mjs <wav> out.json
  --port <p>` with the dev server running, then `python3 summarize.py
  out.json`. Synthetic audio always reads loud, so it can't test silence.
- Gotcha: `__viz.probe()` doesn't carry drive readings. Read
  `window.__alien.last` instead.

## History

- #373 (2026-10-05, closed): the scene, built on #368 for the Level signal.
- #374 (draft, 2026-10-05): the same, rebased after #368 merged, plus the Play readout.
