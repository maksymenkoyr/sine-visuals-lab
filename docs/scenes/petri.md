# Petri (`petri`)

A Gray-Scott reaction-diffusion colony rendered as a lit clay relief (or a
perspective floor of glossy beads, a jet-LUT spectrum, a bone-and-copper
ember field, or a glowing outline) growing, spotting and worming across a
dish. Music drives growth speed, nucleation, camera and — in some styles —
colour. A draft on main (in `DRAFT_SCENE_IDS`).

## Where the code is

`src/render/scenes/petri.ts`. The simulation is a ping-pong pair of RGBA8
textures (R=U, G=V) stepped by `SIM_FRAG`'s forward-Euler Gray-Scott update
at the fixed `DU`/`DV` diffusion-rate pair — see the file's own comment on
why this pair (not the textbook 1.0/0.5 ratio) keeps the scheme CFL-stable at
dt=1, dx=1 texel, and why it also keeps the classic named Feed/Kill points
(`REGIMES`) meaningful. `Band shaping` bends the sim's own kill rate by
radius via `sampleBands`, inside `SIM_FRAG`, not as a display-only effect.
Reseed stamps, regime cuts and bass wipes all share one seed pass and one
per-frame budget of `MAX_SEEDS` signed slots (positive stamps V, negative
wipes a hole and refills U). `Style` is the scene's variant setting
(`STYLE_NAMES`); every other setting remembers its own value per style via
`variantDefaults`. Display/style logic (Clay relief, Beads perspective floor,
Spectrum/Ember LUTs, Neon outline) lives in a separate display fragment
program from `SIM_FRAG`; `uSymmetry` folds the final picture into mirrored
wedges (`foldAngle`) as a post step. `V_FLOOR` guards a specific 8-bit
quantisation artifact — see Decisions below. No dedicated test file exists
for this scene.

## References

Studied from a batch `/ref` scan over six videos found under "Gray-Scott
reaction diffusion": `2s28LbNqmOM`, `48H_Fre00AY`, `9pAkn0bsCLU`,
`P-UTmeA4qeI`, `VTcH08UgcAE`, `rBwFHMb8Lh0`. Of these, four were confirmed as
genuine Gray-Scott simulations and informed the scene; `VTcH08UgcAE` (wire
trails) and `rBwFHMb8Lh0` (a periodic kaleidoscope pattern, already covered
by the Kaleidoscope scene) were excluded as different algorithms during the
scan. All six clips are silent or beatless, so every audio mapping in this
scene — including how a regime cut fires — is an original design choice, not
something measured from the references; the file header states this
explicitly. The two grayscale references, `2s28LbNqmOM` and `9pAkn0bsCLU`,
were read closely for the Clay/Dish/Beads look: a light clay-gray ground
with the pattern as a lit 3D relief (`2s28LbNqmOM`), carved dark grooves with
white ridge highlights (`9pAkn0bsCLU`). `9pAkn0bsCLU` also confines its
colony to a dish in two of its regimes, has a perspective floor-of-beads
regime, and cuts between pattern regimes as a montage — the direct source
for the Dish setting, the Beads style, and Regime cuts. `48H_Fre00AY`
(rainbow growth front) and `P-UTmeA4qeI` (bone-and-copper maze) supplied the
Spectrum and Ember colour looks. Neon has no reference; it's this scene's own
addition. `/ref` bundles:
`tools/.cache/refs/2s28LbNqmOM/`, `tools/.cache/refs/48H_Fre00AY/`,
`tools/.cache/refs/9pAkn0bsCLU/`, `tools/.cache/refs/P-UTmeA4qeI/`,
`tools/.cache/refs/VTcH08UgcAE/`, `tools/.cache/refs/rBwFHMb8Lh0/`.

## Decisions and pivots

