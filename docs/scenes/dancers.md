# Dancers (`dancers`)

A single raymarched skeleton dances real captured motion to the music, on a
fixed low camera with a beat bob. Draft scene (in `DRAFT_SCENE_IDS`), not yet
featured, registered at `minQuality: "floor"` so it also runs on TV presets.

## Where the code is

- `src/render/scenes/dancers/card.ts` — the scene's card, loaded with the page: id, name,
  `minQuality`, `SETTINGS` (with the option lists they use: `STYLES`, `BLENDS`,
  `RENDERERS`, `SKIN_NAMES`), the `gallery` record and `loadBody`. The body spreads the
  card, so the registered settings are the body's own objects. The skin shaders stay in
  the body, since the card may not import GLSL.
- `src/render/scenes/dancers/index.ts` — the body, loaded after first paint: the scene entry (`DANCERS_ID`,
  `dancersScene`): owns the camera, the raymarch loop and the `renderer` /
  `style` / `blend` / `skin` settings; delegates shape and colour to whichever
  skin in `SKINS` is selected.
- `rig.ts` — the bone hierarchy and forward kinematics, pure TS: `BoneSpec`,
  `Pose`, `forwardKinematics`, `packBones`, `RIG_GLSL` (the `boneLocal()`
  contract every skin builds on). Its header explains the coordinate and
  quaternion conventions in detail — read it before touching a skin or a move.
- `choreo.ts` — the choreographer (`createChoreographer`), a stateful
  layering of sway, the picked clip, the beat gate, the drop pose, jaw
  chatter and a slew backstop, in that order (see its header for why the
  order matters).
- `moves.ts` — the procedural fallback (`sway`, `dropPose`, `resetPose`) and
  the intent helpers (`armSwing`, `kneeFlex`, …) moves are authored with;
  `effectiveIntensity` is what the clip picker climbs on.
- `clipFormat.ts` / the clip library (`CLIP_LIBRARY_URL`, a file under `public/media/dancers/`) / `player.ts` — the captured-motion pipeline:
  `decodeClipLibrary` reads the binary clip library (mirrors derived on
  load), `createClipPlayer` turns bar-relative phase into a sampled pose
  with a bar-boundary picker and the handover modes (`BlendMode`:
  crossfade vs. inertialization). Clip phase is a function of bars elapsed,
  never wall time, so a clip can't drift off the beat.
- `sdf.ts` — shared raymarch primitives (`SDF_GLSL`) the skins build shapes
  from.
- `skeletonSkin.ts` / `stickSkin.ts` — the two skins: an anatomical
  LOD-aware skeleton (`SKELETON_SKIN_GLSL`, drops detail at low `uDetail`)
  and a deliberately featureless capsule rig (`STICK_SKIN_GLSL`) kept as a
  correctness reference for the rig itself.
- `fastRenderers.ts` — the two cheap renderers the `renderer` setting can
  pick instead of the raymarcher (analytic capsules, flat projected
  capsules), what lets the scene register at `minQuality: "floor"`; the
  raymarcher hands over to Capsules below `RAYMARCH_MIN_DETAIL`.
- `tools/clip-convert.mjs` + `tools/clip-cuts.json` (repo root, not under
  `src/`) — the offline converter that retargets a CMU BVH trial onto the
  rig and cuts it into a clip; `ClipMeta.source` on each clip records which
  CMU trial and frame range it came from. A cut with no `start` gets its
  loop from `findLoop()`; every clip's feet go through `polishFeet()`.
  `tools/clip-candidates.json` lists the CMU dance trials not in the library
  yet, uncut, for the converter's `--cuts`.
- Tests (pure, DOM/GL-free): `tests/dancersRig.test.ts`,
  `tests/dancersMoves.test.ts`, `tests/dancersChoreo.test.ts`,
  `tests/dancersClipFormat.test.ts`, `tests/dancersPlayer.test.ts`, plus
  `tests/dancersClips.helper.ts`.
- Plugs into the shared setting-group vocabulary in `src/render/sceneSettings.ts`
  (`SettingGroup`), not into drives/beatListener — the dance reads
  `MoveClocks` (beat phase, tempo lock, section intensity, drop pulse,
  etc.) built from the scene's own clock inputs rather than the newer
  per-setting drive system.

## Data credit

