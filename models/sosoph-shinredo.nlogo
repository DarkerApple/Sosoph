;; ==========================================================
;;  SOSOPH :: SHINREDO REPRODUCTION MODEL
;;  Male types : M1 (shinredo 1) | M2 (shinredo 2, handsome) | MINF (shinredo inf, mono)
;;  Female types: F0 (0) | F-0.1 (-0.1) | F-0.2 (-0.2)
;;  Generational trauma: Tsunami | Tornado | Godd Geonwoo (diddy) | 2/3 Thanos
;;  Time unit = "phase" (1 tick). Entities normally live 2 phases.
;; ==========================================================

breed [ males male ]
breed [ females female ]

globals [
  event-this-phase      ;; text log of what hit this phase
  births-this-phase
  deaths-this-phase
  collapse-deaths       ;; deaths from shinredo collapse
  tsunami-count
  tornado-count
  diddy-count
  thanos-count
  aids-count            ;; number of AIDS outbreaks so far
  aids-deaths           ;; cumulative deaths from AIDS
  mega-who              ;; who-number of the active mega-handsome (-1 = none)
  sched-index           ;; rotates trauma types in "scheduled" mode
]

turtles-own [
  shinredo              ;; base shinredo value
  sex-type              ;; "M1" "M2" "MINF" "MEGA" "F0" "F-0.1" "F-0.2"
  handsome?             ;; M2 attribute
  mono?                 ;; MINF attribute
  mono-class?           ;; promoted by the Thanos snap
  mega?                 ;; the Godd Geonwoo spawn
  age
  lifespan
  partner               ;; mono bonds persist; binary bonds reset each phase
  locked-on             ;; female locked onto the mega-handsome this phase
  trauma-load           ;; inherited generational trauma (subtracts from shinredo)
  bred-this-phase?
  infected?             ;; has AIDS -- only ever true for mono entities
  carrier?              ;; non-mono partner who can pass AIDS to her next mono
  infection-age         ;; phases lived since infection
]

;; ================= SETUP =================

to setup
  clear-all
  set event-this-phase "none"
  set mega-who -1
  set sched-index 0
  set collapse-deaths 0
  set aids-count 0
  set aids-deaths 0
  create-males   initial-males   [ init-male   setxy random-xcor random-ycor ]
  create-females initial-females [ init-female setxy random-xcor random-ycor ]
  ask turtles [ set age random 2 ]
  ask patches [ set pcolor black ]
  reset-ticks
end

to init-common
  set age 0
  set lifespan roll-lifespan
  set partner nobody
  set locked-on nobody
  set trauma-load 0
  set mono? false
  set mono-class? false
  set mega? false
  set handsome? false
  set bred-this-phase? false
  set infected? false
  set carrier? false
  set infection-age 0
end

to init-male
  init-common
  random-male-type
  set-appearance
end

to init-female
  init-common
  random-female-type
  set-appearance
end

to-report roll-lifespan
  report max (list 1 (base-lifespan + random (2 * lifespan-variance + 1) - lifespan-variance))
end

;; ---- type constructors ----

to become-m1
  set breed males  set sex-type "M1"   set shinredo 1
  set handsome? false  set mono? false
end

to become-m2
  set breed males  set sex-type "M2"   set shinredo 2
  set handsome? true   set mono? false
end

to become-minf
  set breed males  set sex-type "MINF" set shinredo inf-shinredo
  set handsome? false  set mono? true
end

to become-f0
  set breed females set sex-type "F0"    set shinredo 0
  set handsome? false set mono? false
end

to become-f01
  set breed females set sex-type "F-0.1" set shinredo -0.1
  set handsome? false set mono? false
end

to become-f02
  set breed females set sex-type "F-0.2" set shinredo -0.2
  set handsome? false set mono? false
end

to random-male-type
  let total (weight-m1 + weight-m2 + weight-minf)
  if total <= 0 [ become-m1 stop ]
  let r random-float total
  ifelse r < weight-m1
    [ become-m1 ]
    [ ifelse r < weight-m1 + weight-m2 [ become-m2 ] [ become-minf ] ]
end

to random-female-type
  let total (weight-f0 + weight-f01 + weight-f02)
  if total <= 0 [ become-f0 stop ]
  let r random-float total
  ifelse r < weight-f0
    [ become-f0 ]
    [ ifelse r < weight-f0 + weight-f01 [ become-f01 ] [ become-f02 ] ]
end

;; ================= MAIN LOOP =================

to go
  if not any? turtles [ stop ]
  if stop-at-phase > 0 and ticks >= stop-at-phase [ stop ]

  set births-this-phase 0
  set deaths-this-phase 0
  set event-this-phase ""

  clear-mega
  ask patches [ set pcolor black ]
  reset-phase-state

  run-trauma
  ask turtles [ wander ]
  do-mating
  do-reproduction
  progress-aids
  do-collapse
  do-aging
  enforce-capacity

  ask turtles [ set-appearance ]
  if event-this-phase = "" [ set event-this-phase "quiet phase" ]
  tick
