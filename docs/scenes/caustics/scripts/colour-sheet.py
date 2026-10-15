# Tiles colour-shot.mjs's shots into one contact sheet: a row per palette,
# a column per Colour option, each tile labelled. Used for the 2026-10-15
# colour work.
# usage: uv run -q --with pillow python -I colour-sheet.py <shotDir> <out.png> <options e.g. 0,1,2> <palettes a,b> [scale]
import sys
from PIL import Image, ImageDraw

shot_dir, out = sys.argv[1], sys.argv[2]
options, palettes = sys.argv[3].split(","), sys.argv[4].split(",")
scale = float(sys.argv[5]) if len(sys.argv) > 5 else 0.5
names = {"0": "Shades", "1": "Shades + accent", "2": "Rainbow"}
tiles = [[Image.open(f"{shot_dir}/{p}-{o}.png").convert("RGB") for o in options] for p in palettes]
w, h = int(tiles[0][0].width * scale), int(tiles[0][0].height * scale)
pad = 4
sheet = Image.new("RGB", (len(options) * (w + pad), len(palettes) * (h + pad)), (20, 20, 20))
draw = ImageDraw.Draw(sheet)
for r, row in enumerate(tiles):
    for c, im in enumerate(row):
        x, y = c * (w + pad), r * (h + pad)
        sheet.paste(im.resize((w, h)), (x, y))
        draw.rectangle([x, y, x + 150, y + 18], fill=(0, 0, 0))
        draw.text((x + 4, y + 3), f"{palettes[r]}  {names.get(options[c], options[c])}", fill=(255, 255, 255))
sheet.save(out)
