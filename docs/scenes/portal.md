# Portal (`portal`)

Draft. A neon ring at the end of a dark tunnel of shards, flying toward it.
The room is near black between kicks, and the ring is the only steady light.
Each kick gets one of three different reactions in turn (a red flood, a
blast that flares the ring and throws debris, a green accent that runs along
the walls), so the picture changes look on every hit instead of repeating one
reaction. First pass, not on main yet: it sits in this PR.

## Where the code is

- `src/render/scenes/portal/card.ts`: the card, loaded with the page. `SETTINGS`
  holds the dials, grouped Form / Motion / Look, and the `gallery` record;
  `loadBody` imports the body.
- `src/render/scenes/portal/index.ts`: the scene module, the body, loaded after
  first paint. `extraUniforms` runs the kick counter
  and the local camera every frame, and `onInit` starts both over.
- `src/render/scenes/portal/rotation.ts`: the pure turn-taking and envelopes.
  `advanceLooks` hands each kick to the next look, `lookLevel` and `lookAge`
  read a look's fall, `blastFlicker` shapes the blast's first moments.
- `src/render/scenes/portal/glsl.ts`: `FRAG`, the fragment body, layer by
  layer as its header describes.
- `tests/portalRotation.test.ts`: the turn order, the clamping of the Turns
  setting, and the fall and flicker curves.
- The kick reads `fired()` through the drive engine (`src/render/drives.ts`,
  "Hit drivers"), with `hit: { reactionLabel: "look" }` on the Kick setting,
  so `tests/hitDrivers.test.ts` covers it.

## References

Vizibeat tutorial reel "Animating with audio in Unreal" (Empa3D's UE5
plugin), a local file handed over 2026-10-12, studied with `/ref` as bundle
`reel-1012`: the turn-taking of reactions per kick, the near-black rest with
one lit ring, the reaction envelopes. Studied as inspiration; the scene is an
independent design. The media stays in the local cache
(`tools/.cache/refs/reel-1012/`) and never enters this repo.

## Measurements

Dated 2026-10-12, from the `reel-1012` report. Reference values:

- Reactions rotate flood → blast → accent, one per kick. Cycle 2.23 s = 3
  kicks of 0.743 s, over the song's 1.50 s two-kick pattern, so the blast
  falls on a different part of the bar each time.
- Attack: 1–2 frames (flood 2, blast 1).
- Fall to 25 % of height: flood 360–400 ms, blast 260–430 ms.
- Rest luminance of the tunnel ≈ 0.05, with the ring the only steady light.
- Ring stroke ≈ 2–3 px at 720 px wide; glow e-fold 7–14 px.
- Our onsets matched 86 % of the reference's within 60 ms. Our tempo held
  ×1 only 27 % of the clip, with speech over music.

Note: the plan that started this scene quoted the fall as 330–430 ms, and as
about 0.38–0.42 s in its goal. The report's own figures are the ones above;
`FALL_QUARTER_SEC` (in `rotation.ts`) sits inside both ranges.

## Decisions and pivots

- 2026-10-12: phase 1 does the turn-taking inside the scene: one Kick hit
  setting and a kick counter. Phase 2, if the look holds up, moves "take
  turns" onto a wire as a general drive option.
- 2026-10-12: first look on synthetic audio. The shards came out as radial
  wedges (a 1/r depth stretched each cell along the radius), so the tunnel
  grid moved to log-polar: cells stay square and grow toward the edge, and the
  shards read as chunks flying out against the flood. The blast washed the
  whole frame yellow-white; its share of the flood, its debris edges and its
  ring bloom were turned down.
- 2026-10-24: Id, name, settings and gallery record moved to `src/render/scenes/portal/card.ts`, so the scene's code loads after the page's first paint. Nothing visible changed. (#536)
- 2026-10-24 (#682) — The Bass and Treble lanes also fire on jumps in the
  audio engine's band levels (`src/render/bandEnergy.ts`). No code in this
  scene changed. Since #677 they had fired only on the hits the engine named
  kicks and hats: on Billie Jean about half the old lanes' Bass hits and a
  fifteenth of their Treble hits. `tools/tune-real.mjs portal` on Billie Jean,
  30 s from 4 s, change in % of full scale per 100 ms:

  | build | song med | song p95 | silence med | silence p95 |
  |---|---:|---:|---:|---:|
  | before #677 | 6.63 | 12.86 | 0.32 | 0.39 |
  | #683 | 3.62 | 13.63 | 0.32 | 0.39 |
  | #682 | 6.66 | 13.04 | 0.32 | 0.38 |

  The steady motion fell by about half on #683 and is back to the old lanes'. No hit fired on silence.
- 2026-10-30, #802: The look change moved from the bass hit to the Kick.
  - tune-real on a real song (around-the-world) then silence, main → this
    change: song change median 5.53 → 4.49, p95 14.96 → 13.57; silence
    median 0.32 → 0.32, p95 0.39 → 0.38; hits a minute on the song 416 →
    430, in silence 0 → 0; main's bass / mid / treble lanes 142 / 138 /
    242 a minute against kick / clap / hats / chord 114 / 38 / 278 / 130.

## Tuning notes

- First pass, written from a plan and given one round by eye on synthetic
  audio (the pivot above); the numbers in `SETTINGS` are starting values.
- The colours are designed (red flood, green accent, hot ring under a blast),
  not the room palette, on purpose.
- Judge it on a real kick: look at a flood, a blast and an accent side by
  side, and check the fall still reads as the reaction ending.

## Known issues and next steps

- Only one round by eye, on synthetic audio; the blast still runs hot and
  the debris size and the blast flicker are the most likely to be off.
  Judge it on real music next.
- The blast flicker is the strongest motion in the scene; look at it on a
  phone before this leaves draft.
- The shader's hashes read wrapped cells and seeds (`DEPTH_WRAP`,
  `SHAKE_WRAP`, `SEED_WRAP`); if a look ever shows a repeat, look there first.
- Phase 2 (the turn-taking as a wire option) is not started.

## Materials

- Reference measurements from `/ref` bundle `reel-1012`: the local report at
  `tools/.cache/refs/reel-1012/analysis.md` (local only, not in the repo).
- Artifact: "Vizibeat Face-off", https://claude.ai/artifact/SSRtdLt11LdnGp3bdHWoBA
  (the side-by-side study; no reference stills in this repo).
- The scene's own code: the three files and the test listed above.

## Resume here

- Dev link: `npm run dev`, then `/?audio=synthetic&bpm=120#/v/portal`.
- The reference report and frames stay in `tools/.cache/refs/reel-1012/`.
- Gotcha: `rotation.ts` is pure TS, so the turn order can be checked without
  a browser; the look itself needs the dev link.

## History

- this PR: first draft of the scene, its three files, the test and this record.
- 2026-10-24 (#682) — Bass and Treble hits also fire on the engine's band-level jumps; no code in this scene changed (see Decisions)
