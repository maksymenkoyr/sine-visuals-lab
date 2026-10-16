# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "pillow>=10"]
# ///
"""
Per-piece slit-scans along the head's own path: for each 2 s piece, the line
through the object along its main axis of change, sampled every frame.
y = position along the line, x = frame (time runs right). Below it, the same
for the line perpendicular to it through the object's middle.

How to read one: a pixel drawn once and left alone is a horizontal streak
that stays put; a canvas blurred every frame makes streaks spread vertically
as they run right; a canvas that drifts (feedback with a move) makes slanted
streaks; translucent stamps building up make colours change gradually along
a streak while the shape still covers it.

  uv run slit.py <video> <out.png>
"""
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

PIECE = 60
TW = 4  # px per frame in the output
H = 300  # px along the line in the output


def main():
    path, out = sys.argv[1], sys.argv[2]
    cap = cv2.VideoCapture(path)
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
    h, w, _ = frames[0].shape
    n = len(frames) // PIECE
    panel_w = PIECE * TW
    sheet = Image.new("RGB", (5 * (panel_w + 8), 2 * (2 * H + 30)), (16, 16, 20))
    d = ImageDraw.Draw(sheet)
    for p in range(n):
        F = frames[p * PIECE : (p + 1) * PIECE]
        A = np.stack([f.astype(np.float32) for f in F])
        # where things changed over the piece: per-pixel temporal std
        sd = A.std(axis=0).sum(axis=2)
        sd[: int(0.14 * h), int(0.76 * w) : int(0.92 * w)] = 0
        ys, xs = np.nonzero(sd > np.percentile(sd, 90))
        c = np.array([xs.mean(), ys.mean()])
        cov = np.cov(np.vstack([xs, ys]))
        ev, evec = np.linalg.eigh(cov)
        axes = [evec[:, -1], evec[:, 0]]
        panels = []
        for ax in axes:
            ts = np.linspace(-0.75 * h, 0.75 * h, H)
            px = np.clip(c[0] + ts * ax[0], 0, w - 1).astype(np.float32)
            py = np.clip(c[1] + ts * ax[1], 0, h - 1).astype(np.float32)
            cols = []
            for f in F:
                s = cv2.remap(f, px[:, None], py[:, None], cv2.INTER_LINEAR)[:, 0, :]
                cols.append(s)
            img = np.stack(cols, axis=1)  # H x frames x 3
            img = np.repeat(img, TW, axis=1)
            panels.append(Image.fromarray(img.astype(np.uint8)))
        x0 = (p % 5) * (panel_w + 8)
        y0 = (p // 5) * (2 * H + 30)
        sheet.paste(panels[0], (x0, y0))
        sheet.paste(panels[1], (x0, y0 + H + 4))
        d.text((x0 + 4, y0 + 2 * H + 8), f"piece {p}  {2 * p}-{2 * p + 2}s  top: main axis, bottom: across", fill=(230, 230, 230))
    sheet.save(out)


if __name__ == "__main__":
    main()
