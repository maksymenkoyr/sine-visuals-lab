# How boxy a picture's detail is, for comparing our Roundness values with the reference's box panels.
# In each patch the image gradients' orientations are averaged with their strength as weight, at four
# times their angle: squareness |sum w e^(4i theta)| / sum w is high where edges run in two directions at
# right angles (panels, window grids) and low for round holes and bubbles; at twice the angle, stripe-ness
# flags parallel lines, which also raise squareness. Only the patches above the quarter with the least
# detail count. Also: the lit share and the near-white share (luma above 0.6, saturation below 0.3).
# Frames are scaled to 960 wide first, so the patch is the same share of the picture for any source.
# usage: boxiness.py <patch_px> <img...>
import sys

import cv2
import numpy as np

P = int(sys.argv[1])
print(f"{'frame':<26} square stripe  lit  white")
for path in sys.argv[2:]:
    im = cv2.imread(path)
    im = cv2.resize(im, (960, round(im.shape[0] * 960 / im.shape[1])), interpolation=cv2.INTER_AREA)
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    w = np.hypot(gx, gy)
    th = np.arctan2(gy, gx)
    e4, e2 = w * np.exp(4j * th), w * np.exp(2j * th)
    H, W = g.shape
    sq, st, ws = [], [], []
    for y in range(0, H - P + 1, P):
        for x in range(0, W - P + 1, P):
            s = w[y:y + P, x:x + P].sum()
            if s < 1e-3:
                continue
            sq.append(abs(e4[y:y + P, x:x + P].sum()) / s)
            st.append(abs(e2[y:y + P, x:x + P].sum()) / s)
            ws.append(s)
    if not ws:
        print(f"{path.split('/')[-1][:25]:<26} no detail")
        continue
    ws = np.array(ws)
    keep = ws > np.percentile(ws, 25)
    rgb = im[..., ::-1].astype(np.float32) / 255
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 0.05, (mx - mn) / np.maximum(mx, 1e-6), 0)
    print(f"{path.split('/')[-1][:25]:<26} {np.average(np.array(sq)[keep], weights=ws[keep]):.3f}  "
          f"{np.average(np.array(st)[keep], weights=ws[keep]):.3f}  {np.mean(lum > 0.18):.2f}  {np.mean((lum > 0.6) & (sat < 0.3)):.3f}")
