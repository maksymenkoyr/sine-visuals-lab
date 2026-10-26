# Audio engine

The audio engine in `src/audio/engine/` turns captured sound into what a scene
reacts to: band levels, kick, snare and hat hits, a tempo, and whether music is
playing at all. This note spans the engine's files. It says where each stage's
idea came from, what the app added around it, and how a reading reaches a TV.
Each file's header says what that file does; this note says why it is built the
way it is.

The engine began as a separate project that scored four earlier audio systems
(v1 to v4) against recordings and simulated rooms, then built v5 from the best
idea in each category. The copy in the app is that engine, plus the parts only
the app needs (the sections "What the app adds" and "From mic to TV").

## Shape

`AudioEngine` (`src/audio/engine/engine.ts`) has two calls. `push()` takes
captured audio as it arrives. `read()` is called once per rendered frame and
returns the reading for that frame. Audio is analysed as it is pushed, so the
results do not depend on the frame rate. A scene at 15 fps hears the same hits
as one at 60.

`src/audio/engineSource.ts` feeds it. `src/audio/engineWorklet.ts` hands every
render quantum of the capture to the main thread, stamped with the audio clock,
and the engine analyses it there. That is on purpose: a frame's band levels are
the level of exactly the audio since the frame before, and only the frame
knows when that is. If the browser has no audio worklet, a script-processor tap
feeds the same engine; its blocks arrive later, so beats sit a little late there.

