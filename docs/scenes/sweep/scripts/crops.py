# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "pillow>=10"]
# ///
"""
Native-resolution crops per 2 s piece, ×2 nearest-neighbour so single-pixel
detail (anti-aliasing, outlines, fringes, grain) stays visible: one crop at
the head (where the picture changes most around mid-piece), one at the
strongest edge away from it.

  uv run crops.py <video> <outPrefix> [--t 0.9] [--size 150]
"""
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

args = sys.argv[1:]
video, prefix = args[0], args[1]
tfrac = float(args[args.index("--t") + 1]) if "--t" in args else 0.5
S = int(args[args.index("--size") + 1]) if "--size" in args else 150
Z = 2

cap = cv2.VideoCapture(video)
frames = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
h, w, _ = frames[0].shape
tiles = []
for p in range(len(frames) // 60):
    i = p * 60 + int(tfrac * 60)
    i = min(max(i, p * 60 + 4), p * 60 + 55)
    f0, f1 = frames[i - 3].astype(np.float32), frames[i].astype(np.float32)
    d = np.linalg.norm(f1 - f0, axis=2)
    d[: int(0.14 * h), int(0.76 * w) : int(0.92 * w)] = 0
    d = cv2.GaussianBlur(d, (0, 0), 12)
    hy, hx = np.unravel_index(np.argmax(d), d.shape)
    g = cv2.cvtColor(frames[i], cv2.COLOR_RGB2GRAY).astype(np.float32)
    gr = np.hypot(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))
    gr = cv2.GaussianBlur(gr, (0, 0), 6)
    yy, xx = np.mgrid[0:h, 0:w]
    gr[np.hypot(yy - hy, xx - hx) < 1.2 * S] = 0
    gr[: int(0.14 * h), int(0.76 * w) : int(0.92 * w)] = 0
    ey, ex = np.unravel_index(np.argmax(gr), gr.shape)
    for tag, (cy, cx) in (("head", (hy, hx)), ("edge", (ey, ex))):
        y0 = int(np.clip(cy - S // 2, 0, h - S))
        x0 = int(np.clip(cx - S // 2, 0, w - S))
        crop = Image.fromarray(frames[i][y0 : y0 + S, x0 : x0 + S]).resize((S * Z, S * Z), Image.NEAREST)
        tiles.append((crop, f"p{p} {i / 30:.2f}s {tag} @({x0},{y0})"))

cols = 5
for sheet_i in range(2):
    part = tiles[sheet_i * 10 : (sheet_i + 1) * 10]
    sheet = Image.new("RGB", (cols * (S * Z + 6), 2 * (S * Z + 18)), (16, 16, 20))
    dr = ImageDraw.Draw(sheet)
    for k, (im, label) in enumerate(part):
        x, y = (k % cols) * (S * Z + 6), (k // cols) * (S * Z + 18)
        sheet.paste(im, (x, y))
        dr.text((x + 3, y + S * Z + 3), label, fill=(230, 230, 230))
    sheet.save(f"{prefix}{sheet_i}.png")
