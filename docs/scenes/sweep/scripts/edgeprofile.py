# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "pillow>=10"]
# ///
"""uv run docs/scenes/sweep/scripts/edgeprofile.py <video> <out.png>

Colour profile across Contours' stripes: pixel by pixel along the line
from the red head outward, frame 117 (3.9 s), from 150 to 230 px out.
Prints hex per pixel and writes a ×8 strip image. The head position is the
one finetouch.py's spacing check printed for that frame."""
import sys

import cv2
import numpy as np
from PIL import Image

cap = cv2.VideoCapture(sys.argv[1])
cap.set(cv2.CAP_PROP_POS_FRAMES, 117)
ok, f = cap.read()
f = cv2.cvtColor(f, cv2.COLOR_BGR2RGB).astype(np.float32)
head = np.array([400.0, 297.0])
red = (f[..., 0] > 190) & (f[..., 1] < 110) & (f[..., 2] < 110)
ground = np.median(f[:12].reshape(-1, 3), axis=0)
obj = np.linalg.norm(f - ground, axis=2) > 30
oy, ox = np.nonzero(obj)
far = np.array([ox[np.argmax(np.hypot(ox - head[0], oy - head[1]))], oy[np.argmax(np.hypot(ox - head[0], oy - head[1]))]])
d = (far - head) / np.linalg.norm(far - head)
row = []
for t in range(150, 231):
    x, y = head + t * d
    c = f[int(round(y)), int(round(x))]
    row.append(c)
    lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    print(f"{t:4d} #{int(c[0]):02x}{int(c[1]):02x}{int(c[2]):02x} lum {lum:5.0f} " + "#" * int(lum / 8))
strip = np.repeat(np.repeat(np.array(row)[None, :, :], 40, axis=0), 8, axis=1).astype(np.uint8)
Image.fromarray(strip).save(sys.argv[2])
