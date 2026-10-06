# Alien (`alien`)

One grey alien dancing as a glowing green wireframe on black, in three short
loops: each loop is one captured dance seen from its own angle, baked to a
video. The music pays for the frames: the Move setting's wire sets how fast the
loop on screen plays, and silence holds the frame. Bounce squashes him toward
the floor and springs him back on its wire's hits; Bounce smoothness turns
that spring from a snap and a wobble into an ease and a glide. A loop repeats
until the Cut setting's wire rises over the line under its graph. On main
since #374.

## Where the code is

- `src/render/scenes/alien/index.ts`: the scene, a video player. It holds the
  settings in `SETTINGS`, the Motion section in `PANEL`, one `<video>`
  per loop (pinned bytes), the frame upload, the `?loop=<n>` DEV pin and the
  `window.__alien` DEV hook (reel, last wire readings, videos).
- `reel.ts`: the `LOOPS` table (clip + camera per loop) and the rules:
  `easeSpeed()` (Move), `stepCut()` (Cut), `stepBounce()` (Bounce) and
  `bounceSpring()` (Bounce smoothness). Its header has them in words.
- `glsl.ts`: `PLAYER_FRAG`, the scene's one pass: the baked frame to cover
  the room, squashed about the loop's pivot. The rest of it is the live look,
  used only by the bake: GPU skinning, the barycentric wireframe, the fresnel
  rim and outline, the blur and composite.
- `loops/`: the baked videos and `manifest.ts` (frame rate, size, and per
  loop its clip, frame count and Bounce pivot), both made by
  `tools/alien-bake.mjs`.
- The bake: `renderer.ts` draws the alien live (mesh pass, bloom,
  composite); `bakePage.ts` (served by `tools/alien-bake/index.html` on the
  dev server) draws any frame of any loop; `tools/alien-bake.mjs` saves every
  frame and encodes each loop with ffmpeg.
- `body.ts`: the alien's shape as data (`PARTS`, each part on a rig bone, in
  that bone's frame) and its distance field, `compileSet()`, with per-part
  bounding-sphere pruning.
- `mesh.ts`: the shape turned into a skinned triangle mesh (`alienMesh()`):
  surface nets per set on the grids in `SET_CELLS`, relaxation, normals,
  skin weights, de-indexing.
- `src/ui/widgets/alienPlay.ts`: the Move readout under the Move row: speed,
  frames bought per second, the loop on screen, and the loop as a strip of
  its frames with the playhead. Fed by the scene's `probe()`.
- Reused, not copied: the dancers' rig, clip format and `clips.bin`
  (`../dancers/`); the drive system (`drives.value`, `drives.threshold`);
  the Level signal (`feature.level`, #368).
- Tests: `tests/alien.test.ts`.

## References

- "Alien Dance VJ Loop 4K – 2.5 Hours", Alien Signal Lab:
  https://youtu.be/W78QGQtrS5k. Studied for the look only: the first 45 s
  (a crowd of grey aliens drawn as green triangle wireframes with bright
  outlines on black, a cyan tint toward the back, a close front hero framing).
  Our alien is an original model built from simple shapes; nothing of the
  video's mesh, motion or frames is used.
- The video's audio is a silence encode (−91 dB through the slice), so it
  shows nothing about music sync. Move, Cut and Bounce come from the user's
  brief, not from the video.
- Hand-pulled slice and frames: `tools/.cache/refs/alien-dance/` (local
  cache, never in this repo). No `/ref` scan: with no audio, the scan's sync
  side had nothing to measure.

## Measurements

2026-10-05, headless Chromium (Metal) with a fake mic playing
`scripts/mkwav.py`'s test file (25 s acid techno from the `CL-893hKSzI` /ref
bundle, 12 s of white hiss at about −61 dBFS, 15 s more of the track), plus
30 s of the `vKJu9mfeDS8` bundle (123 bpm):

- Play (now Move) on Level × gain 2, live render: speed 0.88–1.16 on the
  music, exactly 0 in the hiss; two frames 6 s apart in the hiss are
  pixel-identical.
- Hit signals as the Cut wire (Bass hit, Mid hit, Treble hit, Beat): pulses
  peak at 0.8–1.0 on almost every hit (Bass hit median peak 0.88), so a line
  anywhere from 0.3 to 0.95 cut every 0.4–1 s.
- Bass level with a hysteresis re-arm (fall under 0.65 of the line): 20
  cuts/min in one stretch, none in a sustained-bass stretch (the level never
  fell back through the band). A higher re-arm share cut every 0.8 s.
- Bass level, rising crossing, `MIN_SHOT_SEC` minimum, line 0.85: about one
  cut every 2–4 s on the acid track, about every 6 s on the 123 bpm track,
  none in hiss. (The user then asked for loops that only change on a
  trigger: see Decisions.)
- The mesh: about 23k triangles, built in about 0.26 s under node.
- The bake at 1280×720, 120 frames per second of dance: 1168 frames for the
  three loops in about 40 s. H.264 at CRF 20: 5.7 MB for the three; CRF 22:
  4.3 MB; CRF 26 smeared the face's mesh (loop 1 alone went from 1.3 MB to
  0.6 MB).
- The player on the same test file: speed 0.9–1.1 on the music; the video
  pauses in the hiss (no frame moved in 9 s) and resumes with the music.
  One cut in 54 s, at the music's return after the hiss (Drop). Bounce
  squash 0.02–0.07 of the height on the kicks (143 bpm keeps it from
  settling between kicks), 0 in the hiss.
