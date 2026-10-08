"""
Draws the look icon (src/ui/lookIcon.ts): a green alien face made of a few
polygons and ellipses, blurred, box-downscaled to the icon's size and
quantized to a small palette. Prints the base64 PNG to paste into ICON_SRC.

Run: python3 tools/look-icon.py <ICON_W> <ICON_H>  (needs Pillow); pass the
two sizes from src/ui/lookIcon.ts.
"""
import base64
import io
import math
import sys

from PIL import Image, ImageDraw, ImageFilter

ICON_W, ICON_H = int(sys.argv[1]), int(sys.argv[2])
SCALE = 20  # drawn this many times larger, then shrunk
W, H = ICON_W * SCALE, ICON_H * SCALE


def p(x, y):
    """The shapes below are laid out on a 400 x 320 canvas."""
    return (x * W / 400, y * H / 320)


im = Image.new("RGB", (W, H), (232, 236, 224))
d = ImageDraw.Draw(im)
head = [(200, 10), (290, 40), (345, 110), (340, 175), (300, 240), (240, 300),
        (200, 318), (160, 300), (100, 240), (60, 175), (55, 110), (110, 40)]
d.polygon([p(*q) for q in head], fill=(108, 170, 72))
chin = [(110, 210), (290, 210), (240, 300), (200, 318), (160, 300)]
d.polygon([p(*q) for q in chin], fill=(84, 140, 56))
d.ellipse([*p(150, 30), *p(250, 100)], fill=(140, 196, 100))


def eye(cx, tilt):
    pts = []
    for i in range(48):
        t = i / 47 * 2 * math.pi
        x = 66 * math.cos(t)
        y = 44 * math.sin(t) * (1.0 if math.sin(t) > 0 else 0.8)
        pts.append(p(cx + x * math.cos(tilt) - y * math.sin(tilt),
                     150 + x * math.sin(tilt) + y * math.cos(tilt)))
    d.polygon(pts, fill=(20, 26, 18))


eye(132, 0.42)
eye(268, -0.42)
d.ellipse([*p(140, 120), *p(162, 142)], fill=(205, 225, 195))
d.ellipse([*p(238, 120), *p(260, 142)], fill=(205, 225, 195))
d.line([p(188, 262), p(212, 262)], fill=(52, 96, 36), width=max(1, round(6 * W / 400)))

im = im.filter(ImageFilter.GaussianBlur(4 * W / 400))
small = im.resize((ICON_W, ICON_H), Image.BOX).quantize(colors=24, method=Image.Quantize.MEDIANCUT)
buf = io.BytesIO()
small.save(buf, "PNG", optimize=True)
print(base64.b64encode(buf.getvalue()).decode())
