# Sosoph

A four-key rhythm game that runs in the browser. No build step, no dependencies
and no audio files — every soundtrack is synthesised live with the Web Audio
API, so the chart and the music share one timeline and cannot drift apart.

## Run it

```bash
npm start          # http://localhost:8080
npm run check      # validate every chart, headless
```

`server.js` is a ~40-line zero-dependency static server. Any other static server
works; the game just needs to be served over HTTP, since ES modules do not load
over `file://`.

## Playing

Four lanes on the home row, and three kinds of note:

```
  tap     press the lane key                        D F J K
  hold    press and keep holding
  flick   press, then roll onto the next key over    ← → ↓
```

A **flick** is not a second key to memorise. Your finger is already on the lane
key; finishing the note is one short roll in the direction the arrow points —
left or right along the same row, or down onto the key underneath, `C V N M`.
It is the same motion a touch player makes as a swipe, so the note means the
same thing on both.

A flick is graded on its *tap*, not on its roll: the timing you are being judged
on is the one you can feel. The roll has 160 ms to land, and if it never does
the note breaks.

Charts only place a flick when the key it rolls onto is genuinely free — for the
roll itself and for a moment beforehand, so the other hand has let go of that
key first. Flicks also come in figures rather than at random: a lone flick ends
a phrase, a pair rolls out and back, a sweep walks one direction across the
lanes.

| | |
|---|---|
| Pause | <kbd>Esc</kbd> |
| Song list | arrow keys to move, <kbd>Enter</kbd> to play |
| Touch | tap the lanes; swipe in the arrow's direction to finish a flick |

Long notes must be held until they run out; releasing early breaks the combo.
Judgement windows are ±45 ms Perfect, ±90 ms Great, ±135 ms Good. Score is
1,000,000 split 90 % accuracy / 10 % combo, so a full Perfect run scores exactly
one million.

Flicks can be turned off in settings, which plays every one as an ordinary tap.
Key bindings are remappable, and **Settings → Notes** sets the shape (bar,
capsule or circle), the size, and a colour per note kind, with a live preview
drawn from the real sprites.

Press <kbd>F3</kbd> at any time for the monitor: frame times, dropped frames,
audio clock drift, output latency, and your own hit offset with the audio-offset
value that would cancel it.

## Songs

Sixteen songs, 76 to 190 BPM, each with two to five charts.

| | Genre | BPM | Length | Charts |
|---|---|---|---|---|
| **Paper Lanterns** | Ballad | 76 | 1:45 | Easy 4 · Normal 6 · Hard 7 · Expert 15 |
| **Cold Open** | Downtempo | 88 | 1:37 | Easy 4 · Normal 5 · Hard 9 |
| **Marmalade Sky** | Lo-fi | 96 | 1:23 | Easy 4 · Normal 9 |
| **Glass Waltz** | Waltz | 132 | 1:41 | Easy 6 · Normal 9 · Hard 12 |
| **Sunroom** | House | 112 | 1:37 | Easy 5 · Normal 12 · Hard 15 |
| **Neon Alleyway** | Funk | 108 | 1:32 | Easy 6 · Normal 12 · Hard 15 · Expert 19 · Master 24 |
| **Hello, Sekai** | Pop | 140 | 1:25 | Easy 7 · Normal 12 · Hard 16 · Expert 22 |
| **Neon Drift** | Synthwave | 128 | 1:33 | Easy 6 · Normal 12 · Hard 18 · Expert 25 |
| **Midnight Transit** | Drum & Bass | 174 | 1:31 | Easy 6 · Normal 10 · Hard 13 · Expert 19 |
| **Afterimage** | Future Bass | 146 | 1:35 | Easy 8 · Normal 14 · Hard 20 · Expert 22 |
| **Solstice** | Trance | 138 | 1:54 | Easy 6 · Normal 11 · Hard 19 · Expert 28 · Master 45 |
| **Static Bloom** | Rock | 158 | 1:28 | Easy 8 · Normal 15 · Hard 18 · Expert 32 · Master 36 |
| **Pixel Rain** | Chiptune | 150 | 1:33 | Easy 8 · Normal 16 · Hard 25 · Expert 32 · Master 41 |
| **Untitled Sorrow** | Piano Rock | 172 | 1:32 | Easy 8 · Normal 14 · Hard 24 · Expert 37 · Master 42 |
| **Vivid Impact** | Big Room | 168 | 1:34 | Normal 13 · Hard 21 · Expert 32 · Master 38 |
| **Iron Sequence** | Hardcore | 190 | 1:34 | Normal 18 · Hard 28 · Expert 42 · Master 45 |

