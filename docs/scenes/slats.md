# Slats (`slats`)

A monochrome wall of hundreds of thin translucent vertical slices, grouped
into flat-topped slabs of distinct heights with a fringe of tall "hair"
singletons, stacked in overlapping translucent depth layers and seen in
shallow perspective. Every beat kicks slab height and slat brightness; band
thickness and flutter track the high band and overall energy continuously;
the whole layout re-forms on a slow crossfade and can restart early at a bar
boundary. Featured on `main` (graduated out of `DRAFT_SCENE_IDS` in the same
PR that added it).

## Where the code is

`src/render/scenes/slats/index.ts` (the `Scene`, its glow/bloom chain and
its instanced-buffer crossfade), `layout.ts` (pure, CPU-only slab/slat model:
`partitionSlabs`, `layoutSlats`, `buildWall`, `packSlats`, `OnsetEnvelope`,
`shouldReshuffle` — all covered by `tests/slats.test.ts`), and `glsl.ts`
(the `SETTINGS` table and `SLAT_VERT`/`SLAT_FRAG`/`BLUR_FRAG`/
`COMPOSITE_FRAG`). Read `index.ts`'s header first — it explains the sync
reasoning end to end and links each behaviour back to what the reference
measurement confirmed our analyser actually reproduces.

Shared systems it plugs into: `anim.onset` (the render-latched one-shot edge
from `renderLatch.ts`, not raw `FeatureFrame.onset`) drives `layout.ts`'s
`OnsetEnvelope`; `anim.barPhase` + `anim.tempoLock` gate `shouldReshuffle`;
`resolveSceneSetting`/`autoTune.ts` resolves every setting under Auto; the
`pulse` and `kickDip` settings declare `reads` chips (`feature.onset`,
`anim.lowOnset`) rather than the full drives system (see below); the bloom
chain (full-res target + half-res separable blur ping-pong, gated by
`quality.bloomPasses`) is copied from `powder.ts`'s shape; slat count scales
with `quality.detail` down to a floor via `slatCountForQuality`.

