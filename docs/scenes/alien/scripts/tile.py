# uv run -q --with pillow python tile.py <out.png> <cols> <tileWidth> <img...>
import sys
from PIL import Image

out, cols, tw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
imgs = [Image.open(p).convert("RGB") for p in sys.argv[4:]]
th = round(tw * imgs[0].height / imgs[0].width)
rows = (len(imgs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * th), (40, 40, 40))
for i, im in enumerate(imgs):
    im = im.resize((tw, round(tw * im.height / im.width)), Image.LANCZOS)
    sheet.paste(im, ((i % cols) * tw, (i // cols) * th))
sheet.save(out)
print(out, sheet.size)
