# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-18_

## In flight

- **Mic calibration** — parent issue #577, label `mic calibration`.
  - Draft PR #576 adds `tools/mic-gap.mjs`, which records the same music
    through a Chrome tab share and the laptop mic at once, plus two scripts
    that score both against the app's own detectors.
  - The first run on the M1 Pro (2026-10-17) found five gaps in the mic:
    - It arrives 9–27 ms after the tab share.
    - It hears no music in the lowest bands through laptop speakers.
    - It fires 30–50% more off-beat hits.
    - It loses tempo at 175 and 86 BPM.
    - After its level fell 13 dB, the silence gate dropped most hits.
  - The simulated mic in the tests shows none of this.
  - The follow-ups are its nine sub-issues: #578, #579, #580, #581, #582,
    #583, #585, #588 and #589.
  - The recordings and handoff notes live only on the owner's Mac, in
    `tools/.cache/mic-gap/`. The report is
    https://claude.ai/artifact/LiCKDZBDHrRj8peUbHUUd3; its second tab is #589.
- **Ready to merge:** #573, the 0.3.0 Stable release. #574 (the Chladni
  Mode ladder card) merged on 2026-10-18.
- **Drafts:**
  - #569 rate-limit docs
  - #500 synced stores
  - #498 handoff wording
  - #479 `setI`, already on main through #481
  - #467 panel a11y
  - #378 real-song tuning
- **Performance (#549):** #550–#553 are done (#560, #562, #564, #565).
  Still open:
  - #554 Ferrofluid GPU cost
  - #555 `npm run perf` on real music
  - #556 a real window, a long gig and a weak laptop

## Open questions

- Why did the MacBook mic's level fall 13 dB between two runs with nothing
  changed (#588)? The next `tools/mic-gap.mjs` run logs the macOS input and
  output volume per take, which should narrow it down.
- Panel blur Fast (#562) has merged, with On still the default. Make Fast the
  default?
- Lazy-load each scene's code after first paint (#536)? In a prototype on slow
  4G with 4× CPU, the TV's first paint went from 2.73 to 1.06 s.
- Record while the main window is hidden (#542)?
- Close #479?

## Next up

- #578: set the silence gate from this input's own noise floor instead of
  fixed marks. It's the cheapest big win for mic users.
- #579: fit `micChain` to the laptop recordings and keep them as a test
  fixture, so mic fixes can be checked without playing music aloud.
- #585: the same comparison on a synthetic track with exact truth. The plan
  is in the issue; it needs the laptop left playing for about 10 minutes.
- #540: `/ship` compares a render change's GPU cost by each scene's
  tenth-percentile frame.
