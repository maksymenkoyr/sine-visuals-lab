# pair.py out.png top1 top2 -- bot1 bot2 : two rows of 640x360 tiles (ours cropped of chrome: none, shots kept whole)
import sys
from PIL import Image

out = sys.argv[1]
rest = sys.argv[2:]
i = rest.index("--")
rows = [rest[:i], rest[i + 1:]]
W, H = 640, 360
cols = max(len(r) for r in rows)
sheet = Image.new("RGB", (W * cols, H * len(rows)), (16, 16, 16))
for y, row in enumerate(rows):
    for x, path in enumerate(row):
        sheet.paste(Image.open(path).convert("RGB").resize((W, H)), (x * W, y * H))
sheet.save(out)