end

to reset-phase-state
  ask turtles [
    set bred-this-phase? false
    set locked-on nobody
    ;; drop references to dead partners
    if partner != nobody [ if not member? partner turtles [ set partner nobody ] ]
    ;; binary pairings are per-phase; mono bonds are for life
    if partner != nobody [
      if not (mono? or [ mono? ] of partner) [ set partner nobody ]
    ]
  ]
end

to wander
  rt random 50
  lt random 50
  fd move-speed
end

;; ================= ATTRACTION & MATING =================

to-report effective-shinredo          ;; turtle reporter
  ;; AIDS collapses a mono's infinite shinredo down to a mortal number
  if infected? [ report aids-crash-shinredo - trauma-load ]
  report shinredo - trauma-load
end

to-report collapsed?                  ;; turtle reporter -- the "shinredo floor" rule
  if mega? [ report false ]
  if mono? and not infected? [ report false ]   ;; healthy mono is immune
  report effective-shinredo <= shinredo-floor
end

to-report appeal                      ;; male reporter: how attractive he reads
  let a effective-shinredo
  if handsome?   [ set a a + handsome-bonus ]
  if mono-class? [ set a a + mono-class-bonus ]
  if mega?       [ set a a + mega-bonus ]
  report a
end

to-report available?                  ;; male reporter
  if mega? [ report false ]           ;; the mega-handsome cannot reproduce
  if collapsed? [ report false ]
  report partner = nobody             ;; mono: one bond ever. binary: one bond per phase
end

to-report mate-probability [ m ]      ;; female reporter, m = candidate male
  ;; pair score = male appeal + female's own (0 / -0.1 / -0.2) shinredo, minus her trauma
  let pair-score ([ appeal ] of m) + effective-shinredo
  let z attraction-sensitivity * (pair-score - mating-threshold)
  if z >  30 [ report 1 ]
  if z < -30 [ report 0 ]
  report 1 / (1 + exp (- z))
end

to do-mating
  ask females with [ partner = nobody and locked-on = nobody and not collapsed? ] [
    let pool males in-radius mate-radius
    set pool pool with [ available? ]
    if any? pool [
      let best max-one-of pool [ appeal + random-float choice-noise ]
      if random-float 1 < mate-probability best [
        set partner best
        ask best [ set partner myself ]
        transmit-aids best
      ]
    ]
  ]
end

;; ================= REPRODUCTION =================

to do-reproduction
  ask females [ try-breed ]
end

to try-breed                          ;; female procedure
  if bred-this-phase? [ stop ]
  if locked-on != nobody [ stop ]     ;; wasted the phase on the mega-handsome
  if collapsed? [ stop ]
  if partner = nobody [ stop ]
  if not member? partner turtles [ set partner nobody stop ]
  let dad partner
  if [ mega? ] of dad [ stop ]
  if [ collapsed? ] of dad [ stop ]
  if aids-sterile? and [ infected? ] of dad [ stop ]   ;; AIDS blocks reproduction

  set bred-this-phase? true
  ask dad [ set bred-this-phase? true ]

  let litter offspring-min + random (max (list 1 (offspring-max - offspring-min + 1)))
  if random-float 100 < fertility-bonus [ set litter litter + 1 ]
  let dad-type       [ sex-type ] of dad
  let dad-monoclass? [ mono-class? ] of dad
  let dad-infected?  [ infected? ] of dad
  let dad-trauma     [ trauma-load ] of dad
  let mom-type       sex-type
  let mom-trauma     trauma-load

  hatch litter [
    init-common
    set trauma-load ((mom-trauma + dad-trauma) / 2) * (trauma-heritability / 100)
    ifelse random-float 100 < male-birth-pct
      [ assign-male-child   dad-type dad-monoclass? dad-infected? ]
      [ assign-female-child mom-type ]
    set lifespan roll-lifespan
    rt random 360
    fd 1
    set-appearance
    set births-this-phase births-this-phase + 1
  ]

  ;; --- AIDS can be contracted through the act of reproducing ---
  ;; Only the father can catch it, and only if he is mono. Two independent
  ;; rolls: a baseline risk per reproduction, plus a much higher risk if the
  ;; mother is already a carrier.
  if aids-on? [
    let mom-carrier? carrier?
    ask dad [
      if mono? and not infected? [
        if random-float 100 < aids-breeding-chance [ infect ]
        if mom-carrier? and random-float 100 < aids-transmission [ infect ]
      ]
    ]
  ]
end

