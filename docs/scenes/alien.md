# Alien (`alien`)

One grey alien dancing as a glowing green wireframe on black, in short
loops: each loop is one captured dance seen from its own angle, drawn live
every frame. The music pays for the frames: the Move setting's wire sets how
fast the dance on screen plays, and silence holds him still. Bounce squashes him toward
the floor and springs him back on its wire's hits; Bounce smoothness turns
that spring from a snap and a wobble into an ease and a glide. A loop repeats
until the Cut setting's wire makes a hit that stands out from its everyday
ones (the dotted line on its graph). Dance holds one dance, and Cut then
waits; View shows every dance through one loop's camera, and the camera
sliders under it (the arrow keys too) move that camera by hand. In
development, on main since #374.

## Where the code is

- `src/render/scenes/alien/card.ts`: the scene's card, loaded with the page: id,
  name, `SETTINGS`, the Motion section in `PANEL`, `MOVE_GAIN`, the `gallery`
  record and `loadBody`, and `arrows`: which camera sliders the arrow keys
  move (`src/ui/sceneArrows.ts` handles the keys for any scene). The body
  spreads the card, so the registered settings are the body's own objects.
- `camera.ts`: the camera by hand: `handCamera()` moves the view by the
  Camera sliders, `easeHand()` glides them.
