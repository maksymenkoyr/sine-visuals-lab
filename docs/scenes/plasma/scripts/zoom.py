# Centre crops of each image at the same scale, enlarged and tiled in a row:
# zoom.py <out.png> <frac> <scale> <img>...  (frac = crop size as a share of
# the frame; every image is first resized to 1280x720 so crops match)
import sys

from PIL import Image

out, frac, scale = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
tiles = []
for p in sys.argv[4:]:
    im = Image.open(p).convert("RGB").resize((1280, 720), Image.LANCZOS)
    w, h = int(1280 * frac), int(720 * frac)
    x0, y0 = (1280 - w) // 2, (720 - h) // 2
    tiles.append(im.crop((x0, y0, x0 + w, y0 + h)).resize((int(w * scale), int(h * scale)), Image.LANCZOS))
sheet = Image.new("RGB", (sum(t.width for t in tiles), tiles[0].height))
x = 0
for t in tiles:
    sheet.paste(t, (x, 0))
    x += t.width
sheet.save(out)
print(out, sheet.size)