Not yet on the global drives system (`src/render/drives.ts`): PR #130 adds
`slats` to the scenes whose reactive settings pick a drive source, but as of
this record that PR is still open (stacked on #127, itself open) and not
merged to `main`.

## References

Studied from a YouTube short, id `qtPi0JvmWbs`, its 0:15–0:20 span: a
monochrome wall of thin vertical slices grouped into stepped slabs with tall
singleton "hairs", in translucent depth layers over a dark ground,
continuously re-forming, measured with the `/ref` loop rather than built
from stills. Technique and timing studied, not the picture itself: the
sync hypotheses (beat-driven height/brightness kick, continuous high-band/
energy-driven thickness and flutter, bar-wrap-gated reshuffle) and the
frame-statistics look-matching method. `/ref` bundle:
`tools/.cache/refs/qtPi0JvmWbs/`.

## Measurements

From the `/ref` report (2026-09-11 shoot, 15s+5s clip): tempo 103.4 bpm (8
beats), phrase phase estimated at beat 4, one section boundary at beat 7. Our
analyser: onset fires within 60 ms of 71% of the reference's onsets; onset
fired on 4/4 of rank-1 beats and 1/1 of rank-4 and rank-16 beats — the basis
for driving the beat kick off `anim.onset`. Picture regime 1 (67% of the
clip): 439 lit objects at 1280×720, lit floor 0.28, lit 29.1% of pixels
(424 bar / 11 blob / 4 disc), ground `#272727`; regime 2 (33%): 425 objects,
lit 27.6%, ground `#282828`. Correlations clearing the noise: zoom~high
r +0.61 at -400 ms, abszoom~high r +0.65 at -66 ms, brightness~low r -0.51 at
-333 ms, activity~high r +0.48 at 0 ms — the basis for tying thickness/
flutter to `anim.high`/`anim.energy` continuously rather than on a trigger.
No hard cuts at 30 fps across the sampled bursts; the one off-beat picture
change (0.27s) had no onset under it and looked scripted/timer-driven, and
the one section boundary produced no measurable change in the picture — both
reasons the scene has no phrase-synced or section-synced behaviour.

Look-matching pass (pre-PR, three iterations, numbers not dated
individually in the surviving record): reference frame vs. ours compared on
mean brightness, lit>120 share, white>220 share, lit percentile 50/90,
vertical-edge column count and band row extent on a matched crop. That
process — not eyeballing — found the composite knee that capped output white
at grey, the glow blur lifting the whole frame because it blurred the ground
along with the slats, and a single per-slab layer assignment that meant
layers never overlapped so nothing stacked toward white.

## Decisions and pivots

- **2026-09-11 to 2026-09-18 — built via `/ref` on `qtPi0JvmWbs`.** Early
  passes eyeballing brightness pushed it back and forth (an all-white pass,
  then an all-grey pass) before switching to the frame-statistics method
  above, which converged in three passes and found three real bugs rather
  than three taste disagreements: the composite knee, the ground-in-blur
  lift, and the per-slab (rather than per-layer) partition that prevented
  any depth-layer overlap. Fixed as: one `partitionSlabs` call per depth
  layer in `buildWall` so layers overlap in x and stack toward white; the
  glow blur (`BLUR_FRAG`'s `uSubtract`) subtracts the ground before
  blurring so it halos the slats instead of lifting the whole frame; the
  composite's highlight knee (`HIGHLIGHT_KNEE`/`HIGHLIGHT_ROLL` in
  `glsl.ts`) eases toward white instead of capping there.
- **Sync scope decided during the same build.** Two sync hypotheses that the
  reference's own measurement did not support were deliberately left out
  rather than faked: a phrase-start reshuffle (no phrase counter exists on
  `AnimFrame`, and this clip's tempo never locked when measured) and any
  section-boundary response (the one section boundary produced no
  measurable picture change). Both are named in `index.ts`'s header as
  `beatClock.ts`/`src/audio/` to-dos, not scene bugs.
- **PR #100 (merged 2026-09-18).** Shipped the scene and, in the same PR,
  graduated it out of `DRAFT_SCENE_IDS` — first among the scenes so listed —
  rather than landing it as a draft.

## Tuning notes

Look is judged against the reference's mix of a mostly-flat-topped wall with
a sparse tall-hair fringe and patches of mid-grey overlap between white
cores — not against either extreme a slider sweep tends to land on. `pulse`
(beat kick) and `flutter` (high-band/energy-driven jitter) are the two
settings that read as "alive" on real music; `morph` is reform duration in
seconds, not live progress (`uMorphMix` is the crossfade progress uniform,
kept a separate name deliberately — see `layout.ts`'s header on the naming
collision `sceneCommon.ts`'s auto-uniform-upload would otherwise cause).
`slabWidth` and `layers` are the two settings that most change the overall
density of the wall; `layers` is `advanced`. `hair` scales the already-baked
hair lengths live (so it responds within a frame), while the underlying hair
*generation* is fixed at layout time from `HAIR_FRACTION`/`HAIR_SCALE`/
`HAIR_MAX` in `index.ts` — dragging `hair` won't change which slats are
hairs, only how tall the existing ones read. `vanish` and `curve` (vanishing
point / right-edge curl) are subtle at their shipped defaults and were
flagged as barely visible in PR #100's own verification notes. Slat count
scales with `quality.detail` (`slatCountForQuality`, floor `MIN_SLAT_COUNT`)
so lower tiers thin the wall rather than dropping layers or bloom outright;
bloom itself is skipped entirely (no offscreen chain at all) once
`quality.bloomPasses` is zero, not just downsampled further.

## Known issues and next steps

- Not yet run through `/tune`.
- Slab tops read hairier than the reference's, which are cleaner-topped with
  sparser hairs and more mid-grey overlap between stacked layers.
- `vanish` and `curve` are barely visible at their defaults — the
  perspective read (off-centre vanishing point, right-edge curl) is weaker
  than the reference's.
- Phrase-start reshuffle and any section-boundary response are open
  `beatClock.ts`/`src/audio/` to-dos (no phrase counter on `AnimFrame`; this
  reference's own tempo never locked when measured), deliberately not
  faked in this scene.
- PR #130 (open, stacked on #127, also open) would move `slats`'s reactive
  settings onto the global drives system (`drives.ts`) — picking a drive
  source per setting instead of the current fixed `reads` chips. Revisit
  once #127/#130 land.

## Resume here

- `npm run dev`, then `/?audio=synthetic&bpm=120#/v/slats` (query before the
  hash).
- The reference bundle is `tools/.cache/refs/qtPi0JvmWbs/`; re-shoot or
  extend it with `/ref` if a new comparison is needed — `report.md`'s
  "Files" section lists the slit-scan, keyframe and per-regime images worth
  opening first.
- Gotcha: `hair` (the live setting) and the baked hair *generation*
  constants in `index.ts` are separate — changing the look of hairs that
  already exist is instant, but changing how many slats become hairs needs
  a regeneration (the next morph/reshuffle cycle).
- Gotcha: `uMorphMix` vs. the `morph` setting — `sceneCommon.ts` auto-uploads
  every setting as `u<Key>`, so the crossfade progress uniform is
  deliberately named apart from `morph` (seconds-per-reform) to avoid a
  collision; don't rename one into the other's shape.

## History

- `#100` (`0ad1610`, merged 2026-09-18) — Slats: a wall of translucent white
  slats from `/ref` on `qtPi0JvmWbs` (scene, tests, `tuning/VOCAB.md`
  entry), and in the same PR, graduated out of `DRAFT_SCENE_IDS`.
- `#130` (open, not yet merged) — Drives: would move `slats`'s reactive
  settings onto the global per-setting drive-source system.
