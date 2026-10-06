# tile.py <out> <cols> <scale> <frames...> — plain grid, row-major, with the
# file stem printed in each tile's corner.
import sys
from PIL import Image, ImageDraw

out, cols, scale = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
ims = [Image.open(p).convert("RGB") for p in sys.argv[4:]]
w, h = int(ims[0].width * scale), int(ims[0].height * scale)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w + (cols - 1) * 4, rows * h + (rows - 1) * 4), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for i, (im, p) in enumerate(zip(ims, sys.argv[4:])):
    x, y = (i % cols) * (w + 4), (i // cols) * (h + 4)
    sheet.paste(im.resize((w, h)), (x, y))
    d.text((x + 4, y + 4), p.rsplit("/", 1)[-1].rsplit(".", 1)[0], fill=(255, 80, 80))
sheet.save(out)
