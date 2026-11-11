# Builds the study page's pictures and palette numbers from the clip and the detections.
import json, sys
import cv2, numpy as np
ROOT = "/Users/yaro/.claude/jobs/43f57e00/tmp/oil/"
OUT = ROOT + "out/"; PG = ROOT + "page/"
V = ROOT + "../dl/clip_4203.mp4"
cap = cv2.VideoCapture(V); FPS = 59.94

def frame(i):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(i)); ok, f = cap.read(); return f if ok else None

def jpg(path, img, q=74):
    cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, q])

def sheet(w, cols=3, rows=2, tile=(640, 360)):
    fr = json.load(open(OUT + f"det_{w}.json"))["frames"]
    picks = [fr[int(round(k * (len(fr) - 1) / (cols * rows - 1)))] for k in range(cols * rows)]
    tiles = []
    for p in picks:
        f = frame(p["i"])
        for d in p["drops"]:
            col = (255, 255, 0) if d.get("lens") else (0, 255, 255) if d.get("inside") else (255, 255, 255)
            cv2.circle(f, (int(round(d["x"])), int(round(d["y"]))), int(round(d["r"])), col, 2, cv2.LINE_AA)
        t = cv2.resize(f, tile, interpolation=cv2.INTER_AREA)
        cv2.rectangle(t, (0, 0), (92, 24), (0, 0, 0), -1)
        cv2.putText(t, f"{p['t']:.1f} s", (6, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(t)
    img = np.vstack([np.hstack(tiles[r * cols:(r + 1) * cols]) for r in range(rows)])
    jpg(PG + f"sheet_{w}.jpg", img)
    print("sheet", w, img.shape)

def trails(w, width=960):
    det = json.load(open(OUT + f"det_{w}.json")); fr = det["frames"]
    trk = json.load(open(OUT + f"trk_{w}.json"))
    f = frame(fr[0]["i"])
    f = (f * 0.55).astype(np.uint8)
    for t in trk["tracks"]:
        if np.median(t["r"]) < 12 or len(t["fi"]) < 10: continue
        pts = np.array([t["x"], t["y"]]).T.astype(np.int32)
        cv2.polylines(f, [pts], False, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.circle(f, tuple(pts[-1]), 5, (0, 255, 255), -1, cv2.LINE_AA)
    img = cv2.resize(f, (width, width * 1080 // 1920), interpolation=cv2.INTER_AREA)
    jpg(PG + f"trails_{w}.jpg", img)

def crop(name, i, cx, cy, half, size=560):
    f = frame(i); x0 = max(0, int(cx - half)); y0 = max(0, int(cy - half))
    c = f[y0:y0 + 2 * half, x0:x0 + 2 * half]
    c = cv2.resize(c, (size, size), interpolation=cv2.INTER_AREA)
    jpg(PG + name, c, 80)
    print("crop", name, "origin", x0, y0, "half", half)

FAMS = [("red", 345, 375), ("orange", 15, 45), ("yellow", 45, 75), ("green", 75, 170), ("blue", 170, 265), ("purple", 265, 300), ("pink/magenta", 300, 345)]
def fam(h, s):
    if s < 0.2: return "pale"
    for n, a, b in FAMS:
        if a <= h < b or a <= h + 360 < b: return n
    return "other"

def hexs(b):
    return "#%02x%02x%02x" % (int(b[2]), int(b[1]), int(b[0]))

def palette(ws):
    pool = {}; paint = []
    for w in ws:
        fr = json.load(open(OUT + f"det_{w}.json"))["frames"]
        for p in fr[:: 5]:
            f = frame(p["i"])
            H, W = f.shape[:2]; yy, xx = np.ogrid[:H, :W]
            mask = np.zeros((H, W), bool)
            for d in p["drops"]:
                if d.get("lens"): continue
                inside = (xx - d["x"]) ** 2 + (yy - d["y"]) ** 2 <= (1.1 * d["r"]) ** 2
                mask |= inside
                if d["r"] >= 12 and not d.get("inside"):
                    m = (xx - d["x"]) ** 2 + (yy - d["y"]) ** 2 <= (0.8 * d["r"]) ** 2
                    pool.setdefault(fam(d["h"], d["s"]), []).append(f[m][:: 16])  # a fixed stride keeps the pool area-weighted
            paint.append(f[~mask][:: 97])
    out = {}
    tot = sum(sum(len(a) for a in v) for v in pool.values())
    for k, v in pool.items():
        a = np.concatenate(v); out[k] = {"hex": hexs(np.median(a, axis=0)), "share_of_sampled": round(len(a) / tot, 3)}
    px = np.concatenate(paint).astype(np.float32)
    px = px[np.random.default_rng(3).choice(len(px), size=min(60000, len(px)), replace=False)]
    _, lab, cen = cv2.kmeans(px, 6, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.5), 4, cv2.KMEANS_PP_CENTERS)
    share = np.bincount(lab.ravel(), minlength=6) / len(lab)
    order = np.argsort(-share)
    return {"drops": out, "paint": [{"hex": hexs(cen[i]), "share": round(float(share[i]), 3)} for i in order]}

def pan_check(w):
    fr = json.load(open(OUT + f"det_{w}.json"))["frames"]
    res = []
    for p in fr[:: 5]:
        a = frame(p["i"]); b = frame(p["i"] + 60)
        if a is None or b is None: continue
        ga = cv2.resize(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), (960, 540), interpolation=cv2.INTER_AREA).astype(np.float32)
        gb = cv2.resize(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY), (960, 540), interpolation=cv2.INTER_AREA).astype(np.float32)
        (dx, dy), resp = cv2.phaseCorrelate(ga, gb, cv2.createHanningWindow((960, 540), cv2.CV_32F))
        res.append((dx / 60 * FPS / 9.6, dy / 60 * FPS / 9.6, resp))
    r = np.array(res)
    return {"whole_frame_shift_pct_per_s_vx_vy_median": [round(float(np.median(r[:, 0])), 2), round(float(np.median(r[:, 1])), 2)], "phase_corr_response_median": round(float(np.median(r[:, 2])), 3), "samples": len(r)}

res = {"pal_A": palette(("A1", "A2")), "pal_B": palette(("B",))}
json.dump(res, open(OUT + "assets_pal.json", "w"), indent=1)
print(json.dumps({k: v["drops"] for k, v in res.items()}))
