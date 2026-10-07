# Master card: Scale, Expansion and the gauge readable at first sight

A new user looking at the Master card's Scale and Expansion controls and the leash gauge under them cannot tell what the arc, the purple band, the white needle or the hover hint mean, or how Scale and Expansion relate. This makes the card explain itself at first sight, so nobody needs to hover or read docs. Issue #422.

Researched 2026-10-07.

## Decisions

- Raise this as a readability issue and hand it off, with no build plan yet — the user asked for "just handoff + issue". The phase below is a design pass, not a spec.
- The gauge's meaning, in the user's now-understood model: the NORMAL notch is Scale, the purple band is Expansion (how far the music may pull the picture), the needle is where the picture is now. The earlier calls (Scale = normal line, Expansion = reach and duration) are in PRs #304 and #318.

## Prototypes

Plain-words explainer of the current gauge (interactive, simplified model); use its wording as starting material
https://claude.ai/artifact/GCfBmfJZArEt61BvVbnMTr

## Rejected

- Nothing rejected yet.

## Open questions

- How should it read? Candidates: end labels plus a one-line caption under the gauge; a "N× from normal" readout; naming the notch, band and needle on the gauge itself; a first-run hint. Unconfirmed, the user has not picked — blocks phase 1.
- Should the hovered Shape chip's hint move away from the gauge? Today it shows right over it and reads like a gauge label. My guess only — blocks phase 1.

## Phases

Each phase is one build session and one PR.

- [ ] **1. Open the Master card cold and see what Scale, Expansion and the gauge are, with no hover**
  - Touches: `src/ui/leashGauge.ts`, the Master card in `src/ui/deviceMenu.ts`, `docs/vocabulary.md` if a word is added
  - Read first: `src/ui/leashGauge.ts` header, `docs/vocabulary.md`, `docs/index.md`; the explainer above for wording; the plain-labels rule: no outcome names, direction words at axis ends
  - Done when: three small sketches are shown to the user first and one is picked; then a headless screenshot of the Master card shows the picked labels, the needle trail no longer reads as scale marks, and the Shape hint no longer looks like a gauge label; the gauge keeps one constant scale (never auto-fit)

## Learned while building

