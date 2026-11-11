# Detects droplets in one window of the clip at a fixed sample rate, in parallel chunks.
# Usage: run.py <video> <out.json> <family> <t0> <t1> [sampleFps]
import json, multiprocessing as mp, sys, time
sys.path.insert(0, "/Users/yaro/.claude/jobs/43f57e00/tmp/oil/tools")
import cv2
import numpy as np
import circles as C

FPS = 59.94

def work(job):
    video, family, idxs = job
    cv2.setNumThreads(1)
    cap = cv2.VideoCapture(video)
    cap.set(cv2.CAP_PROP_POS_FRAMES, idxs[0])
    want = set(idxs); out = []; k = idxs[0]
    while k <= idxs[-1]:
        ok, f = cap.read()
        if not ok:
            break
        if k in want:
            ds = C.detect(f, family)
            out.append({"i": k, "t": round(k / FPS, 3), "drops": [{kk: (round(v, 2) if isinstance(v, float) else v) for kk, v in d.items()} for d in ds]})
        k += 1
    cap.release()
    return out

if __name__ == "__main__":
    video, out_path, family, t0, t1 = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5])
    rate = float(sys.argv[6]) if len(sys.argv) > 6 else 5.0
    step = int(round(FPS / rate))
    all_idx = list(range(int(round(t0 * FPS)), int(round(t1 * FPS)), step))
    n = 8
    chunks = [all_idx[i:i + max(1, len(all_idx) // (n * 2))] for i in range(0, len(all_idx), max(1, len(all_idx) // (n * 2)))]
    jobs = [(video, family, c) for c in chunks if c]
    t = time.time()
    with mp.get_context("spawn").Pool(n) as p:
        res = p.map(work, jobs)
    frames = sorted((f for r in res for f in r), key=lambda f: f["i"])
    json.dump({"video": video, "family": family, "t0": t0, "t1": t1, "rate": rate, "step": step, "fps": FPS, "frames": frames}, open(out_path, "w"))
    c = [len(f["drops"]) for f in frames]
    print(f"{out_path}: {len(frames)} frames in {time.time() - t:.0f}s; circles per frame median {np.median(c):.0f}, min {min(c)}, max {max(c)}")
