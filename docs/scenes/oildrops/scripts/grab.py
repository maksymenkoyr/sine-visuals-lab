# Saves full-resolution frames at given times. Usage: grab.py <video> <outPrefix> <t1,t2,...> [width]
import sys
import cv2
video, prefix, ts = sys.argv[1:4]
width = int(sys.argv[4]) if len(sys.argv) > 4 else 0
cap = cv2.VideoCapture(video)
for t in map(float, ts.split(",")):
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, f = cap.read()
    if not ok: print("fail", t); continue
    if width: f = cv2.resize(f, (width, int(f.shape[0] * width / f.shape[1])), interpolation=cv2.INTER_AREA)
    p = f"{prefix}_{t:07.2f}.jpg"; cv2.imwrite(p, f, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(p, f.shape)
cap.release()
