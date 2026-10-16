# /// script
# dependencies = ["pillow>=10.1"]
# ///
"""tile.py out.png img... — square centre crops (ours: the swarm area of a
1280x720 shot), 400 px each, side by side."""
import sys
from PIL import Image

out, *paths = sys.argv[1:]
ims = []
for p in paths:
    im = Image.open(p).convert("RGB")
    if im.width > im.height * 1.5:
        im = im.crop((340, 60, 940, 660))
    else:
        im = im.crop(((im.width - im.height) // 2, 0, (im.width + im.height) // 2, im.height))
    ims.append(im.resize((400, 400)))
s = Image.new("RGB", (400 * len(ims), 400))
for i, im in enumerate(ims):
    s.paste(im, (i * 400, 0))
s.save(out)