to assign-male-child [ dad-type dad-monoclass? dad-infected? ]
  ;; mono-class fathers push their line toward mono
  ifelse dad-monoclass? and random-float 100 < mono-class-heritability [
    become-minf
  ] [
    ifelse random-float 100 < inherit-fidelity [
      if dad-type = "M1" [ become-m1 ]
      if dad-type = "M2" or dad-type = "MEGA" [ become-m2 ]
      if dad-type = "MINF" [
        ;; mono lines rarely breed true
        ifelse random-float 100 < mono-birth-chance [ become-minf ] [ become-m2 ]
      ]
    ] [
      random-male-type
    ]
    if random-float 100 < mutation-chance [ random-male-type ]
  ]
  ;; vertical transmission: only a mono son can carry it
  if aids-on? and mono? and dad-infected? and random-float 100 < aids-vertical [
    set infected? true
    set infection-age 0
  ]
end

to assign-female-child [ mom-type ]
  let known-types [ "F0" "F-0.1" "F-0.2" ]
  if mom-type = "F0"    [ become-f0  ]
  if mom-type = "F-0.1" [ become-f01 ]
  if mom-type = "F-0.2" [ become-f02 ]
  if not member? mom-type known-types [ random-female-type ]
  if random-float 100 < female-drift-chance    [ drift-down ]
  if random-float 100 < female-recovery-chance [ drift-up ]
  if random-float 100 < mutation-chance        [ random-female-type ]
end

to drift-down
  if sex-type = "F0"    [ become-f01 stop ]
  if sex-type = "F-0.1" [ become-f02 stop ]
end

to drift-up
  if sex-type = "F-0.2" [ become-f01 stop ]
  if sex-type = "F-0.1" [ become-f0  stop ]
end

;; ================= GENERATIONAL TRAUMA =================

to run-trauma
  if not trauma-on? [ stop ]
  ifelse trauma-mode = "scheduled" [
    if ticks > 0 and ticks mod trauma-interval = 0 [
      fire-event item (sched-index mod 5) [ "tsunami" "tornado" "diddy" "thanos" "aids" ]
      set sched-index sched-index + 1
    ]
  ] [
    if random-float 100 < tsunami-chance [ fire-event "tsunami" ]
    if random-float 100 < tornado-chance [ fire-event "tornado" ]
    if random-float 100 < diddy-chance   [ fire-event "diddy"   ]
    if random-float 100 < thanos-chance  [ fire-event "thanos"  ]
    if aids-on? and random-float 100 < aids-chance [ fire-event "aids" ]
  ]
end

to fire-event [ ev ]
  if ev = "tsunami" [ tsunami-event ]
  if ev = "tornado" [ tornado-event ]
  if ev = "diddy"   [ diddy-event   ]
  if ev = "thanos"  [ thanos-event  ]
  if ev = "aids"    [ aids-event    ]
end

to log-event [ txt ]
  ifelse event-this-phase = "" [ set event-this-phase txt ]
                               [ set event-this-phase (word event-this-phase " + " txt) ]
end

;; --- 1. TSUNAMI: a band sweeps the world ---
to tsunami-event
  set tsunami-count tsunami-count + 1
  let band min-pycor + random world-height
  ask patches with [ abs (pycor - band) <= tsunami-width ] [ set pcolor blue - 2 ]
  ask turtles with [ abs (ycor - band) <= tsunami-width ] [
    ifelse random-float 100 < tsunami-lethality
      [ perish ]
      [ add-trauma tsunami-trauma ]
  ]
  log-event "TSUNAMI"
end

;; --- 2. TORNADO: a vortex kills and scatters ---
to tornado-event
  set tornado-count tornado-count + 1
  let cx random-xcor
  let cy random-ycor
  ask patches with [ distancexy cx cy <= tornado-radius ] [ set pcolor gray - 3 ]
  ask turtles with [ distancexy cx cy <= tornado-radius ] [
    ifelse random-float 100 < tornado-lethality
      [ perish ]
      [ add-trauma tornado-trauma  setxy random-xcor random-ycor ]
  ]
  log-event "TORNADO"
end

;; --- 3. Godd Geonwoo (diddy): spawns a mega-handsome that magnetises every single
;;        female. Lasts exactly one phase and cannot reproduce during it. ---
to diddy-event
  set diddy-count diddy-count + 1
  create-males 1 [
    init-common
    set breed males
    set sex-type "MEGA"
    set shinredo mega-shinredo
    set handsome? true
    set mega? true
    set lifespan 1
    setxy random-xcor random-ycor
    set-appearance
    set mega-who who
  ]
  let target females with [ partner = nobody ]
  if diddy-steals-partnered? [ set target females ]
  ask target [
    if partner != nobody [
      ask partner [ set partner nobody ]
      set partner nobody
    ]
    set locked-on turtle mega-who
    add-trauma diddy-trauma
  ]
  log-event "MEGA-HANDSOME (diddy)"
end

;; --- 4. 2/3 THANOS: snaps exactly two thirds of everyone except mono.
;;        Surviving mono entities are promoted to mono class. ---
to thanos-event
  set thanos-count thanos-count + 1
  let victims turtles with [ not mono? ]
  let n floor (count victims * 2 / 3)
  if n > 0 [ ask n-of n victims [ perish ] ]
  ask turtles with [ mono? ] [
    set mono-class? true
    add-trauma thanos-trauma
  ]
  log-event "2/3 THANOS"
