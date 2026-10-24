# Lateral chromatic aberration test: per tile, the shift that best aligns the
# red channel's gradient to the blue channel's. A lens-style split is radial
# and grows with distance from the centre; a colour ramp in the gas has no
# consistent shift.
#   uv run --with numpy --with pillow python -I ca.py <full-res frame.png>...
import sys, numpy as np
from PIL import Image

S = 6
for path in sys.argv[1:]:
    im = np.asarray(Image.open(path).convert("RGB"), np.float32) / 255
    H, W, _ = im.shape

    def grad(c):
        gx = np.zeros_like(c); gy = np.zeros_like(c)
        gx[:, 1:-1] = c[:, 2:] - c[:, :-2]
        gy[1:-1] = c[2:] - c[:-2]
        return np.hypot(gx, gy)

    R, G, B = grad(im[..., 0]), grad(im[..., 1]), grad(im[..., 2])
    print(path)
    rows = []
    ty, tx = 5, 8
    for j in range(ty):
        for i in range(tx):
            y0, y1 = j * H // ty + S, (j + 1) * H // ty - S
            x0, x1 = i * W // tx + S, (i + 1) * W // tx - S
            b = B[y0:y1, x0:x1]
            if b.std() < 0.01:
                continue
            best = (-9, 0, 0)
            for dy in range(-S, S + 1):
                for dx in range(-S, S + 1):
                    r = R[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
                    c = float(((r - r.mean()) * (b - b.mean())).mean() / (r.std() * b.std() + 1e-9))
                    if c > best[0]:
                        best = (c, dx, dy)
            cx = (x0 + x1) / 2 - W / 2
            cy = (y0 + y1) / 2 - H / 2
            rr = np.hypot(cx, cy) / (H / 2)
            # radial component of the red-from-blue shift (positive = red sits further out)
            radial = (best[1] * cx + best[2] * cy) / (np.hypot(cx, cy) + 1e-9)
            rows.append((rr, best[1], best[2], radial, best[0]))
    rows.sort()
    for rr, dx, dy, rad, c in rows:
        print(f"  r={rr:.2f} shift=({dx:+d},{dy:+d}) radial={rad:+.1f}px corr={c:.2f}")
