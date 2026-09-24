# Synthetic sanity check for tools/reflook.py's flow_profile: draws discs on
# rings, moves them outward with dr/dt ~ r^2, spins them at a known rate, and
# checks flow_profile recovers the expected numbers. Scene-agnostic (tests
# the shared reflook library); written while building the Neon Gates scene.
# Rescued from a working session on 2026-09-05.
# usage: uv run flowtest.py
# May need adjusting to current code — imports reflook from the repo's
# tools/ directory, where it already lives.
"""Synthetic check of reflook.flow_profile: discs on rings, moved outward
with dr/dt ∝ r² and spun counter-clockwise on screen by a known rate."""
import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools"))
import cv2
import numpy as np
import reflook

W, H = 640, 360
half = H / 2
FPS = reflook.FLOW_FPS
SPIN = 36.0  # deg/s, ccw on screen
K = 1.2  # dr/dt = K r² half-heights/s

def frame(t):
    img = np.zeros((H, W, 3), np.uint8)
    for r0 in (0.15, 0.3, 0.5, 0.8):
        for k in range(8):
            th0 = k * 45.0 + 10.0
            # integrate dr/dt = K r² → 1/r = 1/r0 - K t
            r = 1.0 / (1.0 / r0 - K * t)
            th = math.radians(th0 + SPIN * t)
            x = W / 2 + r * half * math.cos(th)
            y = H / 2 - r * half * math.sin(th)  # ccw on screen = y up
            rad = max(3, int(6 * r / 0.3))
            cv2.circle(img, (int(x), int(y)), rad, (60, 220, 255), -1)
    return img

frames = np.stack([frame(i / FPS) for i in range(reflook.FLOW_FRAMES)])
f, pairs = reflook.flow_profile(frames)
print("matches", f["matches"], "outwardShare", f["outwardShare"], "p", f["p"], "vAt05", f["vAt05"], "rot", f["rotMeanDegS"])
print("expected: outward 1.0, p 2.0, vAt05", round(K * 0.25, 3), "rot +36")
print("radial by r", list(zip(f["rBins"], f["radial"])))