end

;; --- 5. AIDS: a persistent disease that can ONLY infect mono entities.
;;        It is the counterweight to mono: it crashes their infinite shinredo
;;        down to a mortal number, blocks reproduction, and kills on a timer. ---
to aids-event
  if not aids-on? [ stop ]
  set aids-count aids-count + 1
  let pool turtles with [ mono? and not infected? ]
  if any? pool [
    let n round (count pool * aids-initial-infect / 100)
    if n < 1 [ set n 1 ]
    set n min (list n (count pool))
    ask n-of n pool [ infect ]
  ]
  log-event "AIDS OUTBREAK"
end

to infect                             ;; turtle procedure
  if not mono? [ stop ]               ;; non-mono entities cannot be infected
  if infected? [ stop ]
  set infected? true
  set infection-age 0
  ;; his bonded female becomes a carrier who can pass it on to her next mono
  if aids-carriers? and partner != nobody [
    ask partner [ if not mono? [ set carrier? true ] ]
  ]
end

to transmit-aids [ m ]                ;; female procedure, m = the male just paired with
  if not aids-on? [ stop ]
  ;; a carrier passes it to the next mono she bonds with
  if carrier? and [ mono? and not infected? ] of m [
    if random-float 100 < aids-transmission [ ask m [ infect ] ]
  ]
  ;; bonding with an infected mono makes her a carrier
  if aids-carriers? and [ infected? ] of m [ set carrier? true ]
end

to progress-aids
  if not aids-on? [ stop ]
  ask turtles with [ infected? ] [
    set infection-age infection-age + 1
    if infection-age >= aids-duration [
      set aids-deaths aids-deaths + 1
      perish
    ]
  ]
end

to add-trauma [ amt ]
  set trauma-load trauma-load + amt
end

to clear-mega
  ask turtles with [ mega? ] [ die ]
  set mega-who -1
end

;; ================= DEATH =================

to do-collapse
  if not collapse-is-fatal? [ stop ]
  ask turtles with [ collapsed? ] [
    set collapse-deaths collapse-deaths + 1
    perish
  ]
end

to do-aging
  ask turtles [
    set age age + 1
    let limit lifespan + (ifelse-value mono-class? [ mono-class-lifespan-bonus ] [ 0 ])
    if age >= limit [ perish ]
  ]
end

to enforce-capacity
  if carrying-capacity <= 0 [ stop ]
  if count turtles > carrying-capacity [
    let excess count turtles - carrying-capacity
    let pool turtles with [ not mono-class? and not mega? ]
    let n min (list excess (count pool))
    if n > 0 [ ask n-of n pool [ perish ] ]
  ]
end

to perish
  ask other turtles with [ partner   = myself ] [ set partner nobody ]
  ask other turtles with [ locked-on = myself ] [ set locked-on nobody ]
  set deaths-this-phase deaths-this-phase + 1
  die
end

;; ================= VISUALS & REPORTERS =================

to set-appearance
  set shape "circle"
  if sex-type = "M1"    [ set color blue    set size 1.0 ]
  if sex-type = "M2"    [ set color cyan    set size 1.4 ]
  if sex-type = "MINF"  [ set color violet  set size 1.8  set shape "star" ]
  if sex-type = "MEGA"  [ set color magenta set size 3.5  set shape "star" ]
  if sex-type = "F0"    [ set color red     set size 1.0  set shape "circle 2" ]
  if sex-type = "F-0.1" [ set color orange  set size 1.0  set shape "circle 2" ]
  if sex-type = "F-0.2" [ set color yellow  set size 1.0  set shape "circle 2" ]
  if mono-class? [ set shape "star" set size size + 0.6 ]
  if carrier?    [ set shape "circle" ]
  if infected?   [ set shape "x" set color lime ]
  if collapsed?  [ set color gray ]
end

to-report count-type [ t ]
  report count turtles with [ sex-type = t ]
end

to-report mean-eff-shinredo
  let pool turtles with [ not mono? and not mega? ]
  ifelse any? pool [ report mean [ effective-shinredo ] of pool ] [ report 0 ]
end

to-report mean-trauma
  ifelse any? turtles [ report mean [ trauma-load ] of turtles ] [ report 0 ]
end

to-report mono-class-count
  report count turtles with [ mono-class? ]
end

to-report infected-count
  report count turtles with [ infected? ]
end

to-report carrier-count
  report count turtles with [ carrier? ]
end

to-report mono-count
  report count turtles with [ mono? ]
end

to-report pair-rate
  ifelse any? females
    [ report 100 * (count females with [ partner != nobody ]) / (count females) ]
    [ report 0 ]
end
@#$#@#$#@
GRAPHICS-WINDOW
610
10
1047
448
-1
-1
13.0
1
10
1
1
1
0
1
1
1
-16
16
-16
16
1
1
1
phases
30.0

