# Alien (`alien`)

One grey alien dancing as a glowing green wireframe on black, in three short
loops: each loop is one captured dance seen from its own angle, drawn live
every frame. The music pays for the frames: the Move setting's wire sets how
fast the dance on screen plays, and silence holds him still. Bounce squashes him toward
the floor and springs him back on its wire's hits; Bounce smoothness turns
that spring from a snap and a wobble into an ease and a glide. A loop repeats
until the Cut setting's wire makes a hit that stands out from its everyday
ones (the dotted line on its graph). In development, on main since #374.

## Where the code is

- `src/render/scenes/alien/card.ts`: the scene's card, loaded with the page: id,
  name, `SETTINGS`, the Motion section in `PANEL`, `MOVE_GAIN`, the `gallery`
  record and `loadBody`. The body spreads the card, so the registered settings
  are the body's own objects.
- `src/render/scenes/alien/index.ts`: the body, loaded after first paint. It
  loads the dancers' clip library (`sceneMedia`, fetched on the first mount;
  black until it lands), keeps each loop's place in its clip, samples the pose
  and has `renderer.ts` draw it. Also the `?loop=<n>` DEV pin and the
  `window.__alien` DEV hook (reel, last wire readings, each loop's place).
- `renderer.ts`: the alien drawn live (mesh pass, bloom, composite) through a
  loop's camera, into this device's slice of the room, with Bounce's squash;
  `floorPivot()` finds the floor point the squash pulls toward.
- `reel.ts`: the `LOOPS` table (clip + camera per loop) and the rules:
  `easeSpeed()` (Move), `stepCut()` (Cut), `stepBounce()` (Bounce) and
  `bounceSpring()` (Bounce smoothness). Its header has them in words.
- `glsl.ts`: the look: GPU skinning, Bounce's squash on the skinned figure,
  the barycentric wireframe, the fresnel rim and outline, the blur and
  composite.
- The old baked videos, `public/media/alien/loop{0,1,2}-v1.mp4`, are no longer
  played. They stay for tabs on an older build (`src/pinnedAssets.ts`'s
  header, "Scene media"). `loops/manifest.ts` (`BAKED`) lists them, and the
  bake that made them still works but is optional: `bakePage.ts` (served by
  `tools/alien-bake/index.html` on the dev server) draws any frame of any
  loop, and `tools/alien-bake.mjs` saves every frame and encodes each loop
  with ffmpeg.
- `body.ts`: the alien's shape as data (`PARTS`, each part on a rig bone, in
  that bone's frame) and its distance field, `compileSet()`, with per-part
  bounding-sphere pruning.
- `mesh.ts`: the shape turned into a skinned triangle mesh (`alienMesh()`):
  surface nets per set on the grids in `SET_CELLS`, relaxation, normals,
  skin weights, de-indexing.
- `src/ui/widgets/alienPlay.ts`: the Move readout under the Move row: speed,
  frames bought per second, the loop on screen, and the loop as a strip of
  its frames with the playhead. Fed by the scene's `probe()`.
- `tools/alien-model/`: the new alien, built headless in Blender (#772) and not
  yet drawn by the scene (#773 puts it in). `exportRig.ts` writes the rig's bind
  pose for Blender, `build.py` builds the model and writes `alien.bin` and the
  renders, `check.ts` reads `alien.bin` beside today's mesh. `build.py`'s header
  has the method and the file layout.
- Reused, not copied: the dancers' rig, clip format and clip library
  (`../dancers/`, `CLIP_LIBRARY_URL`); the drive system (`drives.value`, `drives.threshold`);
  the Level signal (`feature.level`, #368); the standout detector
  (`src/render/standout.ts`, a `StandoutTrigger` held in the reel as `cut`),
  shared with Caustics' Beat ripple and Physarum 2's Dose.
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
- Same day, Cut on the standout detector, live app (Metal) with a fake mic
  playing 45 s of `tools/.cache/promo-songs/deTJ513J07Y.mono48.wav`, logged
  by `realmusic.mjs --cut <signal> --cut-threshold <t>` and read with
  `cutsum.py`:
  - Drop (the default wire): one drop in the 45 s, as the music came in, and
    one cut on it.
  - Bass hit, Cut threshold at its default: 148 hit peaks (median 0.94), 20
    cuts, 2.06–2.89 s apart. The minimum shot still sets the pace; within
    it, not every hit is a standout. Learned floor about 0.14, peak 0.67.
  - Bass hit, Cut threshold 0.75: 3 cuts in the 45 s.

- 2026-10-27, the new model from `tools/alien-model/` (Blender 5.2.3, the
  owner's Mac), measured by `check.ts`:
  - 10,002 vertices and 20,000 triangles (today's mesh: 20,304), indexed;
    `alien.bin` is 520,092 bytes before compression.
  - 2.442 m tall and ±1.079 m across the arms (today: 2.148 m and ±1.006 m).
    The rig's bones are unchanged; the height is B's big head.
  - The squeeze moves 2,572 vertices, the crown by up to 30.3 cm; nothing
    below the neck's middle moves.
  - 2 triangles face against their normals (today: 5), 3 are slivers under
    4°. At a 2 mm field Blender's symmetric decimate folded 533 of them and
    they drew as specks; at 3 mm about 10, and a relax onto the surface
    leaves 2.
  - Mean triangle edge after decimating: skull 34 mm, face 9, torso 20,
    legs 19, hands 9, feet 13.
  - The build takes about 16 s to `alien.bin`, 30 s with the renders, and a
    rerun writes the same file.
- 2026-10-28, round 2 of the model (the owner on round 1: "its pretty good"),
  by `check.ts`:
  - 2.365 m tall: the head shrunk 0.88× about the chin. Same vertex and
    triangle counts and file size.
  - 0 triangles face against their normals and 0 are slivers: the fold on
    the skull's side, a speck in round 1, is relaxed out with the others.
  - The squeeze moves 2,515 vertices, up to 26.6 cm after the shrink.
  - Mean triangle edge: face 10 mm (round 1: 9); the skull, body, hands
    and feet as before.
  - Measured from the owner's head picture, the eye along its own axis is
    0.31 of the head's width long and 0.19 wide, tilted 29°. Round 1's eye
    was as long but only 0.14 wide.
  - B's head is 0.36 of B's height below the chin; round 1's was the same
    on the rig, so the head was not too big for B, only for today's framing.
- 2026-10-28, round 3 (eyeballs, a clearer squeezed face), by `check.ts`:
  - 10,246 vertices and 20,480 triangles; the two eyeballs are 244 and 480
    of them. `alien.bin` is 532,732 bytes.
  - 0 triangles face against their normals; 6 slivers, all at the
    eyeballs' pointed corners, which draw black.
  - The squeeze moves 2,911 vertices (the eyeballs among them), still up to
    26.6 cm.
- 2026-10-28, round 4 (bigger eyes kept whole in the squeeze, a smile), by
  `check.ts`: 10,246 vertices, 20,480 triangles, 532,732 bytes; 0 triangles
  facing against their normals; 7 slivers, 6 at the eyeballs' corners and 1
  on a thigh. The squeeze moves 3,026 vertices, up to 26.7 cm.
- 2026-10-28, drawn live instead of the videos (#751), headless Chromium on
  Metal on the owner's M1 Pro, videos before and live after:
  - GPU per frame at 3024×1890, quality high, by `gpu-bench --scenes alien`
    (a one-pixel readback per frame), three alternating rounds: the player
    0.55–0.84 ms, live 1.58–2.05 ms. The player's video decoding is not in
    its number. For the run, the bench page waited 1.5 s after `init` so the
    videos and the clips had landed (a local edit, not kept). The in-app
    per-draw timing (`--app --dpr 2`) read 0.56 ms for the player and about
    8 ms summed over the live passes, but on Metal a timer query around one
    pass can take in most of the frame, so it overstates. The weak-laptop
    run #556 asks for has not been made.
  - The mesh build in Chromium: 160–173 ms, once per page (`alienMesh()`
    caches it), on the first mount.
  - Each loop's first frame, Move and Bounce at 0, at 1600×900: the same
    pose and framing as the video, the wire sharper. Mean green 11–14%
    brighter. At 3024×1890 (DPR 2), where the video was a 1280×720 picture
    stretched 2.4×, the mean is 6% darker, but the lines are crisp and stand
    out more.
  - Bounce, one frame per loop squashed 0.14 (Bounce 1 on a full hit) and
    stretched 0.08, beside the old picture squash of the same frame: the
    same dip and spread. In the close-up the old squash showed the video's
    top edge as a flat cut through the head, and the stretch its bottom edge
    as a black band under the hips; live has neither. A squash in 3D moves
    near parts further on screen than far ones, so in loop 1 a sliver of the
    far arm shows from behind the near one.
  - Slow Move, `deTJ513J07Y` as the mic with loop 0 pinned, logged on every
    rendered frame (60 fps) for 15 s: Move 0.2 (speed 0.11–0.19), Move 0.1
    (0.055–0.095), and an 18 dB quieter copy at Move 1 (0–0.28). The dance
    moved on every render while the speed was above 0. At those speeds a
    screen frame bought a median of 0.14–0.29 frames of the old 120 fps
    video, so the player showed each of its frames 3 to 7 times, and it
    would have paused 41% (Move 0.1) and 49% (the quiet copy) of the time,
    under its 0.07× floor.
  - Opening the scene, and hovering its gallery tile, fetch
    `/media/dancers/clips-v1.bin` once and no `/media/alien/` file (the
    videos were 4.3 MB).
  - `tune-real` on `deTJ513J07Y`, then silence, 30 s from 4 s:

    | source | change med | change p95 | hits/min | energy | fps |
    | --- | --- | --- | --- | --- | --- |
    | song, videos | 1.23 | 2.05 | 426 | 0.47 | 120 |
    | song, live | 1.28 | 2.21 | 450 | 0.49 | 120 |
    | silence, videos | 0.00 | 0.00 | 0 | 0.00 | 120 |
    | silence, live | 0.00 | 0.00 | 0 | 0.00 | 120 |

    Silence, both times: "the picture holds still".
  - The Move readout, song then silence: speed 0.71–0.81×, buying 23–26
    fr/s, the frame climbing through the clip's 128; in silence 0.00×,
    0 fr/s, "held", the strip grey.

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
- Play: Input level, not Level. Level is auto-gained and reads mic hiss
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
  stretch, settle), wired to Bass hit by default (my pick, not asked).
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
- 2026-10-06, the user: "cut on alien should have the same logic as beat
  ripple and dose. but lets first extract this logic and shape it properly
  for future reuse". The standout detector moved out of Caustics'
  `rippleEmitter.ts` into `src/render/standout.ts`, with a `StandoutTrigger`
  (the detector plus a shortest gap between fires) for one-event settings;
  Dose was moved onto it unchanged. Cut is now a `StandoutTrigger` with
  `MIN_SHOT_SEC` as its gap, instead of a rise over a fixed line. Its row is
  "Cut threshold", worded like "Dose threshold", and the graph draws the
  "reach to cut" line and a dot per cut (keyed "cut"; the key had said
  "ring sent" for every scene). With the row Off every climb out of
  near-silence cuts, as the line's floor did before. Two side effects: the
  first shot can now cut before `MIN_SHOT_SEC` (the trigger starts ready),
  and a "Cuts above" value someone had moved is read as a Cut threshold
  (not migrated; the scene was a day old).
- 2026-10-06, the user: Move "doesn't work on ipad in room… bounce works,
  but no movements". Move is the only setting that needs the `<video>` to
  play; Bounce is a shader effect on whatever frame is up. WebKit on iOS
  pauses an inline video it counts as off-screen (a video outside the page
  always is) and can refuse play() on a video no tap has touched (always in
  Low Power Mode). The old code swallowed that refusal, so the frame sat
  still. Now the videos sit in the page as one invisible pixel, the first tap
  or key starts and stops every loop (iOS then lets each play), and wherever
  play() is still refused the scene moves the paused video's playhead itself.
  Checked headlessly with play() stubbed to refuse until a click (Chromium
  and WebKit): the playhead advanced 0.86 s per second at speed 0.85, and
  after a click play() took over. Not yet seen on a real iPad.
- 2026-10-08 — Cut gets a Reaction row under its graph (`drive.hit`, with
  `ownDetector`), flat-only: a cut either happens or it doesn't, so Sized is
  greyed out with that hint. The reel is unchanged.
- 2026-10-11 — Sampler uniforms that were looked up with a raw `getUniformLocation` on every call now go through `GLProgram.setI`. Nothing visible changed: headless before/after shots look the same. (#349)
- 2026-10-24 — Id, name, settings, panel and gallery record moved to `src/render/scenes/alien/card.ts`, so the scene's code loads after the page's first paint. Nothing visible changed. (#536)
- 2026-10-26, the owner on the polish (#750): "core things like animation.
  next thing is 3d model", and of today's model: "i want it to be just better
  this is quite meh". Then: "ok so blender it is".
- 2026-10-27, the owner on the new model, after three rounds of design
  pictures (#753):
  - the body: "i want him to have a typical body of this type of alian we
    have alraedy", then "body from B" (round 1's B);
  - the head: "i want his head to look like this [a classic green alien
    head] kind of stupid", then "head should look as close to this as
    possible";
  - on the music: "i want there to be an option for them to react to music
    by shrinking their head to this [a small round head with puffy eye
    rims]", then "more squize too";
  - the route: "lets try to build in blender using my two reference images +
    B's body. cos this is now what i need".
- 2026-10-27, built that way in `tools/alien-model/` (#772). My calls, not
  asked:
  - B's head height on the rig, with the owner's picture's proportions, so
    the figure is about 29 cm taller than today's;
  - the squeezed head is the normal head deformed into a ball, not a second
    model, so it is a shape key on the same mesh. Projecting onto a second
    modelled head folded the triangles round the eyes;
  - the jaw bone deforms nothing, as before: nothing drives it for the alien.
- 2026-10-28, the owner on round 1: "its pretty good. would we polish it?",
  then "proceed" on my list: the eyes, the face's dense patches, a smaller
  head. My calls on it:
  - the eyes keep their length and get the picture's width, in a deeper
    socket with the lens set back from the face: that step is what the
    wire draws as an outline, the way today's alien's eyes read;
  - the dense triangles ring the socket instead of filling the lens, and
    the nose and mouth patches are tighter;
  - the head shrinks to `HEAD_SCALE`, not to today's height: that would
    take a head about half as tall, no longer B's. The scene scales the
    whole figure to its frame (#773), so the height in metres matters only
    for proportion. `--head-scale 1` rebuilds round 1's size.
- 2026-10-28, the owner on round 2: "it has eye holes but like no eyes can u
  add them. also a tiny bit more distingushible facial features on squezed.
  also technically i think squezes should be made from metamorphosing
  normall one cos later we wanna use this animation as scene param". My
  calls on it:
  - each eye is an eyeball of its own, a glossy dome in the socket, meshed
    as its own shell so its outline stays clean. A dome in the skin's field
    came out ragged once the eyes were drawn black;
  - `alien.bin` flags the eyeballs' vertices in each normal's fourth byte,
    which was always 0, so the layout and size per vertex are unchanged and
    the scene can draw the eyes black as the owner's picture has them. The
    renders draw them black in both looks;
  - the squeezed face's smaller features are scaled up together
    (`SQ_FACE`), its eyes sink deeper in puffier rims, and its mouth is
    pushed further;
  - the squeeze already was the normal mesh moving, one shape key, and
    stays so: the eyeballs move by the same eye-to-eye map as the warp, so
    the scene can blend it from 0 to 1. The renders now show the
    in-betweens (a quarter, half, three quarters) to check that blend.
- 2026-10-28, the owner on round 3: "1. make eyes bigger. 2. don't shrink
  them when u shrink head. 3. add tiny smile". My calls on it:
  - "shrink head" read as the squeeze, the owner's own word for it in the
    brief, and as in shrunk.png, where the eyes stay big on the small head;
  - the eyes are 1.2 times the picture's size;
  - in the squeeze the eyeballs keep their size and wrap round the ball
    (`wrap_eye`, which keeps distances along the surface); the squeezed
    sockets and rims are laid out in the same wrapped coordinates, and 12
    landmarks round each socket's lip hold the skin to them. The ball is a
    little wider to hold them;
  - the smile bends the mouth's slit and lips up at the corners
    (`MOUTH_SMILE`); at the first, smaller bend it barely read up close. The
    squeezed mouth stays pursed, as in shrunk.png.
- 2026-10-26, the owner on drawing him live (#750): "if i wanna have more
  then one of them can we render? if i wanna have more freedom for camera +
  smoothenest i think render is preferable". Built on 2026-10-28 (#751): the
  scene draws the alien every frame and no longer plays the videos. They lost
  on more than one alien and a free camera (each loop had its camera baked
  in), on a slow Move (the 120 fps videos repeat frames below about 0.5× on
  a 60 Hz screen, and browsers pause them below 0.07×), on iOS's play()
  rules, and on 4.3 MB per visitor. My calls in building it:
  - Bounce squashes the figure itself, about the floor point under his
    pelvis averaged over the loop: the point the bake's pivot was projected
    from. Beside the old picture squash it is the same dip, without the
    frame's edges, and near parts move more than far ones (Measurements).
  - No playback floor. The eased speed nears 0 in silence without reaching
    it, so under `HELD_BELOW` (it reads 0.00×) he holds still and the
    readout says "held".
  - The quality preset's bloom passes now apply: high and mid draw both blur
    levels, as the bake did; low draws one, the floor quality none.

## Tuning notes

- Move's slider multiplies the wire: 1 plays a loud song at about captured
  speed. Raise it for a faster dance on quiet material.
- Bounce's slider is the depth; its spring (`BOUNCE_HZ`, `BOUNCE_DAMPING`)
  sets how snappy it is and how far it overshoots. Bounce smoothness eases
  that spring toward `SMOOTH_HZ`, `SMOOTH_DAMPING`; if its smooth end sits
  too low on fast music, the damping is the knob that matters.
- Cut on Drop: every drop stands out (drops are rare, so nothing else on
  that signal teaches the floor). For regular cuts wire it to Bass hit: it
  cuts on a standout hit once each shot has lasted `MIN_SHOT_SEC`, and
  Cut threshold thins those out (see Measurements).
- Judge the look in loop 0 (`?loop=0`), whose framing is the closest to the
  reference.

## Known issues and next steps

- The first mount builds the mesh on the main thread: about 0.17 s on the
  M1 Pro, longer on a weak laptop, once per page. A gallery visit where the
  tile mounts pays it too. #773 swaps in the Blender model, loaded rather
  than built.
- At DPR 2 the live wire is crisper and stands out more than the stretched
  video did; the owner hasn't yet said whether that is the look.
- In the close-up the floor is far below the frame, so a squash reads as
  him dipping.
- A head nod can push the neck's top through the back of the skull: the
  neck and head are separate surfaces.
- Only one alien; the reference has a crowd.
- Portrait screens crop the 16:9 frames to their middle.
- About 5 of the mesh's triangles face inward at creases and are culled.
- The new model (#772) waits for the owner's verdict on round 4. Once in the
  scene (#773), its extra height needs the loops' cameras reframed, or the
  figure scaled: they frame today's 2.15 m alien.
- In the new model's arms-down check the shoulders go a little square, the
  usual cost of automatic weights from a T-pose.
- Where the skull's fold was relaxed out, a small knot of tiny triangles
  is left among the big ones; it shows in the side close-up.

## Materials

- The bake, now optional: `tools/alien-bake.mjs` (its header has the
  command) and the bake page `tools/alien-bake/index.html`.
- Working scripts: `alien/scripts/`. `shot.mjs` takes headless shots,
  `realmusic.mjs` drives a fake mic and logs the player, and `mkwav.py`
  builds the music/hiss/music test file. `summarize.py`, `simhold.py` and
  `cutsum.py` (Cut: cut times, hit peaks, the dotted line) read the logs. `meshcheck.ts` and `clipcheck.ts` run under
  `node --experimental-strip-types`, and `tile.py` makes contact sheets.
  `glide.mjs` logs the dance's place on every render at a low Move and
  `readout.mjs` reads the Move readout (Resume here has both). `playcheck.mjs`
  checked the old video player in Chromium or WebKit, optionally with
  play() refused until a click, the way iOS refuses it.
- Reference media: `tools/.cache/refs/alien-dance/` (local only).
- The new model (#772): `tools/alien-model/exportRig.ts`, `build.py` and
  `check.ts`, run as in Resume here. It is original work, modelled by script
  from shapes and measurements. Inspiration, all local and never in this
  repo:
  - the owner's two web pictures, a green alien head and the same kind of
    head squeezed, in `tools/.cache/alien-design/owner-refs/`;
  - round 1's B, our own design picture (#753), in
    `tools/.cache/alien-design/round1/b-sleepy.png`, and round 2's side view
    for the skull's depth.

  The outputs go to `tools/.cache/alien-model/`: `rig.json`, `alien.bin`,
  `alien.blend` and `renders/`.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=128#/v/alien`. Add `&loop=<n>`
  to pin one loop.
- The scene draws live, so a change to the alien, a loop or the look shows
  at once; nothing needs rebaking. The old videos stay as they are (a tab on
  an older build may still fetch them).
- Slow Move: `node docs/scenes/alien/scripts/glide.mjs <wav> --port <p>
  --move 0.1` logs the dance's place on every render and counts stalls.
  `readout.mjs <wav> <outPrefix> --port <p> --at 12,36` reads and shoots the
  Move readout at those seconds (a song then silence shows both states).
- Real music: `node docs/scenes/alien/scripts/realmusic.mjs <wav> out.json
  --port <p>` (add `--cut anim.lowOnset` to wire Cut to Bass hit). Synthetic
  audio always reads loud, so it can't test silence.
- Gotcha: `__viz.probe()` doesn't carry drive readings. Read
  `window.__alien.last` instead.
- Rebuild the new model: `node --experimental-strip-types
  tools/alien-model/exportRig.ts`, then
  `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P
  tools/alien-model/build.py` (Blender is not on PATH; add `-- --quick` for a
  rough 4 mm draft, `-- --no-render` to skip the renders), then
  `node --experimental-strip-types tools/alien-model/check.ts`. The
  references live under the main checkout's `tools/.cache/`; a worktree needs
  that folder linked in.

## History

- #373 (2026-10-05, closed): the scene, built on #368 for the Level signal.
- #374 (merged 2026-10-05): the same, rebased after #368 merged, plus the
  Play readout; then baked loops, Move, Bounce, and Cut on Drop.
- #389 (draft, 2026-10-06): Bounce smoothness.
- #405 (draft, 2026-10-06): Cut fires on the shared standout detector
  (`src/render/standout.ts`), with a Cut threshold row and the "reach to cut"
  line on its graph.
- #389 (merged 2026-10-06): Bounce smoothness.
- #407 (draft, 2026-10-06): Move on iPhone and iPad (videos in the page, unlock on the
  first tap, a playhead scrub where play() is refused).
- #532 (2026-10-15): the loops moved to `public/media/alien/` and download
  the first time the scene or its tile mounts, not on every page load; a
  show (the pop-out, a room with another device) still fetches them up front.
  Measured headless, cache off: a 1280×800 gallery visit fetched 5351 KB
  before and 735 KB after; a deep link to Alien still fetches its three
  loops (about 4.3 MB), and so does a 1920×1080 gallery, where its tile mounts.
- #753 (2026-10-27, closed): three rounds of design pictures; the owner
  picked B's body, their own head picture and its squeeze, and Blender.
- #778 (draft, 2026-10-27, for #772): the new model built in Blender by
  script, round 1 of its renders sent to the owner.
