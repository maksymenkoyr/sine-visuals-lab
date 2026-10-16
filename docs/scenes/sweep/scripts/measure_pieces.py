#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "scikit-learn>=1.4"]
# ///
"""
Per-piece measurements of the Colorem reel (docs/scenes/sweep.md, bundle
`colorem`), for a light-ground picture where tools/reflook.py's lit-object
detector counts nothing useful.

    uv run docs/scenes/sweep/scripts/measure_pieces.py <video.mp4> [--piece-sec 2]

The reel cuts to a new piece on a fixed timer (the bundle's `act` spikes),
so each piece is measured over its own window, skipping a few frames at each
end. Per piece, from the first and last measured frame:

  ground   median colour of the frame's border ring (the badge corner masked)
  object   share of the frame whose colour sits far from the ground, its
           bounding box and centroid, in half-heights from the centre
  travel   centroid displacement from first to last frame, half-heights/s
  palette  k-means colours of the object pixels (share of object area)
  stripes  luminance minima along the line through the centroid in the
           direction the object grew — the visible copy outlines
"""

from __future__ import annotations

import argparse
import sys

import cv2
import numpy as np
from sklearn.cluster import KMeans

FAR_FROM_GROUND = 0.12  # colour distance (0..1 per channel, Euclidean) that counts as "object"
EDGE_FRAMES = 4  # frames skipped at each end of a piece (cuts and their neighbours)


def load(path: str) -> tuple[list[np.ndarray], float]:
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0)
    return frames, fps


def badge_mask(h: int, w: int) -> np.ndarray:
    m = np.zeros((h, w), bool)
    m[: int(0.14 * h), int(0.76 * w) : int(0.92 * w)] = True
    return m


def ground_of(img: np.ndarray, badge: np.ndarray) -> np.ndarray:
    h, w, _ = img.shape
    ring = np.zeros((h, w), bool)
    b = max(4, h // 40)
    ring[:b, :] = ring[-b:, :] = True
    ring[:, :b] = ring[:, -b:] = True
    ring &= ~badge
    return np.median(img[ring], axis=0)


def hexc(c: np.ndarray) -> str:
    return "#" + "".join(f"{int(round(x * 255)):02x}" for x in np.clip(c, 0, 1))


def object_mask(img: np.ndarray, ground: np.ndarray, badge: np.ndarray) -> np.ndarray:
    d = np.linalg.norm(img - ground[None, None, :], axis=2)
    return (d > FAR_FROM_GROUND) & ~badge


def to_hh(x: float, y: float, h: int, w: int) -> tuple[float, float]:
    """Pixel → half-heights from the centre, y up."""
    return ((x - w / 2) / (h / 2), -(y - h / 2) / (h / 2))


def stripes_along(img: np.ndarray, mask: np.ndarray, c: tuple[float, float], direction: np.ndarray) -> tuple[int, float]:
    h, w, _ = img.shape
    lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    lum = cv2.GaussianBlur(lum, (0, 0), 1.0)
    n = int(2 * max(h, w))
    ts = np.linspace(-max(h, w), max(h, w), n)
    xs = c[0] + ts * direction[0]
    ys = c[1] + ts * direction[1]
    ok = (xs >= 0) & (xs < w - 1) & (ys >= 0) & (ys < h - 1)
    xs, ys = xs[ok], ys[ok]
    inside = mask[ys.astype(int), xs.astype(int)]
    if inside.sum() < 8:
        return 0, 0.0
    vals = lum[ys.astype(int), xs.astype(int)][inside]
    # count local minima with a prominence floor
    count = 0
    for i in range(2, len(vals) - 2):
        if vals[i] < vals[i - 2] - 0.04 and vals[i] < vals[i + 2] - 0.04 and vals[i] <= vals[i - 1] and vals[i] <= vals[i + 1]:
            count += 1
    span_px = float(inside.sum()) * (ts[1] - ts[0])
    return count, span_px


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--piece-sec", type=float, default=2.0)
    args = ap.parse_args()
    frames, fps = load(args.video)
    if not frames:
        sys.exit("no frames")
    h, w, _ = frames[0].shape
    badge = badge_mask(h, w)
    per = int(round(args.piece_sec * fps))
    print(f"{len(frames)} frames, {w}x{h} @ {fps:.0f} fps, piece = {per} frames\n")
    for p in range(len(frames) // per):
        i0 = p * per + EDGE_FRAMES
        i1 = (p + 1) * per - 1 - EDGE_FRAMES
        a, b = frames[i0], frames[i1]
        g = ground_of(a, badge)
        ma, mb = object_mask(a, g, badge), object_mask(b, g, badge)
        ys, xs = np.nonzero(mb)
        if len(xs) == 0:
            print(f"piece {p} ({p * args.piece_sec:.0f}s): no object")
            continue
        ca = np.array([np.nonzero(ma)[1].mean(), np.nonzero(ma)[0].mean()]) if ma.any() else np.array([xs.mean(), ys.mean()])
        cb = np.array([xs.mean(), ys.mean()])
        dt = (i1 - i0) / fps
        travel = (cb - ca) / (h / 2) / dt
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        bb = (x1 - x0) / (h / 2), (y1 - y0) / (h / 2)
        km = KMeans(n_clusters=5, n_init=4, random_state=0).fit(b[mb][:: max(1, len(xs) // 20000)])
        shares = np.bincount(km.labels_, minlength=5) / len(km.labels_)
        order = np.argsort(-shares)
        pal = " ".join(f"{hexc(km.cluster_centers_[k])}×{shares[k]:.2f}" for k in order)
        # grow direction: from the first frame's centroid toward the last's,
        # or the mask's major axis when it barely moved
        d = cb - ca
        if np.linalg.norm(d) < 3:
            cov = np.cov(np.vstack([xs, ys]))
            ev, evec = np.linalg.eigh(cov)
            d = evec[:, -1]
        d = d / (np.linalg.norm(d) + 1e-9)
        n_str, span = stripes_along(b, mb, (cb[0], cb[1]), d)
        cx, cy = to_hh(cb[0], cb[1], h, w)
        print(
            f"piece {p} ({p * args.piece_sec:.0f}–{(p + 1) * args.piece_sec:.0f}s): ground {hexc(g)}; "
            f"object {mb.mean():.2f} of frame (was {ma.mean():.2f}), bbox {bb[0]:.2f}×{bb[1]:.2f} hh, "
            f"centroid ({cx:+.2f}, {cy:+.2f}) hh; travel ({travel[0]:+.2f}, {-travel[1]:+.2f}) hh/s; "
            f"stripes {n_str} over {span / (h / 2):.2f} hh"
        )
        print(f"    palette: {pal}")


if __name__ == "__main__":
    main()
