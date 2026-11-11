# seamflow.py's floor: one mirrored frame made exactly symmetric, then zoomed about its exact centre with a
# sub-pixel warp, so nothing crosses the centre line by construction. Encode the frames (ffmpeg -framerate
# <fps> -i z_%04d.png, crf near the source's) and run seamflow.py on the clip.
# usage: zoomclip.py <frame.png> <out_dir> <frames> <log-scale per s> <fps>
import sys
from pathlib import Path

import cv2
import numpy as np

src, out, n, z, fps = sys.argv[1], Path(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
out.mkdir(parents=True, exist_ok=True)
im = cv2.imread(src)
h, w = im.shape[:2]
half = im[:, : w // 2]
im = np.concatenate([half, half[:, ::-1]], 1)
cx, cy = (w - 1) / 2, (h - 1) / 2
for i in range(n):
    s = np.exp(z * i / fps)
    M = np.array([[s, 0, (1 - s) * cx], [0, s, (1 - s) * cy]], np.float64)
    cv2.imwrite(str(out / f"z_{i:04d}.png"), cv2.warpAffine(im, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT))
print(n, "frames in", out)
