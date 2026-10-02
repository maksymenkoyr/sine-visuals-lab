# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9"]
# ///
"""
Measure the feedback loop in the "Brush your teeth" reference: which earlier
frame, scaled by how much, rotated how, and tiled at what period, explains
the background of frame t.

    uv run docs/scenes/coil/scripts/measure_feedback.py <video.mp4> [t0 t1 ...]

For each probe time t it builds candidate backgrounds
    tile( rot_k( resize(frame[t-lag], s) ) )
with the tile grid anchored so a tile centre lands at (W/4, H/4), and scores
each against frame t outside a centre disc (the freshly drawn shape covers
the middle). Prints the best few (lag, scale, rotation, mirror) by mean
absolute error, and the error of "no feedback" (flat ground) for scale.
"""
import sys

import cv2
import numpy as np


def load(path):
    cap = cv2.VideoCapture(path)
    frames = []
    while True:
        ok, im = cap.read()
        if not ok:
            break
        frames.append(im.astype(np.float32) / 255.0)
    return frames, cap.get(cv2.CAP_PROP_FPS)


def tiled(prev, s, k, mirror, n):
    small = cv2.resize(prev, (max(2, int(round(n * s))),) * 2, interpolation=cv2.INTER_AREA)
    if mirror:
        small = small[:, ::-1]
    small = np.rot90(small, k)
    p = small.shape[0]
    reps = n // p + 3
    big = np.tile(small, (reps, reps, 1))
    # a tile centre at (n/4, n/4): shift so that big[off + n/4] is a tile centre
    off = (p // 2 - n // 4) % p
    return big[off:off + n, off:off + n]


def main():
    path = sys.argv[1]
    frames, fps = load(path)
    n = frames[0].shape[0]
    probes = [float(x) for x in sys.argv[2:]] or [5.0, 20.0, 38.7, 45.0]
    yy, xx = np.mgrid[0:n, 0:n]
    r = np.hypot(xx - n / 2, yy - n / 2) / (n / 2)
    for t in probes:
        i = int(round(t * fps))
        cur = frames[i]
        mask = r > 0.75  # outside the fresh shape at most times
        ground = np.median(cur[mask], axis=0)
        flat = np.abs(cur[mask] - ground).mean()
        res = []
        for lag in (1, 2, 3, 4, 6, 8):
            prev = frames[i - lag]
            for s in (0.4, 0.45, 0.5, 0.55, 0.6):
                for k in range(4):
                    for m in (0, 1):
                        bg = tiled(prev, s, k, m, n)
                        res.append((np.abs(cur[mask] - bg[mask]).mean(), lag, s, k * 90, m))
        res.sort()
        print(f"t={t:.2f}s frame {i}: flat-ground err {flat:.4f}")
        # Fade toward the ground per generation: fit cur = g + a*(bg - g)
        # (least squares over the masked pixels, all channels) for the best
        # transform. a = 1 means copies keep full contrast; a < 1 means each
        # recursion level fades toward the ground.
        _, lag, s, rot, m = res[0]
        bg = tiled(frames[i - lag], s, rot // 90, m, n)
        x = (bg[mask] - ground).ravel()
        y = (cur[mask] - ground).ravel()
        a = float(x @ y / max(x @ x, 1e-9))
        fit = np.abs(y - a * x).mean()
        print(f"   fade toward ground a = {a:.3f} (err {fit:.4f}); ground BGR {ground.round(3)}")
        for e, lag, s, rot, m in res[:6]:
            print(f"   err {e:.4f}  lag {lag}  scale {s}  rot {rot}  mirror {m}")


if __name__ == "__main__":
    main()