BUTTON
5
10
72
43
setup
setup
NIL
1
T
OBSERVER
NIL
NIL
NIL
NIL
1

BUTTON
74
10
141
43
go
go
T
1
T
OBSERVER
NIL
NIL
NIL
NIL
1

BUTTON
143
10
200
43
step
go
NIL
1
T
OBSERVER
NIL
NIL
NIL
NIL
1

SLIDER
5
50
200
83
initial-males
initial-males
0
400
120.0
1
1
NIL
HORIZONTAL

SLIDER
5
85
200
118
initial-females
initial-females
0
400
120.0
1
1
NIL
HORIZONTAL

SLIDER
5
120
200
153
weight-m1
weight-m1
0
100
55.0
1
1
%
HORIZONTAL

SLIDER
5
155
200
188
weight-m2
weight-m2
0
100
20.0
1
1
%
HORIZONTAL

SLIDER
5
190
200
223
weight-minf
weight-minf
0
100
10.0
1
1
%
HORIZONTAL

SLIDER
5
225
200
258
weight-f0
weight-f0
0
100
50.0
1
1
%
HORIZONTAL

SLIDER
5
260
200
293
weight-f01
weight-f01
0
100
30.0
1
1
%
HORIZONTAL

SLIDER
5
295
200
328
weight-f02
weight-f02
0
100
20.0
1
1
%
HORIZONTAL

SLIDER
5
330
200
363
base-lifespan
base-lifespan
1
10
2.0
1
1
phases
HORIZONTAL

SLIDER
5
365
200
398
lifespan-variance
lifespan-variance
0
3
0.0
1
1
NIL
HORIZONTAL

SLIDER
5
400
200
433
male-birth-pct
male-birth-pct
0
100
50.0
1
1
%
HORIZONTAL

SLIDER
5
435
200
468
offspring-min
offspring-min
0
5
1.0
1
1
NIL
HORIZONTAL

SLIDER
5
470
200
503
offspring-max
offspring-max
1
8
4.0
1
1
NIL
HORIZONTAL

SLIDER
5
505
200
538
carrying-capacity
carrying-capacity
0
3000
1200.0
50
1
NIL
HORIZONTAL

SLIDER
5
540
200
573
move-speed
move-speed
0
3
1.0
0.1
1
NIL
HORIZONTAL

SLIDER
5
575
200
608
mate-radius
mate-radius
1
20
7.0
1
1
NIL
HORIZONTAL

SLIDER
5
610
200
643
fertility-bonus
fertility-bonus
0
100
35.0
1
1
%
HORIZONTAL

SLIDER
205
50
400
83
inf-shinredo
inf-shinredo
10
1000
1000.0
10
1
NIL
HORIZONTAL

SLIDER
205
85
400
118
handsome-bonus
handsome-bonus
0
5
1.0
0.1
1
NIL
HORIZONTAL

SLIDER
205
120
400
153
mono-class-bonus
mono-class-bonus
0
10
3.0
0.5
1
NIL
HORIZONTAL

SLIDER
205
155
400
188
mega-bonus
mega-bonus
0
50
25.0
1
1
NIL
HORIZONTAL

SLIDER
205
190
400
223
mega-shinredo
mega-shinredo
0
50
10.0
1
1
NIL
HORIZONTAL

SLIDER
205
225
400
258
mating-threshold
mating-threshold
-2
5
0.0
0.1
1
NIL
HORIZONTAL

SLIDER
205
260
400
293
attraction-sensitivity
attraction-sensitivity
0.1
10
2.0
0.1
1
NIL
HORIZONTAL

SLIDER
205
295
400
328
choice-noise
choice-noise
0
3
0.5
0.1
1
NIL
HORIZONTAL

SLIDER
205
330
400
363
shinredo-floor
shinredo-floor
-3
0
-0.5
0.1
1
NIL
HORIZONTAL

SLIDER
205
365
400
398
inherit-fidelity
inherit-fidelity
0
100
80.0
1
1
%
HORIZONTAL

SLIDER
205
400
400
433
mono-birth-chance
mono-birth-chance
0
100
25.0
1
1
%
HORIZONTAL

SLIDER
205
435
400
468
mono-class-heritability
mono-class-heritability
0
100
60.0
1
1
%
HORIZONTAL

SLIDER
205
470
400
503
female-drift-chance
female-drift-chance
0
100
12.0
1
1
%
HORIZONTAL

SLIDER
205
505
400
538
female-recovery-chance
female-recovery-chance
0
100
5.0
1
1
%
HORIZONTAL

SLIDER
205
540
400
573
mutation-chance
mutation-chance
0
100
3.0
1
1
%
HORIZONTAL

SLIDER
205
575
400
608
trauma-heritability
trauma-heritability
0
100
70.0
1
1
%
HORIZONTAL