The dance clips in the clip library (`public/media/dancers/`) are retargeted from the CMU Graphics Lab
Motion Capture Database (mocap.cs.cmu.edu, funded by NSF EIA-0196217) via
Bruce Hahne's cgspeed BVH conversion, mirrored at
github.com/una-dinosauria/cmu-mocap. Full license terms and the source
listing (`tools/clip-cuts.json`) are recorded in `THIRD-PARTY-NOTICES.md`;
the data may be copied, modified or redistributed, and included in
commercially-sold products, but not resold directly even in converted form.

## References

The look was studied from the classic 3D dancing-skeleton GIF style — a
freestanding raymarched skeleton, not a mesh character. No `/ref` video
bundle: the motion itself comes from the CMU mocap database above, not from
a visual reference video, and the rig/shading/choreography design is
original work built around that data.

## Measurements

- 2026-10-28, feet. The retarget is faithful: on 05_02, 90_32, 90_33, 55_02
  and 60_02 our foot's pitch and shin-to-foot angle match the raw BVH within
  1°, so bad feet come from CMU's skeleton solve. Share of foot-frames with
  the shin-to-foot angle past a human ankle (over 119° or under 14°), and of
  standing foot-frames rolled over 25° or stood on the tip (more than 36°
  below the rest foot), `clips-v1.bin` → the converter with `polishFeet()`:

  | clip | past an ankle | rolled | on the tip |
  |---|---|---|---|
  | armup | 76% → 0% | 52% → 2% | 0% → 0% |
  | twist | 31% → 0% | 0% → 0% | 0% → 0% |
  | expressive | 0% → 0% | 26% → 3% | 96% → 17% |
  | armshigh | 6% → 0% | 55% → 0% | 75% → 0% |
  | toprock2 | 0% → 0% | 25% → 0% | 8% → 3% |
  | moonwalk | 0% → 0% | 0% → 0% | 56% → 11% |
  | salsa | 0% → 0% | 0% → 0% | 19% → 5% |
  | russian | 6% → 4% | 0% → 0% | 20% → 20% |

  The other eight clips were clean or within a few points. Over the 75
  trials in `tools/clip-candidates.json`, the means go 4.8% → 0.1% past an
  ankle, 4.4% → 0.7% rolled, 21.4% → 9.7% on the tip, and no clip got worse
  by more than 5 points on any of the three.
- 2026-10-28, loops. `scoreWindow()` on the hand cuts in `clip-cuts.json`,
  as the bar for found loops: seams 0.06–0.56 leg lengths (armup the worst),
  slides up to 0.68 apart from moonwalk's 3.22 (it travels by design).
