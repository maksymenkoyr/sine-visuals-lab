# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9"]
# ///
import sys, numpy as np, cv2
cap = cv2.VideoCapture(sys.argv[1]); fps = cap.get(cv2.CAP_PROP_FPS)
tiles = []
for t in map(float, sys.argv[2].split(",")):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps)); ok, f = cap.read()
    c = cv2.resize(f[0:34, 0:200], None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    cv2.putText(c, f"{t:.0f}s", (520, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
    tiles.append(c)
cv2.imwrite(sys.argv[3], np.vstack(tiles))
