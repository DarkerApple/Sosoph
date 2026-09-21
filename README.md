# Sosoph

A four-key falling-note rhythm game that runs in the browser. No build step, no
dependencies, and no audio files — the soundtrack is synthesized live with the
Web Audio API, so the chart and the music share a single timeline and cannot
drift apart.

## Run it

```bash
npm start          # http://localhost:8080
```

`server.js` is a ~40-line zero-dependency static server. Any other static server
works too; the game just needs to be served over HTTP, since ES modules do not
load over `file://`.

```bash
npm run check      # validate the Stage 1 chart, headless
```

## Playing

| | |
|---|---|
| Lanes | <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> (arrow keys also work) |
| Touch | tap or slide across the lanes |
| Pause | <kbd>Esc</kbd> |

Long notes must be held until they run out. Releasing early breaks the combo.

Judgement windows are ±45 ms Perfect, ±90 ms Great, ±135 ms Good. Score is
1,000,000 split 90 % accuracy / 10 % combo, so a full Perfect run scores exactly
one million.

## Stage 1 — "Neon Drift"

128 BPM, 1:33, 248 notes (16 of them holds), peaking at 9 notes/second.

The chart is authored in `js/song.js` alongside the music it belongs to. The
melody drives the note map directly: pitch is mapped across the four lanes, so
the chart traces the tune's contour, trailing rests become hold notes, and the
claps on beats 2 and 4 become two-lane jumps. Sections ramp from quarter notes
in the verse through sixteenth rolls in the build, a sparse hold-based break,
and a denser final chorus.

Note times are written in beats and converted once, which keeps the chart
readable and immune to BPM rounding.

## What makes it feel smooth

**A drift-corrected transport clock.** `AudioContext.currentTime` only advances
once per render quantum, so reading it directly makes notes visibly stair-step.
`AudioEngine.update` runs a free clock off the animation-frame delta and slews
it toward the audio clock, hard-resyncing only after a real stall. Motion is
sub-millisecond smooth and still can't drift.

**Positions are pure functions of time.** Every note's Y coordinate is derived
from the clock rather than integrated frame to frame, so the game is correct at
30, 60 and 144 Hz with no interpolation hacks.

**Latency-aware judging.** The transport is offset by `outputLatency`, so "now"
means what the player is *hearing*. Key presses are rewound using the event's
`timeStamp` instead of being judged on the next frame, which is worth several
milliseconds of accuracy. A manual offset slider covers the rest.

**Framerate-independent easing.** Everything reactive — lane glow, the score
counter, combo pops, background bloom — is exponentially damped via
`damp(a, b, lambda, dt)`, so animations feel identical regardless of refresh
rate.

**No allocation during play.** Particles come from a fixed pool and glow-heavy
note graphics are pre-rendered to sprites on resize, so the frame loop never
touches `shadowBlur` and the GC never causes a hitch mid-song.

## Layout

```
index.html          shell and menu markup
css/style.css       menu chrome (the playfield is all canvas)
js/main.js          settings, screen routing, frame loop
js/song.js          Stage 1: soundtrack + note map
js/audio.js         synth rack, lookahead scheduler, transport clock
js/game.js          judgement, scoring, hold logic
js/renderer.js      canvas rendering
js/particles.js     pooled particle system
js/input.js         low-latency keyboard and touch
tools/check-chart.js  headless chart validator
```

`window.sosoph` exposes the live `game`, `song`, `audio` and `renderer` for
poking at from the console.

## Also in this repo

`viewmodel-mod/` is an unrelated side project: a Fabric client mod for Minecraft
1.21.1 that moves held item view models, tunes swing speed, and places items on the
body in third person, all from one in-game menu. See
[`viewmodel-mod/README.md`](viewmodel-mod/README.md).
