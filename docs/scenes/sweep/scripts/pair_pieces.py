# uv run -q --with pillow --with opencv-python-headless python docs/scenes/sweep/scripts/pair_pieces.py <video> <pieces.json> <oursDir> <out.png>
# (<pieces.json> from `lookcodes.ts --json`)
# The output holds reference frames: keep it in the local cache, never in this repo.
# Two columns per piece (reference at its time | ours), five pieces per row.
import json
import sys

import cv2
from PIL import Image, ImageDraw

video, pieces_path, ours_dir, out = sys.argv[1:5]
pieces = json.load(open(pieces_path))
cap = cv2.VideoCapture(video)
T = 230
cols = 5
rows = (len(pieces) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (2 * T + 10), rows * (T + 16)), (16, 16, 20))
d = ImageDraw.Draw(sheet)
for i, p in enumerate(pieces):
    x0 = (i % cols) * (2 * T + 10)
    y0 = (i // cols) * (T + 16)
    cap.set(cv2.CAP_PROP_POS_MSEC, p["ref"] * 1000)
    ok, f = cap.read()
    if ok:
        sheet.paste(Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)).resize((T, T)), (x0, y0))
    try:
        ours = Image.open(f"{ours_dir}/{i}-{p['name']}.png").convert("RGB")
        w, h = ours.size
        s = min(w, h)
        ours = ours.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((T, T))
        sheet.paste(ours, (x0 + T, y0))
    except FileNotFoundError:
        pass
    d.text((x0 + 3, y0 + T + 2), f"{p['name']}: ref {p['ref']:.1f}s | ours", fill=(230, 230, 230))
sheet.save(out)
