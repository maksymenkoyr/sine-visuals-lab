# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9"]
# ///
"""
Tests, per 2 s piece of the Colorem reel, whether the picture is an
accumulation canvas (shape stamped every frame into a buffer that is never
cleared, optionally softened each frame) or something else.

  uv run deconstruct.py <video>

Per piece:
  head      where this frame's change is (pixels whose colour moved > HEAD_D),
            its area share and centroid speed (px/frame)
  trail     object pixels away from the head: share unchanged frame to frame
            (persist), median optical flow on textured trail pixels (px/frame)
  global    a similarity transform fitted to the flow over the whole frame:
            its scale/rotation/shift per frame and how much of the flow it
            explains — a still image being panned/zoomed fits it fully
  soften    edges in the trail picked at one frame, followed while nothing
            overwrites them: gradient at k frames / gradient at 0 (1 = edge
            stays sharp; falling = the canvas is blurred every frame), and
            the implied width growth w(k)/w(0)
  fade      the same pixels' colour distance from the ground, k vs 0
  colour    the newest stamp's colour (changed pixels) over the piece: its
            luminance swing and the strongest autocorrelation period
"""
import sys

import cv2
import numpy as np

HEAD_D = 28.0  # colour change (0..441, RGB Euclidean) that marks "drawn this frame"
STILL_D = 6.0  # change below this = unchanged (h264 noise sits around 2–4)
OBJ_D = 30.0  # distance from ground that counts as object
PIECE = 60
EDGE = 3


def load(path):
    cap = cv2.VideoCapture(path)
    out = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        out.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
    return out


def ground_of(img):
    h, w, _ = img.shape
    b = 16
    ring = np.zeros((h, w), bool)
    ring[:b] = ring[-b:] = True
    ring[:, :b] = ring[:, -b:] = True
    ring[: int(0.14 * h), int(0.76 * w) : int(0.92 * w)] = False
    return np.median(img[ring].astype(np.float32), axis=0)


def badge(h, w):
    m = np.zeros((h, w), bool)
    m[: int(0.14 * h), int(0.76 * w) : int(0.92 * w)] = True
    return m


def grad(gray):
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    return np.hypot(gx, gy)


