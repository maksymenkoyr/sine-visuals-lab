# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-28_

## In flight

- **Alien** (parent #750): the live Blender model, ten more dances with their
  own cameras (#785) and the Dance and View rows (#786) are merged.
  - Ready: #783, the record notes the owner's "good" on the live look and
    3D Bounce (record only).
  - Open: #752 several aliens and a moving camera, #774 Squeeze.
- **Ready PRs:** #744 Beat in two rows (#717), #686 knip baseline (#643).
- **Drafts, by area:**
  - Panel and cables: #754 (× at each end, #746); #743 is the first take of
    #744; #735 and #730 are older takes of the cable click.
  - Audio: #758 and #736 Hats, #648 Mic Auto room-path (superseded by merged
    #781), #777 gate off.
  - Output: #767 Projector grade.
  - Scenes: #666 Cosmic Cloud.
  - Plumbing: #646 usage source, #500 synced stores.
- **Audio engine v5** is merged (#674, #683, #781 quiet-mic gate); open
  findings for v6 are in #766.
- The 1.0.0 road (#616) is unchanged since 2026-10-21.

## Open questions

- Alien's feet look wrong on some dances: the fault is in the CMU data, not
  the retarget (per-clip scores in the memory `dance-clip-feet`). Fix by
  cleanup in `tools/clip-convert.mjs` (clamp the ankle, flatten a planted
  foot) or a toe bone: the owner's call. No issue filed yet.
- #774 Squeeze: its default wire and feel are still the owner's to say.
- Which stale drafts to close: #743, #735, #730, #648?

## Next up

- `/handoff` the Alien feet work, then build it.
- #774 once the owner answers its two open points.