Levels are computed from the finished chart rather than hand-assigned, so they
stay honest when a song or a difficulty profile changes. Density is most of it;
flicks are the rest, since a flick costs a whole gesture rather than a keypress.

A tier is only offered when its chart is meaningfully different from the one
below it. A sparse ballad has nothing to add above HARD and a 190 BPM hardcore
track has no honest EASY, so neither pretends otherwise; `npm run check` fails
the build if a tier adds less than 8 % over its neighbour.

## Finding a song

The list filters and sorts client-side, and the view is remembered:

| | |
|---|---|
| Search | title, genre or artist |
| Genre | one of the sixteen genres |
| Difficulty | songs offering that tier — and it selects that tier in the panel |
| Status | unplayed, played, or full-combo'd |
| Sort | recommended, title, genre, BPM, length, level or best score, either direction |
| Group by level | bands the list as Level 1–9, 10–19, 20–29, 30+ |

Sorting by level uses the hardest chart a song has, or — when a difficulty
filter is set — the level of that tier, which is what you actually want when
you are shopping for, say, a Level 20 EXPERT.

Arrow keys walk the list as it is currently filtered and sorted; <kbd>←</kbd>
and <kbd>→</kbd> change difficulty, <kbd>Enter</kbd> plays.

### How the charts are made

A song file in `js/songs/` describes *music*, not a note map. Alongside each
audio event it tags the moments a player could plausibly be asked to hit, with
the layer it came from, its pitch, how structurally important it is, and how
long it rings. `js/music.js` carries the arrangement kit those files are written
against — `drumBar`, `bassBar`, `line`, `arpBar`, `padBar` — so a song file is
mostly the material that makes it that song: its harmony, its patterns and its
shape.

`js/chart.js` then cuts a chart out of those tagged moments per difficulty. That
means:

- every note lines up with something audible;
- the five difficulties of a song are recognisably the same chart with more or
  less detail, rather than five unrelated ones;
- lane assignment follows the melody's contour, using the **quartiles** of the
  pitches that difficulty actually uses — a linear split over the raw range
  leaves whole lanes idle whenever a melody clusters, which is most of them;
- a tier means the same thing at any tempo. Each profile's spacing floor is in
  *seconds*, not beats, because without one a NORMAL at 190 BPM is twice the
  chart a NORMAL at 96 BPM is.

Flicks are painted on afterwards, over a finished note map, because whether a
roll is playable depends on what else is in the chart. Notes the music stresses
are likelier to become one, and each is then extended into a figure — a pair
that rolls out and back, or a sweep across the lanes — so arrows arrive as
shapes rather than as a scattering.

Two rules keep the chart physically playable, and `npm run check` enforces both:

- a flick's destination key is free for the roll and for the moment before it;
- a hold is always trimmed to leave a quarter-beat to release in before the next
  note in its lane.

## Chart editor

`editor.html` — pick a song, place notes against the same beat grid the songs
are written on, and play the music from any point to check a phrase without
replaying the whole song. A guide column shows every moment the music actually
hits, so notes can be placed against the music rather than against the grid
alone.

Charts save per song and appear in the song list as a **CUSTOM** difficulty.
Import/export is plain JSON.

