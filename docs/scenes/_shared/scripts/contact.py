# Tiles a set of screenshots into one labelled contact sheet, for eyeballing
# a burst of frames at once. Scene-agnostic (takes any PNG paths); used while
# tuning the Sky scene.
# Rescued from a working session on 2026-09-24.
# usage: contact.py OUT COLS IMG...
# May need adjusting to current code.
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow"]
# ///
"""Tiles screenshots into one labelled contact sheet: contact.py OUT COLS IMG...
Each tile is labelled with the part of its filename after the last '-'."""
import sys

from PIL import Image, ImageDraw

out, cols, paths = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
tw, th = 640, 400
rows = (len(paths) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * th), "black")
draw = ImageDraw.Draw(sheet)
for i, p in enumerate(paths):
    im = Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * th
    sheet.paste(im, (x, y))
    label = p.rsplit("-", 1)[-1].removesuffix(".png")
    draw.rectangle([x + 6, y + th - 30, x + 110, y + th - 6], fill="black")
    draw.text((x + 12, y + th - 26), f"t={label}", fill="white")
sheet.save(out)
print(out)
