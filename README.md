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

Four lanes on the home row, and a second row of **colour keys** under the same
four fingers:

```
  D   F   J   K      white notes — press the note's own lane key
  C   V   N   M      coloured notes — press the matching colour key
```

`C` is red, `V` yellow, `N` green, `M` blue, and each colour sits directly under
the lane it usually appears in. So a coloured note means *same finger, one row
down* — which is why the chart still reads as an ordinary four-key chart and the
colour is a single extra bit of information rather than a second thing to track.

Plain notes are white and coloured notes are not, so which row a note wants is
readable from the note itself, with no legend to memorise.

| | |
|---|---|
| Pause | <kbd>Esc</kbd> |
| Song list | arrow keys to move, <kbd>Enter</kbd> to play |
| Touch | tap or slide across the lanes; a tap takes whatever note is there, coloured or not |

Long notes must be held until they run out; releasing early breaks the combo.
Judgement windows are ±45 ms Perfect, ±90 ms Great, ±135 ms Good. Score is
1,000,000 split 90 % accuracy / 10 % combo, so a full Perfect run scores exactly
one million.

Colour notes can be turned off in settings, which flattens every chart back to
plain four-key. Key bindings and the four note colours are both remappable.

## Songs

| | BPM | Length | Difficulties |
|---|---|---|---|
| **Marmalade Sky** | 96 | 1:23 | Easy · Normal · Hard |
| **Hello, Sekai** | 140 | 1:25 | Easy · Normal · Hard · Expert |
| **Neon Drift** | 128 | 1:33 | Easy · Normal · Hard · Expert |
| **Untitled Sorrow** | 172 | 1:32 | Easy · Normal · Hard · Expert · Master |
| **Vivid Impact** | 168 | 1:34 | Normal · Hard · Expert · Master |

### How the charts are made

A song file in `js/songs/` describes *music*, not a note map. Alongside each
audio event it tags the moments a player could plausibly be asked to hit, with
the layer it came from, its pitch, how structurally important it is, and how
long it rings.

`js/chart.js` then cuts a chart out of those tagged moments per difficulty. That
means:

- every note lines up with something audible;
- the five difficulties of a song are recognisably the same chart with more or
  less detail, rather than five unrelated ones;
- lane assignment follows the melody's contour, using the **quartiles** of the
  pitches that difficulty actually uses — a linear split over the raw range
  leaves whole lanes idle whenever a melody clusters, which is most of them.

Colours are placed as accents on hits the music already stresses, never more
than two in a row, and never on a hold. Two rules keep the two key rows
physically playable, and `npm run check` enforces both:

- a finger cannot be asked to change rows faster than it can move;
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
| Colour | <kbd>1</kbd>–<kbd>5</kbd> — plain, red, yellow, green, blue |
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
judge line, and notes that are either white or one of the four colours. Hit
effects are deliberately small and clipped to the field, so the only thing that
ever moves outside a lane is the score.

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
