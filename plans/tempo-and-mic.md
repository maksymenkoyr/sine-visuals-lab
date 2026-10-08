# Tempo that locks faster and survives a loud party mic

The BPM card and the Metronome should find the right tempo sooner and get it
right more often, especially from a phone or laptop mic in a loud room full
of people. Research found that the mic itself is not the main problem: the
tempo detector changes its answer when the mic is quieter, room echo adds
fake hits, and even clean audio fools it, because it only hears the kick
and snare. The plan: first measure the user's own party recordings, then
make hit detection immune to volume, echo and noise, then try a smarter
tracker that commits as soon as the music is clear, and swap it in only if
it wins everywhere. One phase makes Auto pick mic settings that keep hits
distinct in a loud room.

Researched 2026-10-06.

## Decisions

- Faster *and* more precise, "without sacrifices": a change ships only if
  it costs no track on the scoreboard (synthetic, simulated mic, the 6 real
  songs, the party recordings) — the user's own ask.
- Mic research before tracker work: "before do small research on what
  exactly makes mic so much worse".
- The mic research uses the user's own party videos ("it was loud and a lot
  of noise around"), not only the simulated room in
  `tests/tempoEval/micChain.ts`.
- The new tracker is prototyped and scored on `npm run eval:tempo` plus the
  6 real songs before anything in the app is replaced — the user said "yes"
  to that.

## Prototypes