SLIDER
205
610
400
643
mono-class-lifespan-bonus
mono-class-lifespan-bonus
0
5
2.0
1
1
phases
HORIZONTAL

SLIDER
205
645
400
678
stop-at-phase
stop-at-phase
0
500
0.0
10
1
NIL
HORIZONTAL

SWITCH
405
50
600
83
trauma-on?
trauma-on?
0
1
-1000

CHOOSER
405
85
600
130
trauma-mode
trauma-mode
"random" "scheduled"
0

SLIDER
405
132
600
165
trauma-interval
trauma-interval
1
20
7.0
1
1
phases
HORIZONTAL

SLIDER
405
167
600
200
tsunami-chance
tsunami-chance
0
100
1.0
1
1
%
HORIZONTAL

SLIDER
405
202
600
235
tsunami-width
tsunami-width
1
15
3.0
1
1
NIL
HORIZONTAL

SLIDER
405
237
600
270
tsunami-lethality
tsunami-lethality
0
100
25.0
1
1
%
HORIZONTAL

SLIDER
405
272
600
305
tsunami-trauma
tsunami-trauma
0
2
0.05
0.05
1
NIL
HORIZONTAL

SLIDER
405
307
600
340
tornado-chance
tornado-chance
0
100
2.0
1
1
%
HORIZONTAL

SLIDER
405
342
600
375
tornado-radius
tornado-radius
1
15
4.0
1
1
NIL
HORIZONTAL

SLIDER
405
377
600
410
tornado-lethality
tornado-lethality
0
100
20.0
1
1
%
HORIZONTAL

SLIDER
405
412
600
445
tornado-trauma
tornado-trauma
0
2
0.04
0.05
1
NIL
HORIZONTAL

SLIDER
405
447
600
480
diddy-chance
diddy-chance
0
100
4.0
1
1
%
HORIZONTAL

SLIDER
405
482
600
515
diddy-trauma
diddy-trauma
0
2
0.2
0.05
1
NIL
HORIZONTAL

SWITCH
405
517
600
550
diddy-steals-partnered?
diddy-steals-partnered?
1
1
-1000

SLIDER
405
552
600
585
thanos-chance
thanos-chance
0
100
2.0
1
1
%
HORIZONTAL

SLIDER
405
587
600
620
thanos-trauma
thanos-trauma
0
2
0.25
0.05
1
NIL
HORIZONTAL

SWITCH
405
622
600
655
collapse-is-fatal?
collapse-is-fatal?
0
1
-1000

SWITCH
405
665
600
698
aids-on?
aids-on?
0
1
-1000

SLIDER
405
700
600
733
aids-chance
aids-chance
0
100
6.0
1
1
%
HORIZONTAL

SLIDER
405
735
600
768
aids-initial-infect
aids-initial-infect
0
100
30.0
1
1
% of monos
HORIZONTAL

SLIDER
405
770
600
803
aids-duration
aids-duration
1
10
3.0
1
1
phases
HORIZONTAL

SLIDER
405
805
600
838
aids-crash-shinredo
aids-crash-shinredo
-2
3
0.3
0.1
1
NIL
HORIZONTAL

SLIDER
405
840
600
873
aids-transmission
aids-transmission
0
100
45.0
1
1
%
HORIZONTAL

SLIDER
405
875
600
908
aids-breeding-chance
aids-breeding-chance
0
100
3.0
0.5
1
% per birth
HORIZONTAL

SLIDER
405
910
600
943
aids-vertical
aids-vertical
0
100
20.0
1
1
%
HORIZONTAL

SWITCH
405
945
600
978
aids-carriers?
aids-carriers?
0
1
-1000

SWITCH
405
980
600
1013
aids-sterile?
aids-sterile?
0
1
-1000

MONITOR
610
455
678
500
phase
ticks
0
1
11

MONITOR
681
455
760
500
alive
count turtles
0
1
11

MONITOR
763
455
860
500
paired %
pair-rate
1
1
11

MONITOR
863
455
1047
500
trauma event
event-this-phase
17
1
11

MONITOR
610
503
676
548
M1
count-type "M1"
0
1
11

MONITOR
679
503
745
548
M2
count-type "M2"
0
1
11

MONITOR
748
503
820
548
MINF
count-type "MINF"
0
1
11

MONITOR
823
503
915
548
mono class
mono-class-count
0
1
11

MONITOR
918
503
1047
548
mean trauma
mean-trauma
3
1
11

MONITOR
610
551
676
596
F0
count-type "F0"
0
1
11

MONITOR
679
551
752
596
F-0.1
count-type "F-0.1"
0
1
11

MONITOR
755
551
828
596
F-0.2
count-type "F-0.2"
0
1
11

MONITOR
831
551
1047
596
mean eff. shinredo (non-mono)
mean-eff-shinredo
3
1
11

MONITOR
610
599
700
644
mono (all)
mono-count
0
1
11

MONITOR
703
599
800
644
AIDS infected
infected-count
0
1
11

