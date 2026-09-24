# Measures our own screenshots with the same detector a reference video was
# measured with (tools/reflook.py's measure_frame), so a scene's render can
# be compared against a reference's numbers directly. Scene-agnostic; used
# while building the Neon Gates scene.
# Rescued from a working session on 2026-09-06.
# usage: uv run measure.py r3-00.png r3-01.png ...
# May need adjusting to current code — imports reflook from the repo's
# tools/ directory, where it already lives.
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9"]
# ///
"""Measure our screenshots with the same detector the reference was measured
with (reflook.measure_frame) and print one compact block per frame.
  uv run measure.py r3-00.png r3-01.png ..."""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools"))
import cv2  # noqa: E402
import reflook  # noqa: E402

for path in sys.argv[1:]:
    bgr = cv2.imread(path)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    # Crop the app chrome: the "clip buffer" pill top-left and the buttons
    # bottom-right are tiny; mask them black so they don't count as objects.
    rgb[0:60, 0:140] = 0
    rgb[-40:, -80:] = 0
    m = reflook.measure_frame(rgb)
    cls = ", ".join(f"{n} {c}" for c, n in sorted(m["classes"].items(), key=lambda kv: -kv[1]))
    fit = m["sizeFit"]
    st, g = m["stroke"], m["glow"]
    hues = ", ".join(f"{h['name']} {int(h['share'] * 100)}%" for h in m["hues"][:4])
    env = m.get("sizeEnvelope") or {}
    envs = ", ".join(f"{k}→{('—' if v is None else f'{v:.2f}')}" for k, v in env.items())
    print(f"## {path}")
    print(f"  {m['n']} objects (lit {m['litShare'] * 100:.1f}%): {cls}; outlines {int(m['hollowShare'] * 100)}%, nested {int(m.get('nestedShare', 0) * 100)}%")
    if fit:
        print(f"  size ∝ r^{fit['b']:.2f} over {fit['n']} {fit['on']}; at r0.3 {fit['at03']:.3f}, r0.9 {fit['at09']:.3f}; envelope {envs}")
    print(f"  {m['fold']}-fold ({m['foldScore']:.2f}); on-axis {int(m['onAxis'] * 100)}%, diag {int(m['onDiag'] * 100)}%")
    print(f"  stroke {st['innerPx']} / {st['outerPx']} px; glow e-fold {g['efoldPx']} px, halo/core {g['haloRatio']:.2f}; core lum {g['core']:.2f}, ground lum {g['ground']:.3f}")
    print(f"  hues {hues}; ground {m['ground']['hex']} vignette {m['ground']['vignette']:.2f}")
    sk = m["streak"]
    print(f"  streak elong {sk['innerElong']} / {sk['outerElong']}, radial {int(sk['radialShare'] * 100)}%")
    ov = reflook.overlay(rgb, m["objects"])
    cv2.imwrite(str(Path(path).with_name(Path(path).stem + "_overlay.png")), cv2.cvtColor(ov, cv2.COLOR_RGB2BGR))