| | |
|---|---|
| Place a note | click a lane; drag up to make it a hold |
| Delete | right-click, or select and press <kbd>Del</kbd> |
| Note type | <kbd>1</kbd>–<kbd>4</kbd> — tap, flick ←, flick →, flick ↓ |
| Play from the playhead | <kbd>Space</kbd> |
| Scroll / zoom | wheel, <kbd>Ctrl</kbd>+wheel |
| Undo / redo | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> |

## The look

One rule holds the whole interface together: **colour carries meaning, and
nothing else is coloured.**

The pages are ink on paper — flat surfaces, hairline rules, no shadows, no
gradients, and numbers set in a monospace face so levels, scores and counts line
up in columns. The only hues anywhere are the four note colours and the five
difficulty colours, which means a splash of colour is always telling you
something rather than decorating something.

The playfield follows from that: a black field, white lane rules, a solid white
judge line, and one colour per note kind — white taps, cyan holds, pink flicks.
Hit effects are deliberately small and clipped to the field, so the only thing
that ever moves outside a lane is the score.

Menus are pages, not overlays — a header with tabs, one section at a time, and
the canvas hidden entirely while you are in them. Nothing is being drawn behind
the menus, and nothing animates until a song starts.

## What makes it feel smooth

**A drift-corrected transport clock.** `AudioContext.currentTime` only advances
once per render quantum, so reading it directly makes notes visibly stair-step.
`AudioEngine.update` runs a free clock off the animation-frame delta and slews it
toward the audio clock, hard-resyncing only after a real stall. Motion is
sub-millisecond smooth and still cannot drift.

**Positions are pure functions of time.** Every note's Y coordinate is derived
from the clock rather than integrated frame to frame, so the game is correct at
30, 60 and 144 Hz with no interpolation hacks.

**Latency-aware judging.** The transport is offset by `outputLatency`, so "now"
means what the player is *hearing*. Key presses are rewound using the event's
`timeStamp` instead of being judged on the next frame, which is worth several
milliseconds. A manual offset slider covers the rest.

**Framerate-independent easing.** Everything reactive — lane glow, the score
counter, combo pops, background bloom — is exponentially damped via
`damp(a, b, lambda, dt)`, so animations feel identical at any refresh rate.

**A synth that does not click.** Every envelope has a floor on its attack and
release, because what makes synthesised music sound chopped is not short notes —
it is notes that reach silence in two milliseconds and click on the way. The
master bus adds a high shelf, a gentle low pass and a soft-clip curve, since raw
saw and square waves are far brighter than any real instrument.

**No allocation during play.** Particles come from a fixed pool and glow-heavy
note graphics are pre-rendered to sprites on resize, so the frame loop never
touches `shadowBlur` and the GC never causes a hitch mid-song.

## Layout

```
index.html            song select, settings, results pages; pause overlay
editor.html           chart editor
css/style.css         menu chrome (the playfield is all canvas)
css/editor.css        editor chrome
js/main.js            screen routing, song select, settings, frame loop
js/theme.js           colours, key bindings, difficulty metadata
js/music.js           authoring helpers shared by every song
js/chart.js           difficulty profiles and chart generation
js/songs/*.js         one file per song: soundtrack + playable moments
js/library.js         song-list filtering, sorting and grouping
js/monitor.js         frame-time, clock-drift and hit-offset readout
js/audio.js           synth rack, lookahead scheduler, transport clock
js/game.js            judgement, scoring, hold logic
js/renderer.js        canvas rendering
js/particles.js       pooled particle system
js/input.js           low-latency keyboard and touch, eight channels
js/editor.js          chart editor
js/settings.js        player settings
js/charts.js          saved custom charts
js/storage.js         guarded localStorage
tools/check-chart.js  headless chart validator
```

`window.sosoph` exposes the live `game`, `audio`, `renderer`, `input` and
`settings` for poking at from the console.
