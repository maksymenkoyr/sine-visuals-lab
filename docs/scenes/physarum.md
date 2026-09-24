# Physarum (`physarum`)

An agent-based slime-mould transport network: agents sense a chemical trail
a short distance ahead, steer toward the strongest reading, step forward and
deposit trail behind them, while the trail map diffuses and evaporates
between deposits. Nothing is drawn directly — the network is grown frame by
frame, and it's the gallery's only scene whose structure visibly reorganises
itself over seconds rather than an instant. Featured, on main.

## Where the code is

`src/render/scenes/physarum.ts` — the header comment is the primary source
for the whole simulation design (packing, passes, evaporation precision,
dt handling, composite). Registered as `physarumScene` via `registerScene`
in `src/render/scenes/index.ts`.

Reuses `grainTextureSide` from `chladni.ts` for its agent-state texture
sizing, and shares that file's hash family and its reasoning for RGBA8
ping-pong state (no reliance on `EXT_color_buffer_float`) and for using
`frame.time` deltas rather than `anim.dtSec`. Exported pure helpers —
`trailSide`, `createBeatSeeder`, `attractorPositions`, `packUnit`/
`unpackUnit` — are covered by `tests/physarum.test.ts` without a GL
context. `GROUP_COUNT` keys the trail's three band-group channels, the
species assignment and the wandering attractors together; `SETTINGS`
carries the Form/Motion/Look/Post controls (Network scale, Fan angle, Turn
rate, Wander, Trail decay, Band braid, Crawl speed, Beat surge, Beat
seeding, Band pull, Glow, Relief, Palette tint, Beat flash), each with its
own `auto` weights for the Auto-tune system (`src/render/autoTune.ts`).

## References

None — original design. The header cites Jones's published multi-agent
slime-mould transport model as the algorithm the sense/steer/move/deposit/
diffuse/evaporate loop is written from, independently rather than ported
from any implementation (the same standing rule `powder.ts`'s curl noise
follows). No video or visual reference was studied for this scene.

## Decisions and pivots

- 2026-09-16 (#108): scene added complete in one PR — agent sim, trail
  diffuse/evaporate/attract, beat-triggered reseeding, relief shading,
  registered as featured at the head of its group. Tuned against the
  synthetic feed only (sensor/step/turn ratio, deposit/decay budget,
  composite exposure set from measured frame statistics); the PR notes it
  had not yet been judged against real music through a mic and might still
  want a tuning pass.

## Tuning notes

The sensor-to-step-to-turn ratio governs whether agents aggregate into
trails or leave an even, unstructured wash — see the Turn rate comment
block in the source for the per-step-angle reasoning. `DECAY_TAU_MIN`/
`DECAY_TAU_MAX`, `DEPOSIT_FLOOR_RATE` and `DEPOSIT_GAIN_RATE` are one
budget picked together: keeping the trail's equilibrium mean low is what
makes the bright network read as agents concentrating rather than a
uniformly saturated field. `AGENTS_PER_TEXEL` sizes the trail map from
agent density rather than screen size, so network-vs-worms structure holds
across quality presets — `trailSide`'s test asserts this directly against
`qualitySettings` for each preset.

## Known issues and next steps

Per the PR, the scene shipped featured on synthetic-feed tuning alone and
had not yet been checked against real music from a mic; a real-music tuning
pass may still be worth doing.

## Resume here

`npm run dev`, then `/?audio=synthetic&bpm=120#/v/physarum`. Pure logic
(`trailSide`, `createBeatSeeder`, `attractorPositions`, `packUnit`/
`unpackUnit`) is exercised by `tests/physarum.test.ts`, including a check
that auto-tuning resolves to defaults at the `NEUTRAL` profile — useful for
verifying a settings change didn't perturb the Auto baseline.

## History

- `#108` / `478f4cf` — Add Physarum scene: agent-based slime-mould network
  (complete implementation, tests, featured registration).
