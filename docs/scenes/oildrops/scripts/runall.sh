#!/bin/bash
# Windows sit a quarter second inside the cuts found by cuts.py.
cd /Users/yaro/.claude/jobs/43f57e00/tmp/oil
V=../dl/clip_4203.mp4
tools/py tools/run.py $V out/det_B.json packed 106.8 123.1 5
tools/py tools/run.py $V out/det_A1.json redblue 0.25 10.55 5
tools/py tools/run.py $V out/det_A2.json redblue 160.7 179.2 5
