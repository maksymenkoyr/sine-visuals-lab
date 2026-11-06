# Long exposure of each clip from clip.mjs (before-<shape>.webm, after-<shape>.webm), shot
# at Spin and Drift 0 so only the music moves the lines: the mean of its frames, lifted so rarely visited pixels
# show, in one grid with main on the left and this change on the right.
#   uv run -q --with imageio-ffmpeg --with pillow --with numpy python -I exposure.py <dir> <out.png>
import sys

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

clips, out = sys.argv[1:3]
W, H = 640, 360
CROP = (70, 0, 570, 360)
ROWS = [("0", "Circle"), ("6", "Cube"), ("9", "Tesseract")]
LABEL_H = 34
ROW_W = 110
FONT = ImageFont.load_default(size=20)


def exposure(path):
    reader = imageio_ffmpeg.read_frames(path, output_params=["-vf", f"fps=30,scale={W}:{H}"])
    meta = next(reader)
    w, h = meta["size"]
    total = None
    n = 0
    for raw in reader:
        frame = np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 3).astype(np.float32) / 255
        total = frame if total is None else total + frame
        n += 1
    mean = total / n
    return mean


exposures = {(s, side): exposure(f"{clips}/{side}-{s}.webm") for s, _ in ROWS for side in ("before", "after")}
# One lift for the whole grid, so main and this change are drawn to the same scale.
peak = np.percentile(np.concatenate([e.ravel() for e in exposures.values()]), 99.9)

cw, ch = CROP[2] - CROP[0], CROP[3] - CROP[1]
sheet = Image.new("RGB", (ROW_W + 2 * cw, LABEL_H + ch * len(ROWS)), (0, 0, 0))
draw = ImageDraw.Draw(sheet)
for i, title in enumerate(("main", "this change")):
    draw.text((ROW_W + i * cw + 12, 6), title, fill=(235, 232, 222), font=FONT)
for r, (s, name) in enumerate(ROWS):
    draw.text((10, LABEL_H + r * ch + ch // 2 - 12), name, fill=(235, 232, 222), font=FONT)
    for c, side in enumerate(("before", "after")):
        img = np.clip(exposures[(s, side)] / peak, 0, 1) ** 0.5
        tile = Image.fromarray((img * 255).astype(np.uint8)).crop(CROP)
        sheet.paste(tile, (ROW_W + c * cw, LABEL_H + r * ch))
sheet.save(out)
print("wrote", out)