- 2026-10-06, Bounce smoothness, `stepBounce` in node at 60 fps with Bounce
  0.5 and a 0.88 Bass hit decaying at the low band's rate: one hit squashes
  to 0.065 at every smoothness, reached at 133 ms at 0, 183 ms at 0.5 and
  250 ms at 1, with no stretch past rest. The gain that keeps that depth is
  1.47 at 0.5 and 2.03 at 1. On kick trains the swing narrows and rides
  higher: 0.015–0.061 at 0, 0.054–0.078 at 1 (143 bpm). Ending the slider
  at 2.0 or 2.4 Hz instead of 1.8 barely moved that floor (0.050, 0.043):
  the damping and the gain set it, not the frequency.
- Same day, the live app on synthetic audio at 128 bpm (Metal, 30 fps
  render): squash 0.013–0.071 at smoothness 0, largest one-frame change
  0.0215; 0.055–0.092 at 1, largest change 0.0097.

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
  as mid-range (#368), so the alien would keep dancing in silence.
- 2026-10-05, the user: "expose more info on this part that makes alien
  move". Asked whether that meant an explanation or the panel, they picked a
  live readout under the speed row: speed, "buying N fr/s", loop, a strip
  with the playhead, the frame number. In silence it reads 0 and the strip
  greys and stops, with "held" after the frame number.
- 2026-10-05, the user: "my idea was that we can have basically baked
  videos". The loops are now rendered offline at 120 frames per second of
  dance and played as videos, with Move setting the playback rate. More
  frames rather than blending: blending two frames of a thin wireframe
  doubles its lines. The live renderer stays as the bake's source.
- Same day: Play renamed **Move** ("a bit too sensitive" → its speed now
  eases over `SPEED_EASE_SEC` instead of following every flicker; that
  reading of "too sensitive" was my guess, not confirmed).
- Same day: **Bounce** added — "simplest shrinking it vertically (but mb u
  can find something better)". Done as squash and stretch about the floor
  under the alien (a damped spring: squash on the hit, overshoot into a
  stretch, settle), wired to Bass hits by default (my pick, not asked).
- Same day: "don't make loops change automatically… loop should be looping
  until there was a trigger". Cut's default wire moved from Bass level
  (a cut every few seconds) to Drop, so a loop repeats until the music
  drops or changes section. Which trigger the user meant wasn't confirmed.
- 2026-10-06, the user: "add parameter smoothenest for bounce". Added
  **Bounce smoothness**, my reading (not asked): how the squash moves, from
  today's snap and wobble (0, the default, unchanged) to a slow ease down and
  a glide back (1). Not a filter on which hits bounce. A softer spring alone
  shrank a hit's squash by half, so the target is scaled to keep one Bass
  hit's depth; the cost is that on fast kicks a smooth bounce doesn't come
  back up between hits. A peak hold on the signal was tried in a sim first:
  a hold shorter than the hit pulse's own decay does nothing, a longer one
  left the alien squashed with almost no swing.

## Tuning notes

- Move's slider multiplies the wire: 1 plays a loud song at about captured
  speed. Raise it for a faster dance on quiet material.
- Bounce's slider is the depth; its spring (`BOUNCE_HZ`, `BOUNCE_DAMPING`)
  sets how snappy it is and how far it overshoots. Bounce smoothness eases
  that spring toward `SMOOTH_HZ`, `SMOOTH_DAMPING`; if its smooth end sits
  too low on fast music, the damping is the knob that matters.
- Cut's line on Drop: any drop clears it. Wire it to Bass level with a high
  line for regular cuts instead.
- Judge the look in loop 0 (`?loop=0`), whose framing is the closest to the
  reference.

## Known issues and next steps

- Size: the three videos are pinned, so every visitor's page fetches them
  after load (about 4 MB), Alien or not. A lazy fetch or a separate host
  would need the deploy-skew rule in `src/pinnedAssets.ts` solved another way.
- Video playback rate can't go below about 0.07×; slower than that the loop
  pauses.
- In the close-up the Bounce pivot is far below the frame, so a squash
  reads as the whole picture dipping.
- A head nod can push the neck's top through the back of the skull: the
  neck and head are separate surfaces.
- Only one alien; the reference has a crowd.
- Portrait screens crop the 16:9 frames to their middle.
- About 5 of the mesh's triangles face inward at creases and are culled.

## Materials

- The bake: `tools/alien-bake.mjs` (its header has the command) and the
  bake page `tools/alien-bake/index.html`.
- Working scripts: `alien/scripts/`. `shot.mjs` takes headless shots,
  `realmusic.mjs` drives a fake mic and logs the player, and `mkwav.py`
  builds the music/hiss/music test file. `summarize.py` and `simhold.py`
  read the logs. `meshcheck.ts` and `clipcheck.ts` run under
  `node --experimental-strip-types`, and `tile.py` makes contact sheets.
- Reference media: `tools/.cache/refs/alien-dance/` (local only).

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=128#/v/alien`. Add `&loop=<n>`
  to pin one loop.
- Changed the alien, a loop or the look? Rebake with the dev server
  running: `FFMPEG=<ffmpeg> node tools/alien-bake.mjs --port <p>`, then
  look at a decoded frame before committing the videos.
- Real music: `node docs/scenes/alien/scripts/realmusic.mjs <wav> out.json
  --port <p>`. Synthetic audio always reads loud, so it can't test silence.
- Gotcha: `__viz.probe()` doesn't carry drive readings. Read
  `window.__alien.last` instead.

## History

- #373 (2026-10-05, closed): the scene, built on #368 for the Level signal.
- #374 (merged 2026-10-05): the same, rebased after #368 merged, plus the
  Play readout; then baked loops, Move, Bounce, and Cut on Drop.
- 2026-10-06: Bounce smoothness.