- 2026-10-29, `clips-v2.bin` (the owner's 34): every clip matches the one
  reviewed on the candidates page within 0.5° per bone and 6 mm of root
  (the cut list pins bpm to 3 decimals). 634 KB, 548 KB gzipped, against
  `clips-v1.bin`'s 297 KB. `tune-real` on `deTJ513J07Y`, then silence, 30 s
  from 4 s, on the defaults, headless Chromium on Metal, main (before) and
  this branch (after) served side by side:

  | source | change med | change p95 | hits/min | energy | fps |
  | --- | --- | --- | --- | --- | --- |
  | song, before | 2.08 | 2.98 | 442 | 0.49 | 120 |
  | silence, before | 0.42 | 0.71 | 0 | 0.00 | 120 |
  | song, after | 2.07 | 2.86 | 440 | 0.48 | 120 |
  | silence, after | 0.42 | 0.73 | 0 | 0.00 | 120 |

  The silence rows are the procedural sway (`moves.ts`), as before; the
  song's p95 stands 3.9× above silence, 4.2× before.

## Decisions and pivots

- **2026-08-29/30 (#36):** planning settled the shape — raymarched SDF (not
  meshes, not flat 2D), a single hero dancer, a fixed low camera with a
  subtle beat bob.
- **2026-08-30 (#36):** an initial procedural (sine-wave) choreography read
  as "no moves" even after adjustment; the dance moved to captured motion —
  real CMU mocap clips phase-locked to the beat — instead. This is the
  scene's core creative pivot: procedural sway (`moves.ts`) was kept only as
  a no-beat fallback layer, not as the primary source of movement.
  Converter lessons from that build: retarget by frame-0 T-pose deltas with
  a per-bone swing, and turn each clip to its mean heading, since the CMU
  T-pose faces one way but a captured performance doesn't; CMU trials carry
  no music, so the converter's `--estimate` mode prints a joint-speed hit
  list and heading trace and the cut list pins start/beats/bpm by hand.
- **2026-09-03 (#69):** regrouped the scene's settings onto the repo-wide
  `SettingGroup` vocabulary (Form/Motion/Look/Camera/Post) alongside
  caustics, chladni and meshGrid — reordering only, no default/auto/macro
  values changed.
- Since #36, `minQuality` moved from the initial `"mid"` to `"floor"`: the
  addition of `fastRenderers.ts`'s two cheap renderers (Capsules, Flat) let
  the raymarcher hand over below `RAYMARCH_MIN_DETAIL`, so the scene now
  registers as runnable on every preset including the TV floor.
- 2026-10-02: review cleanup. `moves.ts` lost the helpers nothing called
  (`wristBend`, `lift`, `newPose`, the `lerpPose` re-export), and `rig.ts`
  now points at `clipFormat.ts` instead of a `clips.ts` that never existed.
- 2026-10-02: the Skeleton skin's lateral details are reflected per side.
  `rig.ts`'s `mirror()` keeps the rest rotation, so local +X is world -X on
  both arms and both legs, and the thumb and the forearm/shin twin bone
  landed on the same world side of each pair. `skel_map` now reflects `q`
  for the right hand and forearm and the left shin (thumbs and radius medial
  on both arms, fibula lateral on both legs). The Stick skin and the Capsules
  and Flat renderers are unaffected.
- 2026-10-02: the clip loop length (normal, half- or double-time) is now
  latched in `createClipPlayer` when a move starts, and re-read only when the
  picker comes back to it after its hold (restarting the loop on that
  downbeat). It was re-decided every frame from the raw `bpm`, so a wobble
  across `HALF_TIME_RATIO`/`DOUBLE_TIME_RATIO`, or a drop to 0 in a break,
  jumped the clip phase. `clipPhaseAt` stays for the DEV `?clip` path.
- 2026-10-02: `rig.ts`'s bone-index table `B` is built with a plain loop
  instead of `Object.fromEntries`. It runs at module load, which the TV
  bundle evaluates too, and the older TV runtimes the es2017 build target
  exists for lack `fromEntries`. Same table, same indices — no visual change.
- 2026-10-24: Id, name, settings and gallery record moved to `src/render/scenes/dancers/card.ts`, so the scene's code loads after the page's first paint. Nothing visible changed. (#536)
- 2026-10-28: the owner saw feet that "don't work that well with some
  moves" on Alien and asked for every CMU dance trial, "pre-polished". The
  converter now finds a loop when a cut has no `start` (`findLoop()`),
  cleans every clip's feet (`polishFeet()`; `--raw-feet` skips it), closes
  each loop with a one-beat crossfade into the beat before frame 0 instead
  of a short blend toward a frozen frame 0, and writes only `ClipMeta` into
  the library (`clips-v1.bin` carries each trial's tempo estimate). The feet
  rule limits only the shin-to-foot angle, never a turn read in the shin's
  own frame, because the solve flips some feet half a turn about their
  length (90_30); a standing foot whose top faces down is left as captured.
  No toe bone: on the ball of the foot the whole foot still tips.
- 2026-10-29: the owner marked the candidates page and said "save all that
  i marked keep. ignore rest". `tools/clip-cuts.json` now holds those 34:
  toprock2, toprock3, charleston and charleston2 from before, and 30 new
  ones with their found start, beats and bpm pinned. My reading, not
  asked: the clips marked Drop (the other 12 old ones) left the library.
  All four families still have clips; Alien took the new list as its
  dances (`docs/scenes/alien.md`). `clips-v1.bin` stays for older tabs.
- 2026-10-30, #802: Jaw chatter and Camera move's roll moved from the bass
  hit to the Kick.
  - tune-real on a real song (around-the-world) then silence, main → this
    change: song change median 2.15 → 2.10, p95 3.06 → 3.00; silence
    median 0.41 → 0.42, p95 0.74 → 0.73; hits a minute on the song 428 →
    426, in silence 0 → 0; main's bass / mid / treble lanes 150 / 140 /
    242 a minute against kick / clap / hats / chord 122 / 42 / 278 / 128.

## Tuning notes

- Judge the look in the raymarched **Skeleton** skin first — the **Stick**
  skin exists specifically so a bad move reads as a rig bug rather than a
  skin bug; if Stick looks wrong, the fault is in `rig.ts`/`choreo.ts`, not
  the skin GLSL.
- The `renderer` setting trades look for cost: Raymarch (full 3D shading),
  Capsules (analytic ray–capsule hits, still real occlusion/lighting, no
  marching), Flat (2D projected capsules, cheapest, crisp edges). The
  `fastMarch` toggle trims the raymarcher's own step budget and detail
  without switching renderer.
- `style` picks a clip family (or the full mix); `blend` picks the handover
  mode between clips — crossfade keeps both clips dancing and slides the
  pose, inertialization decays the offset from the old pose while only the
  new clip plays, so a drop lands harder.
- `?clip=<name>` (DEV override, per `clipFormat.ts`/index.ts) loops one clip
  in isolation — the fastest way to check a single move without the picker
  cycling through the library.

## Known issues and next steps

- Goofy internet dances (Floss, Woah, Griddy — simple routines only, not
  ones under separate registration like the Renegade) were agreed as a
  follow-up via a film-yourself → offline pose-estimation (WHAM / 4D-Humans
  style) → the same `clip-convert.mjs` input pipeline. Not started.
- The 45 CMU dance trials the owner didn't keep stay listed in
  `tools/clip-candidates.json`, for another look one day.
- Feet: a toe bone would let the ball of the foot bend instead of the whole
  foot tipping; it changes `BONE_COUNT`, so every clip, both skins and
  Alien's mesh with it.
- Other characters as alternative skins were discussed as a further-out
  idea, not agreed as committed work.
- Still a draft scene (`DRAFT_SCENE_IDS`), not yet promoted to featured.

## Materials

- Artifact: [Dancing Figures Decision Guide](https://claude.ai/artifact/82iRWoHJybg3nfxMp8M7H8). Source saved as `dancers/artifacts/dancing-figures-decision-guide.html`.
- Artifact: [Dancer Lab](https://claude.ai/artifact/BZwSRAM3ABZazqVQkXMYS3). Source saved as `dancers/artifacts/dancer-lab.html`.
- The motion-capture clips are in the repo (`public/media/dancers/`, named by `CLIP_LIBRARY_URL`), credited in `THIRD-PARTY-NOTICES.md`.
- Artifact: [Dance Candidates](https://claude.ai/artifact/YXxsV7tonmgFbdqrMLHtko) (2026-10-28) — every candidate and library clip on a stick figure, feet before and after `polishFeet()`, with Keep/Maybe/Drop saved in its `picks` collection. Built from untracked `tools/.cache/clip-candidates/page/` (the converter's output as base64 text, and `rig.ts` + `clipFormat.ts` bundled by esbuild).

## Resume here

- `npm run dev`, then open the Dancers scene directly, e.g.
  `/?audio=synthetic&bpm=120#/v/dancers` (query before the hash).
- To add a move: add a `tools/clip-cuts.json` entry, run
  `node tools/clip-convert.mjs --estimate <trial>` to get the joint-speed
  and heading trace, then run the converter (it writes the next `clips-v<n>.bin`; point `CLIP_LIBRARY_URL` at it and add it to `tests/mediaManifest.ts`), and
  check the result with `?clip=<name>`.
- A rig change invalidates every clip (`clipFormat.ts`'s binary layout
  checks the bone count against `BONE_COUNT`) — rebuild the clip library
  after any bone-table change in `rig.ts`.
- CMU trials have no music. A cut without `start` lets `findLoop()` place
  the beats; pin `start`/`beats`/`bpm` by hand only when its pick looks off.
- Candidates: `node tools/clip-convert.mjs --cuts tools/clip-candidates.json
  --out <file> --report <json>` (add `--raw-feet` for the before).

## History

- `#36` (`5417909`, 2026-08-30) — Dancers scene: raymarched skeleton, CMU
  mocap clip pipeline, choreographer, three renderers, two skins. Draft.
- `#69` (`88aab06`, 2026-09-03) — regrouped onto the shared `SettingGroup`
  vocabulary alongside caustics, chladni and meshGrid.
- #532 (2026-10-15) — the clip library moved to `public/media/dancers/`
  and downloads the first time the scene mounts, not on every page load; a
  show (the pop-out, a room with another device) still fetches it up front.
  Measured headless, cache off: a deep link to Dancers fetched 5363 KB
  before and 1037 KB after, 290 KB of it the clip library.
- #788 (draft, 2026-10-28/29): the converter finds loops and cleans feet;
  75 CMU dance trials reviewed as candidates; `clips-v2.bin` holds the
  owner's 34.