- 2026-09-18: first version (Mono style, dark-ground). Feedback that it
  needed more ways to sync with audio, to read closer to `9pAkn0bsCLU`, and
  more distinct styles led to the rebuild that shipped in PR #109: the
  dark-ground Mono style was replaced (it read as an inversion of the
  grayscale references' actual light-clay ground) by the current five-style
  set (`STYLE_NAMES`), the Dish setting and Beads perspective style were
  added to match `9pAkn0bsCLU`, and Regime cuts were added as the closest a
  continuously simulated field can get to that reference's hard montage cuts
  between pattern regimes — a real cut to a different mature colony isn't
  reachable in one state pair, so a cut instead jumps Feed/Kill to another
  named point of `REGIMES` and reseeds.
- Every entry in `REGIMES` was verified by holding it 8 seconds from a
  mature colony with cuts off before being added: an invented Feed/Kill
  point and the textbook mitosis point both sit past this grid's survival
  edge and dissolved the whole colony within seconds, so regime cuts never
  land on either even though the sliders can still be dragged there by hand.
  `maze` was found to only propagate from an already-established colony —
  fresh dots dissolve there — so it's a cut target, never the scene's start
  point (`coral` is).
- Two display bugs were fixed during the same rebuild: with Dish on, sim UV
  outside the dish has to read as bare ground rather than wrap, or the torus
  wrap tiles the dish across the whole screen; and bare ground showed faint
  straight-edged ghost polygons that turned out to be 8-bit quantisation
  plateaus of near-zero V catching the relief normal's lighting — fixed by
  flooring V (`V_FLOOR`) before taking the gradient.
- A Sonnet-executed pass of the rebuild plan hit a rate limit mid-edit,
  leaving stray backticks inside a GLSL template literal; finished by hand.

## Tuning notes

Feed/Kill under any Regime-cut mode other than Off act as offsets around the
current regime point rather than absolute values — `settingDefault` is the
zero point. `Band shaping`'s kill swing (`SHAPE_KILL_SWING`) is deliberately
held well under the margin a regime can take before dissolving; pushing it
higher risks killing the colony outright rather than just reshaping it.
`WARMUP_STEPS`, spread across `WARMUP_STEPS_PER_FRAME`-sized chunks, lets the
scene open on an already-mature colony instead of a few fresh dots, matching
every reference (none of them opens on a fresh seed). Seed stamps need a
radius at or above `SEED_RADIUS_TEXELS` — smaller dots reliably dissolve
before they can establish in most regimes. Switching Style from Beads to
another style mid-session can leave the floor camera briefly over ground
outside the former dish for a few seconds — a known display artifact, not a
bug in the underlying sim. Real-music tuning (as opposed to synthetic) had
not been run as of the scene's introduction.

## Known issues and next steps

Not yet tuned against real music. Beads' far rows show a little shimmer even
with mipmapping enabled. The Beads-to-other-style camera artifact noted above
is cosmetic and untriaged.

## Materials

- `petri/2s28LbNqmOM/` — measurements kept from the `/ref` bundle `2s28LbNqmOM`: report, data, and our own shots.
- `petri/48H_Fre00AY/` — measurements kept from the `/ref` bundle `48H_Fre00AY`: report, data, and our own shots.
- `petri/9pAkn0bsCLU/` — measurements kept from the `/ref` bundle `9pAkn0bsCLU`: report, data, and our own shots.
- `petri/P-UTmeA4qeI/` — measurements kept from the `/ref` bundle `P-UTmeA4qeI`: report, data, and our own shots.
- `petri/VTcH08UgcAE/` — measurements kept from the `/ref` bundle `VTcH08UgcAE`: report, data, and our own shots.
- `petri/rBwFHMb8Lh0/` — measurements kept from the `/ref` bundle `rBwFHMb8Lh0`: report, data, and our own shots.
The reference media for these bundles (video, frames, audio, the images built from them) stays out of this repo: in the local `tools/.cache/refs/<bundle>/` cache and the private archive (`tools/ref-archive.py`).

## Resume here

`npm run dev`, then `/?audio=synthetic&bpm=120#/v/petri`. `window.__viz.setParams`
no-ops without a `scene` key alongside `settings` — the same gotcha other
scenes' records note. Du/Dv blow-up (from an incorrectly scaled diffusion
pair) shows up as straight-line moiré after the display pass's rotate/zoom,
not as an obviously broken field — check `DU`/`DV` first if the pattern looks
like static rather than growth. No dedicated test file exists yet; consider
adding one covering `REGIMES` survival and the warm-up/seed-radius invariants
if resuming tuning work.

## History

- `#109` (2026-09-18, merged) — Petri added: Gray-Scott reaction-diffusion
  scene, first as a dark-ground Mono build, then rebuilt within the same PR
  to the current five-style, Dish/Beads/Regime-cuts version after feedback
  that it needed more audio hooks and a closer match to `9pAkn0bsCLU`.