def main():
    frames = load(sys.argv[1])
    h, w, _ = frames[0].shape
    bm = badge(h, w)
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
    ys, xs = np.mgrid[0:h:12, 0:w:12]
    for p in range(len(frames) // PIECE):
        a, b = p * PIECE + EDGE, (p + 1) * PIECE - EDGE
        F = [f.astype(np.float32) for f in frames[a:b]]
        G = [cv2.cvtColor(frames[i], cv2.COLOR_RGB2GRAY) for i in range(a, b)]
        g = ground_of(frames[a])
        heads, persist, tflow, hspeed, gfit, gshift, gscale, grot, cols = [], [], [], [], [], [], [], [], []
        prev_c = None
        changed_ever = np.zeros((h, w), bool)
        for n in range(1, len(F)):
            d = np.linalg.norm(F[n] - F[n - 1], axis=2)
            d[bm] = 0
            obj = (np.linalg.norm(F[n] - g, axis=2) > OBJ_D) & ~bm
            hd = d > HEAD_D
            heads.append(hd.mean())
            if hd.sum() > 30:
                c = np.array([np.nonzero(hd)[1].mean(), np.nonzero(hd)[0].mean()])
                if prev_c is not None:
                    hspeed.append(np.linalg.norm(c - prev_c))
                prev_c = c
                cols.append(np.median(F[n][hd], axis=0))
            else:
                cols.append(None)
            near = cv2.dilate(hd.astype(np.uint8), ker) > 0
            trail = obj & ~near
            if trail.sum() > 200:
                persist.append((d[trail] < STILL_D).mean())
            flow = cv2.calcOpticalFlowFarneback(G[n - 1], G[n], None, 0.5, 4, 21, 3, 5, 1.1, 0)
            gr = grad(G[n])
            tex = trail & (gr > 40)
            if tex.sum() > 100:
                tflow.append(float(np.median(np.hypot(flow[..., 0], flow[..., 1])[tex])))
            # global similarity fit on textured pixels anywhere
            tx = (gr[ys, xs] > 40) & ~bm[ys, xs]
            if tx.sum() > 30:
                src = np.stack([xs[tx], ys[tx]], 1).astype(np.float32)
                dst = src + flow[ys[tx], xs[tx]]
                M, inl = cv2.estimateAffinePartial2D(src, dst, ransacReprojThreshold=1.0)
                if M is not None:
                    gfit.append(float(inl.mean()))
                    s = np.hypot(M[0, 0], M[1, 0])
                    gscale.append(s - 1)
                    grot.append(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
                    gshift.append(np.hypot(M[0, 2] + (s - 1) * 0, M[1, 2]))
        # softening: pick trail edges at frame 5, follow 25 frames while not overwritten
        k0 = 5
        d0 = np.linalg.norm(F[k0] - F[k0 - 1], axis=2)
        near0 = cv2.dilate((d0 > HEAD_D).astype(np.uint8), ker) > 0
        obj0 = (np.linalg.norm(F[k0] - g, axis=2) > OBJ_D) & ~bm
        g0 = grad(G[k0])
        cand = obj0 & ~near0 & (g0 > np.percentile(g0[obj0 & ~near0], 90) if (obj0 & ~near0).sum() > 100 else False)
        soften, fade = {}, {}
        if isinstance(cand, np.ndarray) and cand.sum() > 50:
            alive = cand.copy()
            base_g = g0[cand].mean()
            base_c = np.linalg.norm(F[k0] - g, axis=2)
            for k in range(1, 26):
                if k0 + k >= len(F):
                    break
                dk = np.linalg.norm(F[k0 + k] - F[k0 + k - 1], axis=2)
                alive &= ~(cv2.dilate((dk > HEAD_D).astype(np.uint8), ker) > 0)
                if alive.sum() < 30:
                    break
                if k in (2, 5, 10, 15, 20, 25):
                    gk = grad(G[k0 + k])
                    soften[k] = gk[alive].mean() / g0[alive].mean()
                    ck = np.linalg.norm(F[k0 + k] - g, axis=2)
                    fade[k] = ck[alive].mean() / max(base_c[alive].mean(), 1e-3)
            surv = alive.sum() / cand.sum()
        else:
            surv = 0.0
        # colour periodicity of the newest stamp
        lum = np.array([0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] if c is not None else np.nan for c in cols])
        period, swing = None, 0.0
        ok = ~np.isnan(lum)
        if ok.sum() > 20:
            x = np.interp(np.arange(len(lum)), np.nonzero(ok)[0], lum[ok])
            swing = float(np.percentile(x, 95) - np.percentile(x, 5))
            x = x - x.mean()
            ac = np.correlate(x, x, "full")[len(x) - 1 :]
            ac /= ac[0] + 1e-9
            lags = np.arange(len(ac))
            # first local max after the first zero crossing
            zc = np.argmax(ac < 0) if (ac < 0).any() else None
            if zc:
                pk = zc + int(np.argmax(ac[zc : len(ac) // 2])) if zc < len(ac) // 2 else None
                if pk:
                    period = (int(lags[pk]), float(ac[pk]))
        f = lambda v: f"{np.median(v):.2f}" if len(v) else "—"
        print(f"piece {p} ({p * 2}–{p * 2 + 2}s)")
        print(f"  head: changed share {f(heads)}, centroid speed {f(hspeed)} px/frame")
        print(f"  trail: unchanged {f(persist)}, flow {f(tflow)} px/frame")
        print(
            f"  global: similarity explains {f(gfit)} of textured flow; scale {np.median(gscale) * 100 if gscale else 0:+.3f} %/frame, "
            f"rot {np.median(grot) if grot else 0:+.3f} °/frame, shift {f(gshift)} px/frame"
        )
        sw = " ".join(f"k{k}:{v:.2f}" for k, v in soften.items())
        wd = " ".join(f"k{k}:{1 / v:.2f}" for k, v in soften.items() if v > 0)
        fd = " ".join(f"k{k}:{v:.2f}" for k, v in fade.items())
        print(f"  soften (edge gradient vs k=0, {surv:.0%} of edges never overwritten): {sw or '—'}")
        print(f"    implied width w(k)/w(0): {wd or '—'}")
        print(f"  fade (distance from ground vs k=0): {fd or '—'}")
        print(f"  newest-stamp luminance swing {swing:.0f}/255, period {period[0] if period else '—'} frames (ac {period[1]:.2f})" if period else f"  newest-stamp luminance swing {swing:.0f}/255, no period")


if __name__ == "__main__":
    main()
