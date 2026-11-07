# Tile images into one labelled sheet: tile.py <out> <cols> <tile_width> <img>...
import sys
from pathlib import Path

from PIL import Image, ImageDraw

out, cols, tw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
paths = sys.argv[4:]
ims = [Image.open(p).convert("RGB") for p in paths]
th = round(ims[0].height * tw / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * th), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for i, (im, p) in enumerate(zip(ims, paths)):
    x, y = (i % cols) * tw, (i // cols) * th
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y))
    d.rectangle([x, y, x + 120, y + 16], fill=(0, 0, 0))
    d.text((x + 3, y + 2), Path(p).stem, fill=(255, 255, 0))
sheet.save(out)
print(out, sheet.size)
