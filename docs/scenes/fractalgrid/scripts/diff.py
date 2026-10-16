# Compares two runs of shot.mjs --state, shot by shot (how the early-stop
# experiment in the record was checked).
# uv run -q --with pillow --with numpy python diff.py <a-prefix> <b-prefix> <n>
# Per pair: share of pixels differing by more than 8/255 and by more than 64/255 (ignoring the top/bottom UI bands).
import sys
import numpy as np
from PIL import Image

a, b, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
for i in range(n):
    x = np.asarray(Image.open(f"{a}-s{i}.png").convert("L"), dtype=np.int16)
    y = np.asarray(Image.open(f"{b}-s{i}.png").convert("L"), dtype=np.int16)
    h = x.shape[0]
    d = np.abs(x - y)[int(h * 0.1): int(h * 0.85)]
    print(f"s{i}: >8 {100 * (d > 8).mean():.3f}%  >64 {100 * (d > 64).mean():.3f}%  max {d.max()}")