- `src/render/scenes/alien/index.ts`: the body, loaded after first paint. It
  loads the model and the dancers' clip library (`sceneMedia`, both fetched
  on the first mount and decoded once per page; black until both land), keeps
  each loop's place in its clip, samples the pose and has `renderer.ts` draw
  it. Also the `?loop=<n>` DEV pin and the
  `window.__alien` DEV hook (reel, last wire readings, each loop's place).
- `meshFile.ts`: `MESH_URL`, the model the scene draws
  (`public/media/alien/mesh-v1.bin`, ALM1 from `tools/alien-model/build.py`),
  and `decodeAlienMesh()`, which de-indexes it into an `AlienModel`: mesh.ts's
  `AlienMesh` plus each vertex's eye flag and the squeeze shape key (#774).
- `renderer.ts`: the model drawn live (mesh pass, bloom, composite) through a
  loop's camera, into this device's slice of the room, with Bounce's squash;
  `floorPivot()` finds the floor point the squash pulls toward.
- `reel.ts`: the `VIEWS` table (the cameras, each with its View chip's
  name), the `LOOPS` table (per loop: clip, Dance chip name and the view it
  is seen through; `LOOP_VIEW` resolves those), `chipLoop()` and
  `chipView()` (which loop or view a chip holds) and the rules:
  `easeSpeed()` (Move), `stepCut()` (Cut), `stepBounce()` (Bounce) and
  `bounceSpring()` (Bounce smoothness). Its header has them in words.
- `glsl.ts`: the look: GPU skinning, Bounce's squash on the skinned figure,
  the barycentric wireframe, the fresnel rim and outline, the eyeballs drawn
  black, the blur and composite.
- The old baked videos, `public/media/alien/loop{0,1,2}-v1.mp4`, are no longer
  played. They stay for tabs on an older build (`src/pinnedAssets.ts`'s
  header, "Scene media"), baked from `clips-v1.bin` through the first three
  views, which the tests check them against. `loops/manifest.ts` (`BAKED`) lists them, and the
  bake that made them still works but is optional: `bakePage.ts` (served by
  `tools/alien-bake/index.html` on the dev server) draws any frame of any
  loop, and `tools/alien-bake.mjs` saves every frame and encodes each loop
  with ffmpeg.
- `body.ts` and `mesh.ts`: the alien drawn until #773, no longer drawn.
  `body.ts` is his shape as data (`PARTS`, each part on a rig bone) and its
  distance field; `mesh.ts` turns it into a skinned triangle mesh
  (`buildAlienMesh()`). The scene still takes `bindPose()`, `MAX_INFLUENCES`
  and the `AlienMesh` type from `mesh.ts`, and the tests,
  `tools/alien-model/check.ts` and `exportRig.ts` use both files. Whether
  they stay is the owner's call.
- `src/ui/widgets/alienPlay.ts`: the Move readout under the Move row: speed,
  frames bought per second, the loop on screen, and the loop as a strip of
  its frames with the playhead. Fed by the scene's `probe()`.
- `tools/alien-model/`: the alien the scene draws, built headless in Blender
  (#772). `exportRig.ts` writes the rig's bind pose for Blender, `build.py`
  builds the model and writes `alien.bin` and the renders, `check.ts` reads
  `alien.bin` beside the old mesh. `build.py`'s header has the method and the
  file layout. `alien.bin` is committed as `public/media/alien/mesh-v1.bin`.
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
  Our alien is an original model, built by script in Blender
  (`tools/alien-model/`); nothing of the video's mesh, motion or frames is
  used.
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
- 2026-10-28, the Blender model in the scene (#773), headless Chromium on
  Metal on the owner's M1 Pro, main (the old mesh) served beside the branch:
  - `mesh-v1.bin` is `check.ts`'s round-4 build, rebuilt byte for byte from
    `build.py` on main: 10,246 vertices, 20,480 triangles (the eyeballs 480),
    532,732 bytes. The old mesh was 20,304 triangles.
  - Decoding it in the page (`scripts/loadcheck.mjs`, 14 decodes over two
    page loads) took 1.7–3.0 ms in 12 of them, and 6.5 and 22.9 ms in the
    other two; building the old mesh took 160–173 ms on the first mount.
  - Opening Alien, deep-linked or from the gallery, fetches
    `/media/alien/mesh-v1.bin` and `/media/dancers/clips-v1.bin` once each,
    and no `.mp4`. The gallery alone (1512×945) fetches nothing.
  - With the old mesh passed to the renderer, the bake page's
    `frame(0, 0.25)` is the same PNG byte for byte as main's, with and
    without the eye attribute (every flag 0).
  - GPU per frame at 3024×1890, quality high, by `gpu-bench --scenes alien`
    (the bench page waiting 1.5 s after `init`, a local edit as in #751),
    eight rounds alternating: main 1.69–4.85 ms (median about 2.8), the new
    model 2.33–4.07 ms (about 3.4). Another load on the GPU swung both 2–3×
    within minutes, so the two can't be told apart. In-app per-draw
    (`--app --dpr 2`), two rounds each: the mesh pass 1.15 and 1.39 ms on
    main, 0.94 and 1.51 ms new, all passes at the same 120/60 draws per
    second. The weak-laptop run #556 asks for has still not been made.
  - Framing, the lit pixels along the top row of each bake frame (1920×1080,
    phases 0.1, 0.35, 0.6, 0.85): main touches the top in 4 of 12 frames
    (loop 0 three, loop 1 one), the new model with the same cameras in 11 of
    12, loop 2 included. With each camera's eye and target scaled about the
    floor by the height ratio, 2.365 / 2.148, the new model sits in the frame
    as the old one did.
  - Loop 0's deepest nod, 56° between head and neck at phase 0.1
    (`scripts/nodcheck.ts`), seen from behind his left shoulder: the old
    neck stands apart from the skull; the new one runs into it.
  - `tune-real` on `deTJ513J07Y`, then silence, 30 s from 4 s:

    | source | change med | change p95 | hits/min | energy | fps |
    | --- | --- | --- | --- | --- | --- |
    | song, old mesh | 1.29 | 2.23 | 452 | 0.49 | 120 |
    | song, new model | 1.77 | 2.48 | 450 | 0.48 | 119 |
    | silence, old mesh | 0.00 | 0.00 | 0 | 0.00 | 120 |
    | silence, new model | 0.00 | 0.00 | 0 | 0.00 | 120 |

    Silence, both times: "the picture holds still". The bigger figure covers
    more of the frame, so more of the picture changes on the song.
- 2026-10-28, ten more moves, headless Chromium on Metal on the owner's M1
  Pro:
  - How much each library clip moves (`energy`, the joints per beat) and
    reaches (`bigness`, the hands from the body), both relative to the
    library: twist 1.00 / 0.87, russian 0.83 / 1.00, toprock2 0.60 / 0.76,
    toprock3 0.50 / 0.58, charleston2 0.45 / 0.28, charleston 0.43 / 0.42,
    salsa 0.29 / 0.50, expressive 0.29 / 0.35, salsa2 0.27 / 0.49, chicken
    0.16 / 0.78, lambada 0.12 / 0.96, moonwalk 0.12 / 0.22, armup 0.08 /
    0.70, macarena 0.06 / 0.69, toprock 0.06 / 0.00, armshigh 0.00 / 0.03.
  - Every clip dances in place: `clipcheck.ts` puts the root within 0.36 m
    of the origin in all of them, so a fixed camera keeps each in frame.
  - Framing, `framecheck.py` on `bakeframes.mjs` frames at 1280×720, eight
    phases a loop: none of the ten new loops touches the top in any frame.
    Macarena and lambada are cut at the knees in all eight frames, chicken
    in four. On the first try, moonwalk touched the
    top in 2 of 8 frames and lambada in 1, before their cameras moved.
  - `tune-real` on `deTJ513J07Y`, then silence, 30 s from 4 s:

    | source | change med | change p95 | hits/min | energy | fps |
    | --- | --- | --- | --- | --- | --- |
    | song | 0.61 | 0.84 | 462 | 0.48 | 120 |
    | silence | 0.00 | 0.00 | 0 | 0.00 | 120 |

    Silence: "the picture holds still". On the song the reel had cut to
    salsa, a full-body shot from further back, before its contact sheet was
    taken; he covers less of the frame there than in loop 0's close-up, so
    less of the picture changes. The rules for Move, Bounce and Cut are
    unchanged.
- 2026-10-28, the Dance and View rows, headless Chromium on Metal on the
  owner's M1 Pro, synthetic audio at 128 bpm, chips pressed with real mouse
  presses:
  - Dance on Moonwalk, then Russian: the scene shows that loop at once (the
    readout says "loop 6 of 13 · moonwalk", then "loop 7").
  - View on Close front shows Moonwalk through loop 0's close-up; on Side,
    Russian through Moonwalk's side camera.
  - Cut wired to Bass hit: 4 cuts in 10 s on Any, none in 10 s with Salsa
    held.
  - `tune-real` on `deTJ513J07Y`, then silence, 30 s from 4 s, with Dance
    on Any and View on Own (the defaults):

    | source | change med | change p95 | hits/min | energy | fps |
    | --- | --- | --- | --- | --- | --- |
    | song | 0.54 | 0.84 | 444 | 0.49 | 120 |
    | silence | 0.00 | 0.00 | 0 | 0.00 | 120 |

    Silence: "the picture holds still". The defaults play as before; the
    song's numbers move with whichever dance the cuts land on.
- 2026-10-28, the camera by hand, same set-up, keys pressed with
  Playwright's keyboard:
  - With nothing focused, 18 presses of → stored Orbit 90, 5 of ↑ Tilt 15
    and 10 of Shift+↓ Distance 1.5; the HUD named each value.
  - With the panel open during the presses, its Orbit and Distance
    sliders moved with them (−30 and 0.80 after 6 × ← and 4 × Shift+↑).
  - With the View row focused, → stepped its chip (Own to Close front) and
    left the camera alone; a click on the picture moved focus to the page,
    and the arrows moved the camera again.
  - Save look stored Dance, View and the five camera sliders in the look.
  - `tune-real` on `deTJ513J07Y`, then silence, 30 s from 4 s, on the
    defaults (the camera at rest is exactly each loop's own):

    | source | change med | change p95 | hits/min | energy | fps |
    | --- | --- | --- | --- | --- | --- |
    | song | 0.77 | 1.92 | 452 | 0.49 | 120 |
    | silence | 0.00 | 0.00 | 0 | 0.00 | 120 |

    Silence: "the picture holds still". The song's p95 is above the run
    before because the cuts landed on closer views this time (loop 0's
    close-up alone measured 1.77 / 2.48).
- 2026-10-29, the owner's dances from `clips-v2.bin`, headless Chromium on
  Metal on the owner's M1 Pro:
  - Framing, measured off screen: the real model (`mesh-v1.bin`) skinned on
    the CPU over 32 frames of each loop and projected through each view
    into a 16:9 frame. Every new dance has at least one view where he never
    touches an edge; the one picked fills 0.66 (Break flips, Front) to 0.95
    (Egyptian 3, High left) of the frame's height. toprock2 through Floor up
    still loses his head off the top in 66% of frames (Known issues).
  - Shots with `?loop=` of Break flips, Egyptian 3, Salsa, Cartwheel and
    Lean back: each whole in its frame.
  - `tune-real` on `deTJ513J07Y`, then silence, 30 s from 4 s, on the
    defaults, main (before) and this branch (after) served side by side:

    | source | change med | change p95 | hits/min | energy | fps |
    | --- | --- | --- | --- | --- | --- |
    | song, before | 1.50 | 2.70 | 434 | 0.48 | 120 |
    | silence, before | 0.00 | 0.00 | 0 | 0.00 | 120 |
    | song, after | 0.25 | 0.59 | 428 | 0.48 | 120 |
    | silence, after | 0.00 | 0.00 | 0 | 0.00 | 120 |

    Silence: "the picture holds still" on both. Less of the picture changes
    on the song because Expressive's close-up, the loop the reel opens on
    before, left with the dances the owner dropped: every kept dance is a
    full-body shot. The rules for Move, Bounce and Cut are unchanged.

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
- 2026-10-28, the owner on the review page's two looks (at DPR 2 the live
  wire is crisper and stands out more than the stretched video did; Bounce
  squashes the 3D figure): "good". Both kept as built.
- 2026-10-28, the Blender model in the scene (#773). The owner merged #778
  after round 4's renders without further words; that merge is taken as the
  approval #773 waits for. My calls in putting it in:
  - The eyeballs draw black, wire and all, as round 3 and 4's renders drew
    them in the wire look. The socket's wall draws each eye's outline.
  - The model loads as scene media, decoded once per page, instead of being
    built: 533 kB fetched once, about 2 ms to read.
  - The cameras stay as they are until the owner picks: today his head runs
    off the top in every loop. The review page shows each loop three ways,
    old, new and new with the camera pulled back by the height ratio:

    https://claude.ai/artifact/MvAMT5riBQ29A98F6waM91

- 2026-10-28, the owner: "can we add more moves for alien?". I read
  "moves" as dances, not new reactions to the music, and didn't ask. Ten
  more loops, all from the dancers' clip library the scene already
  fetches, so nothing new downloads. My calls:
  - Left out: armshigh (the stillest clip in the library), toprock (a
    4-beat cut of toprock2, already in) and salsa2 (nearly salsa).
  - Each new loop has its own camera, framed for the Blender model's height,
    and most are full body, since these dances are mostly in the legs.
    Moonwalk is seen side on, the only angle where its glide reads.
  - Cut still picks at random among all the other loops.
  - The baked videos stay the first loops; nothing rebakes.
  - The review page plays one full loop of each new move, for the owner to
    drop moves or change cameras:

    https://claude.ai/artifact/A2YaDxiZPZWxEi6uEPwXq3

- 2026-10-28, the owner: "i wanna polish moves. can u expose some control
  to manually switch moves. also expose different camera views". My calls,
  not asked:
  - **Dance**, a row of chips: Any (the default, Cut picks as before) or
    one dance, which he keeps doing while Cut waits. It sits at the end of
    the Motion section, under Bounce smoothness, and is named Dance because
    Move already names the speed.
  - **View**, a row of chips in Camera above Cut: Own (the default, each
    dance through its own camera) or one loop's camera for every dance. The
    views are the loops' cameras, each named for where it stands; no new
    camera was added. Cut still changes only the dance.
  - Neither row is wired to the music.
  - Saved looks keep a chip by its place in the row, so a new loop goes at
    the end of `LOOPS`.
- 2026-10-28, the owner: "is it possible to add some kind of manual control
  over camer and abiliuty to save satting?", then, after my answer (camera
  sliders, saved by the Looks card's Save look, perhaps a Copy camera
  button): "can we export control to keyboard to. arrows? build it". My
  calls:
  - Five sliders in Camera, under View: **Orbit** (round him, degrees),
    **Tilt** (over or under him, degrees), **Distance** (times the view's
    own), **Height** (camera and aim lifted together, metres) and **Zoom**
    (times the view's focal length). They are offsets on whichever view is
    on screen, so at rest every view is exactly the loop's camera, and a
    cut keeps them. The drawn camera eases to them over `HAND_EASE_SEC`, so
    a held key glides; a cut or a new View chip still jumps. Tilt stops at
    `PITCH_LIMIT`, short of straight down.
  - The arrow keys: ← → Orbit, ↑ ↓ Tilt, Shift with ↑ ↓ Distance (↑ is
    closer), each press a step the card's `arrows` sets. Height and Zoom are
    sliders only. Alt and Option are left alone: they already play to the
    output window. The keys reach the scene only while no slider, text field
    or chip row has focus, so a focused View row still steps its chips. Any
    scene can name its own arrow settings the same way (`SceneArrows`,
    `src/ui/sceneArrows.ts`); the keys list (`?`) has a Camera row.
  - Master Scale leaves the camera sliders alone (`masterScale: false`):
    scaled, the camera would move whenever someone turned Master.
  - Saving is the Looks card's Save look, as for every other setting. No
    Copy camera button: the owner answered with keys, not that.
- 2026-10-29, the owner marked every clip on the Dance Candidates page
  (`docs/scenes/dancers.md`, Materials) and said "save all that i marked
  keep. ignore rest". The dancers' library became those 34 clips
  (`clips-v2.bin`): of the old dances only Toprock 2, Charleston,
  Charleston 2 and Toprock 3 stay, joined by 30 new ones. My reading, not
  asked: the clips marked Drop leave, Expressive and Twist with them.
  - The cameras moved out of `LOOPS` into `VIEWS`, so the View row stays at
    its 13 cameras, each at its old index, instead of growing a chip per
    dance; a view no dance uses (Close front, High right) stays a chip.
    Each loop names its view; the new dances took existing views, picked by
    the framing measure (Measurements), and none needed a new camera.
  - Dance chip indexes moved: the dropped dances left the middle of the
    row. The rows are on Insiders only (#786, after Stable v0.2.0), so at
    most a day of saved looks lands on a different dance.
  - The bake test now checks the old videos against `clips-v1.bin` and the
    first three views, the library and cameras they were baked from.
- 2026-10-30, #802: Bounce's wire moved from the bass hit to the Kick.
  - tune-real on a real song (around-the-world) then silence, main → this
    change: song change median 0.71 → 0.67, p95 1.22 → 1.24; silence
    median 0.00 → 0.00, p95 0.00 → 0.00; hits a minute on the song 424 →
    410, in silence 0 → 0; main's bass / mid / treble lanes 160 / 128 /
    242 a minute against kick / clap / hats / chord 112 / 32 / 272 / 118.

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
- To polish one dance, hold it on Dance and step through View; the strip's
  arrow keys move chip by chip. Then click the picture, so no row has focus,
  and fly the camera with the arrows; Save look keeps the framing.

## Known issues and next steps

- In the Close front view the floor is far below the frame, so a squash
  reads as him dipping.
- Only one alien; the reference has a crowd.
- Portrait screens crop the 16:9 frames to their middle.
- He is 2.37 m tall against the old 2.15 m, and the first three views
  (those with baked videos) still frame the old height, so his head runs
  off the top in each of them. Toprock 2, the dance the reel opens on, is
  seen through Floor up. The owner's call on pulling them back is open
  (Decisions). The views after them frame the new height.
- Every dance is a full-body shot now, so he is smaller on screen than in
  the old opening close-up and less of the picture changes on a song
  (Measurements, 2026-10-29). Which dance opens the reel, and whether one
  gets a close view, is the owner's call.
- The Dance row has a chip per dance, 34 of them after Any.
- The model has 7 slivers under 4°, 6 of them at the eyeballs' corners,
  which draw black.
- In the model's arms-down check the shoulders go a little square, the
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
  `readout.mjs` reads the Move readout (Resume here has both).
  `bakeframes.mjs` saves the bake page's frames at given loops and phases,
  for before and after pictures of the same moment; `loadcheck.mjs` logs what
  opening the scene fetches, times the model's decode, and shoots the scene
  at a DPR; `nodcheck.ts` finds each loop's deepest nod. `framecheck.py`
  reads `bakeframes.mjs`'s frames and counts the ones where he touches an
  edge. `loopframes.mjs` saves one full loop of each loop in a range, and
  `loopwebp.py` turns those into the animations on the moves' review page. `playcheck.mjs`
  checked the old video player in Chromium or WebKit, optionally with
  play() refused until a click, the way iOS refuses it.
- Reference media: `tools/.cache/refs/alien-dance/` (local only).
- The model (#772): `tools/alien-model/exportRig.ts`, `build.py` and
  `check.ts`, run as in Resume here. `public/media/alien/mesh-v1.bin` is
  `build.py`'s `alien.bin`. It is original work, modelled by script
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
- A changed model is a new file: rebuild as below, copy `alien.bin` to
  `public/media/alien/mesh-v2.bin`, point `MESH_URL` at it, and add the line
  `npx vitest run tests/sceneMedia.test.ts` prints to
  `tests/mediaManifest.ts`. `mesh-v1.bin` stays for open tabs.
- Rebuild the model: `node --experimental-strip-types
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
- #782 (draft, 2026-10-28, for #751): the scene draws the alien live, Bounce
  squashes the figure itself, and the videos stay only for older tabs.
- #778 and #782 (merged 2026-10-28).
- #784 (draft, 2026-10-28, for #773): the scene draws the Blender model,
  loaded as `mesh-v1.bin`, with black eyes; the framing waits for the owner.
- #785 (merged 2026-10-28): ten more dances from the clip library, each
  with its own camera framed for the new model.
- #786 (draft, 2026-10-28): the Dance and View rows, then the camera by
  hand: five Camera sliders and the arrow keys.
- #788 (draft, 2026-10-29): the owner's 34 dances from `clips-v2.bin`,
  cameras in `VIEWS`, each new dance through a measured view.
