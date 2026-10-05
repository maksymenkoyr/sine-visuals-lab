# Tiles screenshots into one sheet, numbered, for reading several at once.
# uv run -q --with pillow python tile.py <out> <cols> <scale> <frames...>
# or one "prefix-s%d.png:N" argument for N numbered frames.
import sys
from PIL import Image, ImageDraw

out, cols, scale = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
paths = sys.argv[4:]
# "prefix-s%d.png:N" expands to N numbered paths.
if len(paths) == 1 and ":" in paths[0]:
    pat, n = paths[0].rsplit(":", 1)
    paths = [pat % i for i in range(int(n))]
ims = [Image.open(p).convert("RGB") for p in paths]
ims = [im.resize((int(im.width * scale), int(im.height * scale))) for im in ims]
w = max(i.width for i in ims)
h = max(i.height for i in ims)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w + (cols - 1) * 4, rows * h + (rows - 1) * 4), (40, 40, 48))
for k, im in enumerate(ims):
    sheet.paste(im, ((k % cols) * (w + 4), (k // cols) * (h + 4)))
    ImageDraw.Draw(sheet).text(((k % cols) * (w + 4) + 6, (k // cols) * (h + 4) + 4), str(k), fill=(255, 80, 80))
sheet.save(out)
