# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9"]
# ///
import cv2, numpy as np, sys
cap = cv2.VideoCapture(sys.argv[1]); fps = 30
want = {56: [(0, 0, 360, 1)], 1155: [(380, 60, 240, 2), (300, 300, 120, 4)]}
tiles = []
i = -1
while True:
    ok, fr = cap.read()
    if not ok: break
    i += 1
    if i in want:
        for x, y, s, z in want[i]:
            c = fr[y:y+s, x:x+s]
            c = cv2.resize(c, (s*z, s*z), interpolation=cv2.INTER_NEAREST)
            cv2.putText(c, f"t{i/fps:.2f} x{x} y{y} {s}px x{z}", (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
            tiles.append(c)
    if i > max(want): break
H = max(t.shape[0] for t in tiles)
sheet = np.hstack([cv2.copyMakeBorder(t, 0, H - t.shape[0], 0, 6, cv2.BORDER_CONSTANT, value=(40, 40, 40)) for t in tiles])
cv2.imwrite("crops.png", sheet)
print(sheet.shape)