MONITOR
803
599
900
644
carriers
carrier-count
0
1
11

MONITOR
903
599
1047
644
AIDS deaths (total)
aids-deaths
0
1
11

PLOT
610
648
1047
838
population by type
phase
count
0.0
20.0
0.0
50.0
true
true
"" ""
PENS
"M1" 1.0 0 -13345367 true "" "plot count-type \"M1\""
"M2" 1.0 0 -11221820 true "" "plot count-type \"M2\""
"MINF" 1.0 0 -8630108 true "" "plot count-type \"MINF\""
"F0" 1.0 0 -2674135 true "" "plot count-type \"F0\""
"F-0.1" 1.0 0 -955883 true "" "plot count-type \"F-0.1\""
"F-0.2" 1.0 0 -1184463 true "" "plot count-type \"F-0.2\""
"monoclass" 1.0 0 -10899396 true "" "plot mono-class-count"
"infected" 1.0 0 -13840069 true "" "plot infected-count"

PLOT
610
841
1047
991
shinredo & trauma
phase
value
0.0
20.0
-1.0
2.0
true
true
"" ""
PENS
"eff. shinredo" 1.0 0 -16777216 true "" "plot mean-eff-shinredo"
"trauma load" 1.0 0 -2674135 true "" "plot mean-trauma"
"floor" 1.0 0 -7500403 true "" "plot shinredo-floor"

PLOT
5
685
400
860
births & deaths per phase
phase
count
0.0
20.0
0.0
50.0
true
true
"" ""
PENS
"births" 1.0 0 -10899396 true "" "plot births-this-phase"
"deaths" 1.0 0 -2674135 true "" "plot deaths-this-phase"
"population" 1.0 0 -16777216 true "" "plot count turtles"

@#$#@#$#@
# SOSOPH :: SHINREDO REPRODUCTION MODEL