The reading is `EngineReading` in `src/audio/types.ts`. The beat clock is not
part of the engine. Every device runs its own off the reading (see "What the app
adds"), so a TV keeps time the way the laptop does.

## The four stages

Each stage took the idea that won its category in the bench, then fixed what
that version got wrong. The numbers behind each choice are in "Bench results"
below; the code names the dials.

### 1. Band levels (`src/audio/engine/bands.ts`)

Taken from v3: time-domain band filters instead of an FFT. An FFT window adds
delay before a level can move, and the dB curves built on it flatten a kick into
a plateau. Filtered bands were the only ones in the bench that followed the
instruments.

Changed: v3 reported raw amplitude, so its levels barely moved. Now each band's
RMS is measured over exactly the audio since the previous frame and then
auto-ranged:

- The crossovers (`DEFAULT_BANDS`) are steep Linkwitz-Riley filters. The gaps
  between bands are on purpose: they keep a snare's body out of the lows and
  its sizzle partly out of the highs.
- The peak each band is ranged against rises quickly and falls slowly
  (`RANGE_DEFAULTS`). A slower fall kept a quiet passage dark for a long time
  after a loud one; a faster fall cost band separation.
- A band's peak may not fall far under its usual share of the loudest band's
  peak (`couplingDb`, with each band's `shareDb`). This is what stops another
  instrument's leakage driving a band to full scale. Tighter coupling separates
  hits better but squeezes bands that are quiet by nature in a mix. Looser
  coupling keeps quiet passages livelier but lets more leakage and talking
  through.
- The peak also stays a set distance above the band's noise floor
  (`noiseHeadroomDb`), so room tone maps near zero. Subtracting the noise
  outright was tried. It cut idle motion, but the "floor" of sustained music is
  music, and subtracting it bent the envelope.
- Falls are smoothed and rises are not. Above the `knee` the output bends
  towards 1 instead of clipping, so the top of a band never sits pinned.

### 2. Onset envelope and hits (`src/audio/engine/onsets.ts`)

Taken from v4: a short-time spectrum every `HOP` samples, grouped into
third-octave bands, log-compressed against the input's own level and against each
band's noise floor. Flux is measured against the recent maximum, not the
previous hop, so a room's echo cannot fire a hit twice. That made the envelope
read the same from a far mic as from a line-in.

Changed:

- Analysis waits for the first full window. A half-empty first frame seeded
  every band's noise floor too low, and the floor's later correction looked like
  a pulse at every tempo.
- A hit is a peak of the whole attack's rise (each band's level against its
  minimum over the last `FLUX_REF_HOPS` hops), summed over all bands, over a
  running mean plus `HIT_DEFAULTS.k` deviations and a minimum. An attack spreads
  over several hops, and only the whole rise tells a kick from a bass note.
  Separate per-drum detectors were tried and lost kicks under bass lines.
- A hit is named by where its rising energy sits on a log-frequency axis,
  against three cluster centres (kick, snare, hat) in `CLUSTERS`. The centres
  drift towards the hits they name, within limits. Naming by the rise in
  log level put every kick in the mids, because a click lifts every band's log a
  little. Only a hit may move a centre.
- A hit inside `REFRACTORY_S` of the one before is blocked, not fired. The
  refractory is short enough that drum & bass can put a kick and a snare that
  close.

### 3. Tempo, phase and presence (`src/audio/engine/tempo.ts`)

Taken from v3: the recency-weighted autocorrelation of the onset envelope, and a
comb search for the beat phase. That pair gave the best beat sync live.

Changed:

- The envelope's moving average (`DETREND_S`) is subtracted before the
  autocorrelation. A step in its baseline (music starting, a breakdown ending, a
  noise floor settling) otherwise correlates at every lag, and a quiet room read
  as a strong pulse at every tempo.
- Each candidate tempo is scored by the autocorrelation at its period plus a
  share (`DOUBLE`, `HALF`) of the score at twice and at half the period. A real
  beat repeats every two beats and splits in two. The 3:2 and 5:4 relatives that
  hats and syncopated kicks make periodic do not. That kept drum & bass off one
  wrong tempo and trap off another.
- Scores are integrated over time (`EVIDENCE_S`) along a path that may drift one
  step per update, and the held tempo changes only when a rival leads by
  `SWITCH_MARGIN`. One noisy window cannot move the tempo; a real change wins
  within a couple of seconds.
- If the half-beat positions hold nearly as many onsets as the beats
  (`OFFBEAT_ON`), the tempo is reported doubled. Drum & bass puts its snares
  between the beats of the half tempo the autocorrelation prefers. A lower
  threshold fixed more drum & bass but doubled hip-hop, pop and ambient through
  laptop speakers, whose missing bass makes the off-beat hats look strong.
- Music is "present" once the periodicity has stayed above `MUSIC_ON` for
  `MUSIC_ON_HOLD_S`, and until it stays under `MUSIC_OFF` for `MUSIC_OFF_HOLD_S`.
  Without presence there are no beats and the tempo reads 0. Talking with no
  music stays between the two lines; music under talking mostly stays above the
  upper one. Every earlier system showed a tempo and dozens of fake beats a
  minute with no music.
- A clearer pulse takes a faster path (`FAST_ON`, `FAST_S`, `FAST_HOLD_S`), so
  strong beats are followed sooner. Shortening the slow path instead let noise
  through.
- When the playing stops, the window still holds seconds of it. Presence ends
  at once when the envelope's recent mean falls under `STOP_RATIO` of its mean
  over the window, and the window starts over. Requiring recent hits instead
  was tried: a dense mix goes seconds without a hit strong enough, and one
  real drop's tempo accuracy fell.
- It also reports a downbeat: which beat of the bar carries the most bass, and
  how clearly. The envelope carries the lows' share of each sample for this.

### 4. Beat clock (`src/audio/engine/clock.ts`)

Taken from v3: a clock whose position is a function of time from an anchor. It
follows the tracker by pulling a share (`PHASE_PULL`) of each phase error per
update, and moves bar lines only after repeated confirmation
(`DOWNBEAT_CONFIRMATIONS`).

Changed: it snaps to the tracker's grid on first lock instead of pulling towards
it. It flags a beat on the frame nearest each whole beat, by looking half a
frame ahead, instead of on the first frame after it. That removes about half a
frame of lateness on average.

## What the app adds

The bench scored the engine alone. The app needed more from it.

### Guarantees the clock gives

`src/audio/engine/clock.ts` keeps promises the bench never asked for, because
beat grids (`src/render/gridPulse.ts`) and the metronome count whole beats:

- The position never goes back. The first snap goes forwards onto the grid, a
  bar move is taken as its forward equivalent, and a pull that would step back
  is held until the clock catches up. A count that steps back fires a beat
  twice.
- While the tracker hears no pulse the tempo coasts to a stop (`COAST_RATE`)
  instead of running on, so nothing keeps time to music that is not there.
- Two flagged beats are never closer than `MIN_BEAT_GAP`, whatever a phase pull
  does.
- A tap tempo (`src/render/tapTempo.ts`) seeds it. A tap at half the tracker's
  tempo makes it judge the tracker's beats against every half beat: the tracker's
  faster pulse corrects the timing, and the tap says which pulse is the beat. Bars
  are not moved meanwhile, because the tracker's bar is in its own beats.
- `follow()` returns the phase error it measured, which Lock's Stability meaning
  averages.

### One clock on every device

`src/render/animClock.ts` runs the engine's `BeatClock` on every device that
draws, off the reading each frame carries (`FeatureFrame.engine`). It runs on its
own timeline: the reading's beat times become ages against the frame's time, so a
TV's jitter-buffered frames and a solo capture's audio-clock times both work.
`src/render/beatTrim.ts` corrects the clock afterwards (a bar resync, a double or
half fix, a nudge).

`src/render/metronome.ts` sits on top of the clock. While it follows, it also takes
the clock's bar starts (the engine's downbeats): a whole-beat difference between
its bar position and the clock's moves its count forwards onto the clock's, never
back, and without a tick for the jump.

