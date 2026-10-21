# -TaRL--y9Xc — hearts measured (2026-10-21, purpose-built: hearts.py, chains.py, crop.png)

Source: "Flying Black and Purple Y2k Neon LED Lights Heart Background || 1 Hour Looped HD"
(channel Gradient and Colour), 1280x720 60 fps AV1, audio silent (-91 dB flat). Clip studied 30–43 s.
ref-scan's lit-object numbers count single LED dots, not hearts — use this file for geometry.

- Loop: exact 6.000 s repeat (frame 360 vs frame 0: 1.76 mean abs diff vs 32.7 median).
- LED mask: fixed in screen space; pitch 6.67 px = 108 dot rows over the height; round dots fill
  31% of a lit area (dot diameter about 0.63 pitch); gap brightness 0.25 vs dot 0.76 (glow fills gaps).
- Glow e-fold 12–14 px (ref-scan); ground #0f030e, centre a bit brighter than edges.
- Hearts: about 59 per frame; size (max extent) in half-heights p10 0.07, p50 0.16, p90 0.44, max ~1.0.
  Bigger = brighter (lum 0.20 small → 0.31 large) and softer (dot contrast 0.66 → 0.40: near ones blurred).
- Colour: magenta ~304° for nearly all lit area; accents: rose/red (fading near hearts), violet/blue
  (hearts seen edge-on). ref-scan: magenta 89%, rose 9%.
- Motion: flat zoom out from the centre, radial speed / r ≈ 0.30 /s for every size band
  (scan: +0.335 log-scale/s, ×1.40/s); no global rotation.
- Spin: hearts turn about their vertical axis; edge-on they become thin violet slivers.
- Near/large hearts darken to dim red and fade out as they swell; ref-scan logs these as 4
  off-beat "transitions" per 6 s loop — timer, not audio.