An agent-based reproduction model where mating success is driven by a scalar
trait called **shinredo**, and where recurring catastrophes ("generational
trauma") leave a heritable scar on every survivor's lineage.

One tick = one **phase**. Entities normally live **2 phases**.

## AGENT TYPES

### Male (3 types)

| Type | shinredo | attribute | reproduction |
| --- | --- | --- | --- |
| M1   | 1   | -        | binary (male + female pair, re-formed each phase) |
| M2   | 2   | handsome | binary, plus `handsome-bonus` to appeal |
| MINF | inf | mono     | bonds with exactly one female, for life |

`inf-shinredo` is a large finite stand-in for infinity so the logistic never
overflows. MINF wins any contest it enters, but it can only ever hold one
partner, so it acts as a scarce resource rather than a takeover.

### Female (3 types)

| Type  | shinredo |
| --- | --- |
| F0    |  0   |
| F-0.1 | -0.1 |
| F-0.2 | -0.2 |

The female value is a straight drag coefficient on every pairing she is in:

    pair score = male appeal + female shinredo - her trauma load

Female offspring inherit their mother's type but **drift downward**
(F0 -> F-0.1 -> F-0.2) at `female-drift-chance`, and recover upward at
`female-recovery-chance`. Left alone, lines ratchet down.

## GENERATIONAL TRAUMA

Five events. In `random` mode each rolls its own per-phase chance (several can
land in the same phase). In `scheduled` mode they rotate in order every
`trauma-interval` phases.

The two natural disasters are tuned to be survivable: they thin the population
and leave a trauma scar, but they are no longer the main driver of extinction.

1. **Tsunami** - a horizontal band sweeps the world, killing at
   `tsunami-lethality` (default 25%). Survivors take `tsunami-trauma`.
2. **Tornado** - a vortex of `tornado-radius` kills at `tornado-lethality`
   (default 20%), and throws survivors to random locations.
3. **Godd Geonwoo (diddy)** - spawns a **mega-handsome** with overwhelming
   appeal. Every single (unpartnered) female locks onto him for that phase, and
   he **cannot reproduce** - so all of them waste the phase. He exists for
   exactly one phase. Flip `diddy-steals-partnered?` on and he breaks existing
   mono bonds too.
4. **2/3 Thanos** - snaps exactly two thirds of the population, **excluding
   mono**. Every surviving mono entity is promoted to **mono class**: extra
   appeal (`mono-class-bonus`), extra lifespan (`mono-class-lifespan-bonus`),
   and sons that inherit MINF at `mono-class-heritability`.

5. **AIDS** - the only thing in the model that can touch mono. See below.

Trauma is the through-line of the model: `trauma-load` passes to children at
`trauma-heritability` and subtracts from shinredo permanently.

## AIDS

AIDS **only ever infects mono entities**. Nothing else in the model can carry
it as a disease. It exists as the counterweight to mono, which is otherwise
unbeatable: infinite shinredo, immune to the shinredo floor, and explicitly
spared by the Thanos snap.

An infected mono:

- has its **infinite shinredo crashed** to `aids-crash-shinredo`, so it stops
  outcompeting every other male and can now fall below the shinredo floor
- **cannot reproduce** while `aids-sterile?` is on - but it still holds its
  lifelong bond, so it takes a female out of the breeding pool with it
- **dies** after `aids-duration` phases

Three transmission routes:

- **Outbreak** - fires at `aids-chance` per phase (or in the scheduled
  rotation) and infects `aids-initial-infect`% of all healthy monos at once.
- **Reproduction** - every time a mono father actually produces offspring he
  rolls `aids-breeding-chance` to contract it. If the mother is already a
  carrier he rolls again, this time at the much higher `aids-transmission`.
  Because a mono bond lasts for life and breeds every phase, this risk
  compounds: the more successfully a mono line reproduces, the more likely it
  is to catch AIDS.
- **Carriers** - with `aids-carriers?` on, the female bonded to an infected
  mono becomes a carrier. She is never infected herself, but if she outlives
  him and re-pairs with another mono, she infects him at `aids-transmission`.
  This is how the disease crosses between mono lineages.
- **Vertical** - a mono son of an infected father is born infected at
  `aids-vertical`. Note this route only opens up when `aids-sterile?` is
  **off**: a father who cannot reproduce at all obviously cannot pass it to a
  son, so with the default settings outbreaks and carriers do all the work.

Infected entities render as a lime **x**. Watch the `MINF` count and the
`AIDS infected` monitor together: outbreaks carve the mono population down and
briefly hand the field back to M1 and M2.

## THE SHINREDO FLOOR

When an entity's effective shinredo (base minus inherited trauma) falls to or
below `shinredo-floor`, it **collapses**: it cannot reproduce, it renders gray,
and if `collapse-is-fatal?` is on it dies at the end of the phase. Mono
entities are immune.

## FERTILITY

The population is tuned to grow. `mating-threshold` sits at 0.0 so an ordinary
M1 clears it easily, `mate-radius` and `move-speed` are high enough that
females actually find partners, litters run 1-4, and `fertility-bonus` adds a
further offspring to 35% of all births.

To make it grow faster still: drop `mating-threshold` below zero, raise
`fertility-bonus`, or raise `offspring-max`. `carrying-capacity` is the hard
ceiling - raise it or set it to 0 to remove the cap entirely.

All four catastrophe chances are now low enough that they punctuate a run
rather than define it: tsunami 1%, tornado 2%, diddy 4%, Thanos 2% per phase.
Thanos is still the single biggest event in the model - it removes two thirds
of every non-mono entity whenever it lands - so raise or lower `thanos-chance`
first if you want to change the overall shape of a run.

## WHAT TO WATCH

- Set `trauma-mode` to `scheduled` with `trauma-interval` 7 to see all five
  events cycle in order.
- Run two Thanos snaps in a row and the population converges to mono class -
  then let one AIDS outbreak land and watch that dominance come apart.
- Turn `aids-on?` off and mono ratchets upward forever. Turn it on and mono
  oscillates instead.
- Turn `trauma-heritability` to 0 and the population stabilises; turn it to 100
  and every lineage eventually hits the floor.
- The diddy event is cheap in deaths but carves a visible notch out of the
  births curve.

## COLOR KEY

blue = M1, cyan = M2 (handsome), violet star = MINF (mono),
magenta star = mega-handsome, red = F0, orange = F-0.1, yellow = F-0.2,
gray = collapsed, star shape = mono class, lime x = AIDS-infected.
@#$#@#$#@
default
true
0
Polygon -7500403 true true 150 5 40 250 150 205 260 250

circle
false
0
Circle -7500403 true true 0 0 300

circle 2
false
0
Circle -7500403 true true 0 0 300
Circle -16777216 true false 30 30 240

person
false
0
Circle -7500403 true true 110 5 80
Polygon -7500403 true true 105 90 120 195 90 285 105 300 135 300 150 225 165 300 195 300 210 285 180 195 195 90
Rectangle -7500403 true true 127 79 172 94
Polygon -7500403 true true 195 90 240 150 225 180 165 105
Polygon -7500403 true true 105 90 60 150 75 180 135 105

square
false
0
Rectangle -7500403 true true 30 30 270 270

star
false
0
Polygon -7500403 true true 151 1 185 108 298 108 207 175 242 282 151 216 59 282 94 175 3 108 116 108

x
false
0
Polygon -7500403 true true 270 75 225 30 30 225 75 270
Polygon -7500403 true true 30 75 75 30 270 225 225 270

@#$#@#$#@
NetLogo 6.4.0
@#$#@#$#@
@#$#@#$#@
@#$#@#$#@
@#$#@#$#@
@#$#@#$#@
default
0.0
-0.2 0 0.0 1.0
0.0 1 1.0 0.0
0.2 0 0.0 1.0
link direction
true
0
Line -7500403 true 150 150 90 180
Line -7500403 true 150 150 210 180

@#$#@#$#@
0
@#$#@#$#@