### Lock

Lock (`AnimFrame.tempoLock`) is how sure the clock is of its beat. It can mean
three things, set out in `src/render/lockMeaning.ts`: how small the clock's
recent phase corrections are (stability), whether the clock is locked to a
steady pulse at all (presence), or the engine's own confidence (clarity).
`LockMeter` computes all three each tick so they can be measured side by side.
The default, stability, is the one the "Lock meanings" table in
`tests/tempoEval.test.ts` scores highest: high when the tempo is right, low when
it is wrong, when there is no beat and after the music ends. Run
`npm run eval:tempo` to see it, or open the app in dev with `?lock=presence` or
`?lock=clarity` to watch another meaning.

### Hits, per device

The engine's kick, snare and hat become the Bass, Mid and Treble lanes
(`src/render/bandEnergy.ts`). The engine already detects, names and spaces the
hits, so the app decides only which of them a scene reacts to.

The engine gives each attack one name, so a hat that lands with a kick or a
snare never reaches Treble, and through laptop speakers few kicks are named
kicks. Bass and Treble also fire on a jump in the engine's own band level,
while the engine hears music with a clear pulse (`RISE_WINDOW_S` and the
dials beside it, `RISE_CONFIDENCE`). Presence alone let loud talking and
knocks near the mic through, in the few seconds it held on without music. Each
lane has a refractory (`GROUP_TUNING`'s `riseRefractorySec`), so a jump and the
engine's hit for the same sound count once. Mid takes only the engine's snares:
a jump in the mids fires on kicks and hats as well. Every device runs this off
its own frames' levels. The jump is measured over a window, not from one frame
to the next, so a TV's interpolated levels find nearly the same hits.

The silence gate (`src/audio/silenceGate.ts`) does that per device.
`hitPasses(strength, dimmer)` lets a hit through while its strength times the
gate's dimmer is over 1. A hit's strength is how far its peak cleared the
engine's threshold, so an open gate passes every hit and a shut one none. The
gate scales only that comparison. The engine's threshold, refractory, naming and
tempo tracking never see it, so the hiss of a quiet room is not amplified into
hits, and a clap in a silent room still opens its own gate. The tempo tracker
hears the audio before any gate, because a gated tracker starved tempo in rooms
the gate read as quiet.

### The rise, every hop

Besides hits, the onset detector reports each hop's rise against the hit
threshold, and which kind that rise is nearest. It is the naming rule without
moving a cluster centre, since only a hit may move one. The largest rise since
the last frame is the reading's `surge`, with `surgeKind`. The Hits drum roll
and the Onset surge signal read it, so a scene can lean into a build-up before
the hit lands. `blocked` marks a rise that peaked inside the refractory: a hit
that was blocked rather than missed.

### Fixed crossovers

The engine's crossovers are always `DEFAULT_BANDS`, the ones the bench measured.
`src/audio/bandSplit.ts`'s `BAND_SPLIT` names the band ladder's Bass, Mid and
Treble ranges for everything that reads the ladder (the lanes' loudness, the
strip's tints, Lead and Hats, the faders' lane weights), and it is fixed too:
nothing in the app moves either.

### No input settings

Nothing between the mic and the engine is a setting. The engine taps the raw
capture (`src/audio/capture.ts` turns off the browser's own echo cancelling,
noise suppression and gain), and every stage the app adds after it adjusts
itself: the silence gate tracks the room's floor (`src/audio/silenceGate.ts`),
auto-gain follows the room's band span (`src/audio/autoGain.ts`), and
Sensitivity, Expansion and Smoothing follow the music per scene
(`src/render/autoTune.ts`'s `resolveSensitivity` and friends). None of them
feeds back into the analysis.

### What is gone

The old fixed-hop tracker, its worklet and the feature extractor's onset and
tempo half are gone. `src/audio/features.ts` now makes only the band half of a
frame. `src/render/beatClock.ts` and `src/audio/tempoComb.ts` remain only for the
Toon Rave scene's dance.

## From mic to TV

The device that hears the sound runs the engine. Every other device builds the
same levels, hits and beat from the reading its frames carry.

1. `src/app.ts` reads the engine once per frame and writes it into the
   `FeatureFrame` (`engine`, and `bpm`). It also sets the older `onset` and
   `pulseOnset` flags from the strongest hit, for followers that predate the
   reading.
2. `src/net/wireDecimator.ts` thins the host's frames to the wire rate. A hit
   lasts one render tick, so a plain "send every Nth tick" would drop most of
   them. The decimator latches the strongest hit of each kind, the largest surge
   with its kind, and any blocked hit across the skipped ticks, and hands them over
   on the next send. The levels and the tracker's state are the sending tick's own,
   except that a frame carrying a hit goes out with at least the level that hit
   was heard at: a short sound's level has often fallen by the next tick, and the
   follower gates the hit on it.
3. `src/net/protocol.ts` carries the reading in the frame's engine tail: the three
   levels, the three hit strengths, the surge, a flag byte, the confidences and
   an update counter. Beat and bar times travel as ages in milliseconds against
   the frame's own time, so they come out right on whatever timeline the follower
   reads frames on. The relay never parses a frame. A frame without the tail
   decodes as nothing heard: that is a mixed-version pairing during a deploy.
4. `src/net/jitterBuffer.ts` rebuilds the reading at the render instant. Levels
   are interpolated between the frames around that instant, like the bands. The
   tracker's state comes from the latest frame at or before it. Hits cannot be
   interpolated: a one-frame spike would be smeared, or skipped if two frames
   arrive in a burst. Each kind has its own queue (`HitQueue`) holding the hits
   that have arrived but not yet come due, each stamped with its frame's time and
   level. A sample takes the strongest hit due by the render instant and removes
   every one that is. Network delivery can reorder, so the queue inserts in time
   order, and it holds at most `PENDING_HITS` per kind, dropping the oldest.
5. The TV's `animClock` runs the same clock, silence gate and lanes off the
   sampled reading with its own marks. It gates each hit on the level of the frame
   the hit came in (`EngineReading.hitLevel`), not the level at the render
   instant: a hit comes due a tick or more after its frame, and gating it on the
   later level dropped most of hip-hop's snares on the TV in the tempo eval's
   rooms. The pop-out's inbox (`src/net/outputSync.ts`) keeps the same level for
   the hits it latches.

The silence gate's marks are not part of a room's look. Only the device that
hears the room moves them; a paired TV holds `SILENCE_GATE_SEED`.

## Known limits (2026-10-24)

Measured in the tempo eval (`npm run eval:tempo`) and the v5 bench, on these
dates and tracks. They are facts about this build, not promises.

- Drum & bass reads at half its tempo. The eval's `dnb` track settles on half
  tempo from its first reading to the end, on every path. Its beats still land on
  true beats (every other one), so the metronome ticks on every other beat.
  The tempo targets leave `dnb` out for this reason.
- The first tempo takes about 4 s on a strong beat. Weaker pulses go through the
  slower presence path.
- Soft hats under loud kicks and snares are rarely named as hats. Treble finds
  them from its level's jumps instead ("Hits, per device"), which waits for a
  clear pulse: for the first seconds of a song, and in music the tracker hears
  only faintly, Treble fires on the engine's hats alone, which are few in a mix.
  With the jumps, Caustics on Billie Jean gets 212 Treble hits a minute; the
  engine's hats alone gave 14 and the old lanes 222.
- Through the eval's crude mic chain (`tests/tempoEval/micChain.ts`), the engine
  keeps a tempo for the few seconds after a track ends (house: 123.6 at the last
  frame). The old trackers did the same there (124.3); on random hits the engine
  shows none, where they showed 134.5.
- Over digital silence a lone kick's attack shows in the mid and high bands at
  about a third of the low band's level: nothing else sets their range. In a mix
  the other instruments do.
- Quiet music under louder talking or hum cannot be told apart from them. The
  bands show the louder sound.
- Through a laptop speaker a synthetic sine kick is little more than its click,
  so the engine names it a hat. Bass still fires on it from the low band's jump
  while music is playing.
- Through a phone-sized speaker there is nothing under the low band's crossover,
  and the low band stays near zero. Folding more of the range into it was tried: it
  moved with the chords and vocals, not the bass. Kick hits and beats still work.

## Bench results (2026-10-24)

Copied from the v5 project's README. The bench scored v5 at default settings
against v1 to v4, on every case and seed. Tuning saw seed 1 of the simulated
conditions and the one take of each live recording; seeds 2 and 3 were held out and
scored the same. Composite of the bench's equal-weight categories, 0 to 1, with its
95% bootstrap interval:

| set | v5 | v4 | v3 | v2 | v1 |
|---|---:|---:|---:|---:|---:|
| synthetic tracks through 11 simulated rooms and mics | **0.80** (0.78-0.81) | 0.64 | 0.55 | 0.62 | 0.63 |
| six real drops through the same rooms | **0.85** (0.84-0.87) | 0.69 | 0.63 | 0.64 | 0.63 |
| real laptop speakers to laptop mic, recorded | **0.81** (0.80-0.82) | 0.61 | 0.57 | 0.61 | 0.61 |

v5 ranks first in all 1000 resamples of each set. In the simulated rooms:

| measurement | v5 | best of v1 to v4 |
|---|---:|---:|
| beat sync (F-measure, any metrical level) | 0.95 | 0.82 (v3) |
| beat timing spread (IQR) | 5 ms | 12 ms (v3) |
| tempo right (octave errors allowed) / exact | 0.95 / 0.84 | 0.87 (v1) / 0.77 (v4) |
| bands follow the instruments (correlation) | 0.50 | 0.42 (v3) |
| band latency | 15 ms | 30 ms (v3) |
| hit precision / kick recall | 0.91 / 0.96 | 0.81 / 0.85 (v4) |
| fake beats a minute with no music | 4 | 89 (v3) |
| share of time a tempo is shown with no music | 5% | 73% (v2) |
| CPU per second of audio | 11 ms | 12 ms (v3) |

Where it is not first: quiet passages at -24 dB (0.75; v1 0.94), usable level
(0.90; v2 0.97), band separation on isolated hits (0.54; v3 0.59), exact tempo on
the real drops (0.78; v4 0.95) and time to lock from cold (about 5 s; v4 2 s on
real music).

The measurements behind individual choices, as the bench found them:

- Bands: time-domain filters followed the instruments (correlation 0.42 against
  0.20 for the FFT-based v4) and had the best latency. v3's raw amplitude gave a
  usable level of 0.21. The default coupling is -12 dB under a band's usual share;
  -18 dB scored 0.01 higher overall but let more leakage and talking through.
  Subtracting the noise floor cut idle motion and cost band following on the clean
  line-in.
- Onsets: separate per-drum detectors reached kick recall of only 0.14 to 0.53
  under bass lines.
- Tempo: on the real drops the doubling rule raised beat sync from 0.89 to 0.98 and
  exact tempo from 0.24 to 0.78. Rooms with talking and no music reach periodicity
  of 0.2 to 0.3; every earlier system showed a tempo and 48 to 135 fake beats a
  minute with no music. The fast path follows strong beats from about 4 s in,
  half a second sooner on average; shortening the slow path instead let in 13 to 17
  fake beats a minute. After a stop, the recent-to-window ratio falls to about 0.2;
  while drums play it never fell below 0.34 on any bench track.
- Clock: snapping on first lock and flagging the nearest frame removes an average
  8 ms of lateness at 60 fps.
- `idleGain`, which dims the bands while no music is present, is in the bench engine
  and off by default: it raised the idle score from 0.87 to 0.94 and cost about as
  much in quiet passages and in band following, because presence takes a few
  seconds to come on. The app's engine does not have the option.

### The app as integrated (2026-10-24)

The same bench scored the app as it runs the engine. It used a snapshot at
`49753e24`, wired as `tests/tempoEval/run.ts` wires it, with lane smoothing,
the silence gate, the metronome over the clock, Lock and the band faders all
in (the faders have since been removed from the panel). The extended bench is kept beside the original, at
`~/projects/audio-subsystem/bench-app`.

| set | app | app on a TV | v5 | v4 (the app before) |
|---|---:|---:|---:|---:|
| synthetic tracks through 11 simulated rooms and mics | 0.80 | 0.80 | 0.80 | 0.64 |
| six real drops through the same rooms | 0.85 | 0.85 | 0.85 | 0.69 |
| real laptop speakers to laptop mic, recorded | 0.81 | not run | 0.81 | 0.61 |

- No category is more than 0.01 below v5. A TV is scored at the instant its
  content was heard; its picture trails the laptop's by the room's render delay.
- The silence gate leaves every category within 0.02. It cuts false hits with no
  music from 58 a minute to 10, and costs some quiet hits: snare recall in music
  fell from 0.61 to 0.53, and isolated hats from 0.96 to 0.66.
- Hits by kind compares each lane's hits with the true hits of its kind
  (F-measure at 50 ms). With the engine's hits alone, the app found almost no
  hats in simulated music and almost no kicks through laptop speakers, which
  play almost no bass. The jumps on Bass and Treble (#682) fixed both. Rerun on
  2026-10-24 at `main` before and after:

  | lane, set | engine hits only | with the jumps | the app before the engine (v4) |
  |---|---:|---:|---:|
  | kick, simulated music | 0.69 | 0.71 | 0.62 |
  | snare, simulated music | 0.54 | 0.54 | 0.42 |
  | hat, simulated music | 0.02 | 0.46 | 0.52 |
  | kick, isolated hits | 0.68 | 0.67 | 0.28 |
  | snare, isolated hits | 0.82 | 0.82 | 0.37 |
  | hat, isolated hits | 0.70 | 0.71 | 0.25 |
  | kick, laptop speakers | 0.02 | 0.80 | 0.55 |
  | snare, laptop speakers | 0.37 | 0.37 | 0.38 |
  | hat, laptop speakers | 0.20 | 0.56 | 0.57 |

  On a TV the jumps find nearly as many: hat 0.46 in simulated music, kick
  0.76 through laptop speakers. The app's composites stayed 0.80, 0.85 and
  0.81, and its false hits with no music went from 9.88 to 9.95 a minute.