How the Visualizer Hears Tempo (the BPM lab: today's pipeline, stage by stage, on real or synthetic audio)
https://claude.ai/artifact/5qcGsBrmY6ZytbfuSeM78B

## Rejected

- Rerunning the tempo scoreboard with the user's Sensitivity / Expansion /
  Smoothing — those three are applied after tempo and hit detection (see
  "Learned while building"), so tempo is identical by construction. The
  settings were tested on the picture instead.
- An autocorrelation tempo estimator — tried in #143: it locked onto half
  time on drum & bass and recovered slowly from tempo steps (the
  `src/audio/tempoAnalyzer.ts` header).
- Tuning against the simulated room alone — its echo is crude (four
  feedback combs with a long tail). It wrecks the sparse synthetic tracks,
  while the 6 real songs barely move through it.

## Open questions

- What tempo is true in each party video? Phase 1 measured 130 BPM for all
  four (one clip sharply, the rest 129–131) and scores them at that; the
  user hasn't confirmed it. A wrong guess by even 2 BPM changes every
  party row's % right.
  A fifth clip, from an hour later (`pxl-20261001-014721110`, 77 s), is
  "Goosebumps" by Claudinho Brasil (named by the user): 145 BPM psytrance
  per Beatport. Today's tracker reads it right 16% of the time, #403 21%;
  its bass drops out for about 30 s mid-clip, and no steady tempo
  measures in 15 s windows.
- In a loud room, should Auto pick what the user does by hand (Expansion
  well above 1×, Sensitivity near 1×, Smoothing low), accepting more twitch
  on crowd noise for punchier hits? — blocks phase 4.
- Between songs in a DJ set, should a new song start from the last song's
  tempo (beat-matched mixes rarely jump far)? This is Claude's idea, not
  yet the user's call — blocks the carry-over part of phase 6.

## Phases

Each phase is one build session and one PR.

- [x] **1. The user's party recordings become a test set, with a short report on what a real loud room does to the sound** — PR #404
  - Touches: a `tools/` script that pulls mono 48 kHz audio from the
    videos into gitignored `tools/.cache/mic-recordings/<slug>/{audio.wav,meta.json}`
    (never commit them: private recordings of copyrighted music);
    `tests/tempoEval/` gains a path that scores those files like the
    tempo-tracks set.
  - Read first: the `tests/tempoEval.test.ts` header,
    the `tests/tempoEval/micChain.ts` header, the `src/audio/tempoAnalyzer.ts`
    header, this plan's "Learned while building".
  - Done when: a table prints for each recording (% right, time to the
    right BPM, hits per bar on and off the beat grid); the report gives each
    recording's level, its noise floor next to the music, and how long its
    echo rings, compared with the defaults in `micChain.ts`, and retunes
    those defaults if the real room differs. The ffmpeg recipe that works
    here: imageio-ffmpeg via `uv` (Homebrew ffmpeg is broken on this machine).
- [ ] **2. Tempo reads the same from a near or a far mic** — draft PR #403 (with the echo half of phase 3; the user accepted its costs 2026-10-06)
  - Touches: `src/audio/tempoAnalyzer.ts` (`analyseHop`, `pickOnset`),
    the render-tick path in `src/audio/features.ts` if it shares the flaw;
    a level-sweep table in `tests/tempoEval.test.ts`.
  - Read first: the `tempoAnalyzer.ts` and `src/audio/tempoComb.ts` headers.
    Run `npm run eval:tempo` before and after.
  - Done when: the level sweep (see "Learned while building") stays flat
    across every level from 40 dB down to 10 dB up on every synthetic track, no
    scoreboard row loses, and the party set does not lose.
- [ ] **3. Room echo and crowd noise stop making fake hits**
  - Touches: the flux and onset picking in `tempoAnalyzer.ts`. Ideas:
    measure each new frame against the recent maximum, not just the
    previous frame, so a fading echo can't trigger; track each band's noise
    floor and subtract it.
  - Read first: as phase 2, plus phase 2's "Learned" entry.
  - Done when: off-grid hits per bar through the mic chain fall toward the
    clean numbers, the hip-hop and drum & bass mic rows recover toward
    clean, the party set improves, clean rows don't lose.
- [ ] **4. Auto keeps hits distinct in a loud room**
  - Touches: `SENSITIVITY_SPEC`, `EXPANSION_SPEC`, `SMOOTHING_SPEC` in
    `src/render/autoTune.ts`; the `loudness` dial in
    `src/render/musicProfile.ts`.
  - Read first: the `autoTune.ts`, `musicProfile.ts`,
    `src/audio/sensitivity.ts` and `src/audio/micAuto.ts` headers; the
    settings test in "Learned while building".
  - Done when: on the party set and the noisy simulation, hits under Auto
    stand out at least as much as under the user's manual settings, and
    crowd noise alone sits below the music's between-hit level.
- [ ] **5. A new tempo tracker runs side by side with today's and is scored, with nothing swapped yet**
  - Touches: a new DOM-free module under `src/audio/` (it must run in the
    AudioWorklet, like `tempoAnalyzer.ts`); a `run.ts` option to score it.
  - The idea: track tempo and beat position together as odds that update
    every hop, fed by separate kick, snare and hat streams (the snare's
    place in the bar decides half or double time, instead of leaning on
    `TEMPO_PRIOR_BPM`). It commits once the odds are clear and waits only
    when the music is genuinely ambiguous. Write it independently: don't
    port a research library's code or models (CLAUDE.md, `CONTRIBUTING.md`).
  - Read first: the `tempoComb.ts`, `tempoAnalyzer.ts`,
    `src/render/beatClock.ts` and `src/render/tempoSettle.ts` headers; the BPM lab.
  - Done when: a table compares old and new on every set (time to the right
    BPM, % right, beat placement), and the user decides whether to swap.
- [ ] **6. The BPM card shows the right tempo sooner**
  - Touches: `tempoSettle.ts` (a commit-by-confidence rule instead of a fixed
    `TEMPO_SETTLE_SEC` window), `src/render/metronome.ts`,
    `src/audio/tempoWorklet.ts` / `tempoSource.ts`, `beatClock.ts`; DJ-set
    tempo carry-over if the open question says yes.
  - Read first: as phase 5, plus the `src/render/tapTempo.ts` header (a tap
    seeds the same settle).
  - Done when: the card's number appears sooner on every track, with no
    loss on % right or on the Metronome rows.

## Learned while building

- 2026-10-06, research: today's scoreboard, fixed-hop path at 60 fps — time
  to the right BPM: house 0.52 s, hip-hop 3.37 s, drum & bass 2.00 s, ramp
  0.57 s. Through the simulated mic (host/TV, gate on): hip-hop 12% right,
  drum & bass 54%. The BPM card then waits on `TEMPO_SETTLE_SEC` on top.
- 2026-10-06, research, mic ablation (% right, fixed-hop path; each part of
  `micChain` alone or the full chain without it):

  | | house | hip-hop | dnb | ramp |
  |---|---|---|---|---|
  | clean | 97 | 91 | 91 | 99 |
  | full chain | 94 | 12 | 54 | 80 |
  | only the speaker high-pass | 97 | 96 | 86 | 98 |
  | only room echo | 94 | 16 | 0 | 93 |
  | only 20 dB quieter | 97 | 34 | 92 | 98 |
  | only quieter + noise | 97 | 13 | 94 | 95 |
  | full without echo | 95 | 30 | 72 | 88 |

  On the 6 real songs the full chain moves % right by at most about 10 points
  either way. The bass cut is harmless (the kick's click carries it).
- 2026-10-06, research, why: the detector picks only the loud hits (kick,
  snare); hats are almost never picked, even clean. Hip-hop's kicks land 3
  sixteenths apart, which fits 120 BPM nearly as well as 90; drum & bass sits
  between 87, 116 and 174. A near-tie like that flips on any nudge. Echo adds
  about 4 off-grid hits per bar on hip-hop. Real songs fail even clean:
  Levitating often reads 137 (4:3 of 103); Seven Nation Army reads 122–123
  against 124, possibly the band drifting rather than a tracker error.
- 2026-10-06, research, volume: the tempo worklet hears the raw mic —
  `src/audio/capture.ts` turns the browser's `autoGainControl` off, and the
  app's auto-gain never reaches `tempoSource.ts`. The detector is
  level-dependent: `Math.log1p(LOG_C * mag)` is nearly linear for quiet
  input, and `pickOnset` adds a fixed constant to its threshold. Level sweep
  (% right, no noise or echo):

  | | +10 dB | 0 | −10 | −20 | −30 | −40 |
  |---|---|---|---|---|---|---|
  | house | 96 | 97 | 97 | 97 | 97 | 96 |
  | hip-hop | 80 | 91 | 84 | 34 | 3 | 0 |
  | dnb | 95 | 91 | 86 | 92 | 92 | 0 |
  | ramp | 98 | 99 | 99 | 98 | 98 | 98 |

  Quiet hip-hop picks exactly the same hits as clean; only their strengths,
  and so the vote, change.
- 2026-10-06, research, the user's mic settings: Sensitivity, Expansion and
  Smoothing never touch tempo or hit detection. `applySensitivity` runs on
  the frame the scenes read (`app.ts`); `smoothingRateScale` scales the
  envelopes and pulse tails; the metronome's settle is pushed raw `dtSec`.
  Test: 3 synthetic and 4 real songs through a loud-party chain (high-pass
  150 Hz, echo 0.3, music −6 dB, noise −22 dB), 6 s of noise alone first,
  scoring `energy`. "Hit lift" is the peak just after a hit minus the level
  between hits; "flicker" is the mean change per frame.

  | Sensitivity / Expansion / Smoothing | hit lift | flicker | noise alone |
  |---|---|---|---|
  | defaults 1 / 1 / 1 | 0.10 | 0.020 | 0.43 |
  | Auto from the user's screenshot 2.1 / 1.1 / 1.4 | 0.05 | 0.011 | 0.68 |
  | 2.1 / 2 / 0.3 | 0.11 | 0.025 | 0.70 |
  | 1.0 / 2 / 1.0 | 0.13 | 0.026 | 0.41 |
  | 1.0 / 2 / 0.3 | 0.18 | 0.036 | 0.38 |
  | 1.0 / 3 / 0.25 | 0.23 | 0.046 | 0.34 |
  | 1.0 / 2 / Off | 0.27 | 0.072 | 0.22 |

  Expansion does make hits stand out, but only with Sensitivity near 1×:
  at 2.1× every level is already above Expansion's midpoint. Low Smoothing
  adds punch and also twitches on crowd noise alone. In every row, noise
  alone sits at about the music's between-hit level.
- 2026-10-06, research, method: the scripts lived in a session scratch dir
  and are gone. To redo the ablation, call `evaluate({ ...track, mono:
  micChain(track.mono, SR, opts) }, 60, { analyzer: true })` with one
  `MicChainOpts` field at its default and the rest neutral (`hpHz` 1, `wet`
  0, `noiseDb` −300, `gainDb` 0). The real songs are mono 16-bit 48 kHz WAVs
  with a LIST chunk before `data`; score each one as a single tempo segment
  at its `meta.json` BPM. Node runs the repo's TS directly.
- 2026-10-06, phase 2 (#403): the old fixed log knee was also the far
  mic's noise gate: through `micChain` the music peaks only ~10 dB above
  it and the room noise sits just under it, in every band. Scaling by
  level alone lifted the noise and the comb echo into the vote, and every
  mic row lost. So #403 adds a per-band noise floor (the knee never sits
  below `NOISE_KNEE_DB` over it) and an echo guard (flux against each
  band's max over `FLUX_REF_HOPS` hops). Phase 3 still owns crowd noise
  and a real room's diffuse tail.
- 2026-10-06, phase 2: the per-band floor also settles on a song's
  sustained sound. That was the biggest real-song win (Levitating 38 → 95%
  clean) and cost the first lock: house 0.52 → 1.02 s, ramp 0.57 → 1.13 s.
  A floor starting from zero restores those locks but loses hip-hop
  (93 → 77%). A single median-band floor keeps the kick but collapses
  hip-hop clean to ~50%.
- 2026-10-06, phase 2: `REFRACTORY_SEC` was 100 ms, longer than a
  sixteenth at 174 BPM, so drum & bass lost its snare whenever the kick
  before it was heard and read 116. The render-tick path in
  `src/audio/features.ts` still has the same lockout
  (`ONSET_REFRACTORY_SEC`) and still swings with level (dnb 5% right at
  +10 dB, hip-hop 38% at −40 dB). Its onsets also drive visual hits.
- 2026-10-06, method: single runs of the synthetic tracks flip on
  near-ties (dnb clean read 91% on main at offset 0 but 78% averaged). Score
  each synthetic track at 8 small start offsets (prepend 0–401 samples,
  shift `tempo`/`beats`/`gridBeats`) and average before calling a change a
  win or a loss.
- 2026-10-06, phase 1: four phone videos from the user's party (16–34 s
  each, one DJ set at ~130 BPM) are the `mic-recordings` set;
  `npm run eval:tempo:real` scores them next to the 6 songs clean and
  through `micChain`. Today's tracker reads the party right 6–18% of the
  time; #403 reads it right 42–54%, with fewer off-beat hits. The phone
  video's audio went through the phone's own processing (likely gain
  control), unlike the app's mic (`autoGainControl` off), so treat its
  level and dynamics as approximate.
- 2026-10-06, phase 1, the room against `micChain`: the party PA kept far
  more bass than the simulated small speaker, and the phone heard the
  music about 20 dB louder, so `micChain`'s `hpHz` and `gainDb` defaults
  were refitted. The party's hits fade slower than the simulated room's,
  but the combs can't slow the fade without filling the gaps between hits
  well past the party's, and the fade depends on the (unknown) music, so
  `wet` and `noiseDb` stay. The refit made today's tracker worse through
  the mic (drum & bass 54 → 2%: with the bass back, the kick is heard and
  the old 100 ms lockout drops the snare) and #403's better; together they
  pass the scoreboard.
- 2026-10-06, phase 1: through the refitted room #403 flips Tarantula
  (174) to half time for about half the clip, where today's tracker holds
  174 — an octave tie for phase 5's tracker (the snare's place in the bar).
