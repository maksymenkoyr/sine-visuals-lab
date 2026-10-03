# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "scikit-learn>=1.4"]
# ///
"""
Measure the grow/reset cycle and the stripe palette of the "Brush your
teeth" reference.

    uv run docs/scenes/coil/scripts/measure_cycle.py <video.mp4>

Cycle: per frame, the share of pixels within a small distance of the flat
lavender ground (the ground is what shows when the fresh shape is small and
the feedback copies are small). A reset shows as a jump up in ground share;
growth as a slide down. Also prints the radius of the fresh shape: the
largest r (in half-heights) at which a ray from the centre stays off-ground
along >= 60% of angles.

Palette: k-means on the non-ground pixels of frames where the shape covers
most of the frame, reported as hex with their shares, sorted by lightness.
"""
import sys

import cv2
import numpy as np
from sklearn.cluster import KMeans


def main():
    cap = cv2.VideoCapture(sys.argv[1])
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = []
    while True:
        ok, im = cap.read()
        if not ok:
            break
        frames.append(cv2.resize(im, (180, 180), interpolation=cv2.INTER_AREA))
    arr = np.stack(frames).astype(np.float32)
    # ground: the most common colour over the whole clip (coarse histogram)
    q = (arr // 16).astype(np.int32).reshape(-1, 3)
    keys = q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]
    top = np.bincount(keys).argmax()
    gmask = keys == top
    ground = arr.reshape(-1, 3)[gmask].mean(axis=0)
    print("ground BGR", ground.round(1), "hex #%02x%02x%02x" % tuple(int(v) for v in ground[::-1]))
    dist = np.linalg.norm(arr - ground, axis=-1)
    on_ground = dist < 22
    share = on_ground.reshape(len(frames), -1).mean(axis=1)

    n = 180
    yy, xx = np.mgrid[0:n, 0:n]
    r = np.hypot(xx - n / 2 + 0.5, yy - n / 2 + 0.5) / (n / 2)
    ang = np.arctan2(yy - n / 2 + 0.5, xx - n / 2 + 0.5)
    rbins = np.linspace(0.05, 1.4, 55)
    abins = np.linspace(-np.pi, np.pi, 33)
    radius = []
    for f in range(len(frames)):
        off = ~on_ground[f]
        # per angle sector: first radius where ground appears
        firsts = []
        for a0, a1 in zip(abins[:-1], abins[1:]):
            sec = (ang >= a0) & (ang < a1)
            hit = rbins[-1]
            for r0, r1 in zip(rbins[:-1], rbins[1:]):
                m = sec & (r >= r0) & (r < r1)
                if m.any() and off[m].mean() < 0.5:
                    hit = r0
                    break
            firsts.append(hit)
        radius.append(np.median(firsts))
    radius = np.array(radius)
    print("\n t(s)  ground-share  shape-radius(half-heights, median over angles)")
    for i in range(0, len(frames), int(fps / 2)):
        print(f"{i / fps:5.1f}  {share[i]:.2f}  {radius[i]:.2f}")
    # resets: radius drops by > 50% within 1 s
    print("\nresets (radius falls by >2x within 1 s, to < 0.5):")
    w = int(fps)
    last = -99
    for i in range(w, len(frames)):
        if radius[i] < 0.5 and radius[i - w] > 2 * radius[i] and i - last > 2 * fps:
            print(f"  {i / fps:5.2f}s  {radius[i - w]:.2f} -> {radius[i]:.2f}")
            last = i

    big = np.where(share < 0.08)[0][::10]
    px = arr[big].reshape(-1, 3)
    px = px[np.linalg.norm(px - ground, axis=-1) > 30]
    px = px[np.random.default_rng(0).choice(len(px), min(len(px), 60000), replace=False)]
    km = KMeans(n_clusters=6, n_init=4, random_state=0).fit(px)
    cnt = np.bincount(km.labels_, minlength=6) / len(px)
    order = np.argsort(km.cluster_centers_.sum(axis=1))
    print("\nstripe palette (non-ground pixels, big-shape frames), dark → light:")
    for k in order:
        b, g, rr = km.cluster_centers_[k]
        print(f"  #{int(rr):02x}{int(g):02x}{int(b):02x}  {cnt[k]:.2f}")


if __name__ == "__main__":
    main()
