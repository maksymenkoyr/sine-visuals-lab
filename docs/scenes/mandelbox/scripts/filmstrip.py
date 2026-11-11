# Filmstrip sheets from a decode.py stack, for counting changes of look by eye (no detector tried was clean
# enough to count the reference's hour): one frame every <step> s, <cols> x <rows> per sheet, labelled m:ss.
# usage: filmstrip.py <stack.npy> <stack_fps> <out_prefix> <step_s> <cols> <rows> [t_start t_end]
import sys

import numpy as np
from PIL import Image, ImageDraw

f = np.load(sys.argv[1], mmap_mode="r")
fps, pre, step, cols, rows = float(sys.argv[2]), sys.argv[3], float(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
t_start = float(sys.argv[7]) if len(sys.argv) > 7 else 0
t_end = float(sys.argv[8]) if len(sys.argv) > 8 else len(f) / fps
ts = np.arange(t_start, t_end, step)
h, w = f.shape[1:3]
lab = 12
for s in range(0, len(ts), cols * rows):
    chunk = ts[s:s + cols * rows]
    sheet = Image.new("RGB", (cols * (w + 2), rows * (h + lab + 2)), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    for k, t in enumerate(chunk):
        x, y = (k % cols) * (w + 2), (k // cols) * (h + lab + 2)
        sheet.paste(Image.fromarray(np.asarray(f[int(t * fps)])), (x, y + lab))
        d.text((x + 2, y), f"{int(t // 60)}:{t % 60:04.1f}", fill=(255, 255, 0))
    name = f"{pre}_{int(chunk[0]):04d}.png"
    sheet.save(name)
    print(name, sheet.size)
