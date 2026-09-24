# Dancers (`dancers`)

A single raymarched skeleton dances real captured motion to the music, on a
fixed low camera with a beat bob. Draft scene (in `DRAFT_SCENE_IDS`), not yet
featured, registered at `minQuality: "floor"` so it also runs on TV presets.

## Where the code is

- `src/render/scenes/dancers/index.ts` — the scene entry (`DANCERS_ID`,
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
- `clipFormat.ts` / `clips.bin` / `player.ts` — the captured-motion pipeline:
  `decodeClipLibrary` reads the binary clip library (mirrors derived on
  load), `createClipPlayer` turns bar-relative phase into a sampled pose
  with a bar-boundary picker and two handover modes (`BlendMode`:
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
  CMU trial and frame range it came from.
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

The dance clips in `clips.bin` are retargeted from the CMU Graphics Lab
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
- More CMU moves are just additional `tools/clip-cuts.json` entries away;
  no pipeline work needed to add them.
- Other characters as alternative skins were discussed as a further-out
  idea, not agreed as committed work.
- Still a draft scene (`DRAFT_SCENE_IDS`), not yet promoted to featured.

## Materials

- Artifact: [Dancing Figures Decision Guide](https://claude.ai/artifact/82iRWoHJybg3nfxMp8M7H8). Source saved as `dancers/artifacts/dancing-figures-decision-guide.html`.
- Artifact: [Dancer Lab](https://claude.ai/artifact/BZwSRAM3ABZazqVQkXMYS3). Source saved as `dancers/artifacts/dancer-lab.html`.
- The motion-capture clips are in the code itself (`clips.bin`), credited in `THIRD-PARTY-NOTICES.md`.

## Resume here

- `npm run dev`, then open the Dancers scene directly, e.g.
  `/?audio=synthetic&bpm=120#/v/dancers` (query before the hash).
- To add a move: add a `tools/clip-cuts.json` entry, run
  `node tools/clip-convert.mjs --estimate <trial>` to get the joint-speed
  and heading trace, then run the converter to rebuild `clips.bin`, and
  check the result with `?clip=<name>`.
- A rig change invalidates every clip (`clipFormat.ts`'s binary layout
  checks the bone count against `BONE_COUNT`) — rebuild the clip library
  after any bone-table change in `rig.ts`.
- Gotcha carried over from the build session: CMU trials have no music, so
  tempo/beat placement for a new clip has to be pinned by hand in the cut
  list, not inferred from the source.

## History

- `#36` (`5417909`, 2026-08-30) — Dancers scene: raymarched skeleton, CMU
  mocap clip pipeline, choreographer, three renderers, two skins. Draft.
- `#69` (`88aab06`, 2026-09-03) — regrouped onto the shared `SettingGroup`
  vocabulary alongside caustics, chladni and meshGrid.
