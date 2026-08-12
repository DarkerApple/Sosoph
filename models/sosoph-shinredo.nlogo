;; ==========================================================
;;  SOSOPH :: TRUST REPRODUCTION MODEL
;;
;;  Male types
;;    M1   trust 1.0 - 2.0, wants MANY partners, cheats, trust decays
;;    M3   trust infinite, MONO: one partner for life, trust never decays
;;  Female types
;;    F0 (0) | F-0.1 (-0.1) | F-0.2 (-0.2)   -- their trust is the cheat cost
;;
;;  Life cycle (8 phases)
;;    phase 1      child   cannot reproduce, must survive a mortality roll
;;    phase 2-6    adult   can reproduce
;;    phase 7-8    old     cannot reproduce
;;
;;  Trauma: Tsunami | Tornado | Godd Geonwoo (diddy) | 2/3 Thanos | AIDS
;; ==========================================================

breed [ males male ]
breed [ females female ]

globals [
  event-this-phase      ;; text log of what hit this phase
  births-this-phase
  deaths-this-phase
  cheats-this-phase
  collapse-deaths       ;; deaths from trust collapse
  child-deaths          ;; deaths from the child mortality roll
  tsunami-count
  tornado-count
  diddy-count
  thanos-count
  aids-count
  aids-deaths
  mega-who              ;; who-number of the active mega-handsome (-1 = none)
  sched-index           ;; rotates trauma types in "scheduled" mode
]

turtles-own [
  trust                 ;; males: 1-2 (M1) or infinite (M3). females: 0 / -0.1 / -0.2
  sex-type              ;; "M1" "M3" "MEGA" "F0" "F-0.1" "F-0.2"
  mono?                 ;; M3 attribute -- one partner for life
  mono-class?           ;; promoted by the Thanos snap
  mega?                 ;; the Godd Geonwoo spawn
  age                   ;; phases already lived; life-phase = age + 1
  lifespan
  partner               ;; mono: lifelong bond. others: this phase's mate
  partners-this-phase   ;; males: how many females taken this phase
  locked-on             ;; female locked onto the mega-handsome this phase
  trauma-load           ;; inherited generational trauma (subtracts from trust)
  bred-this-phase?
  gestation             ;; phases of recovery left after giving birth
  mortality-rolled?     ;; has this entity taken its child mortality roll yet
  infected?             ;; has AIDS -- only ever true for mono entities
  carrier?              ;; non-mono partner who can pass AIDS to her next mono
  infection-age
]

;; ================= SETUP =================

to setup
  clear-all
  set event-this-phase "none"
  set mega-who -1
  set sched-index 0
  set collapse-deaths 0
  set child-deaths 0
  set aids-count 0
  set aids-deaths 0
  create-males   initial-males   [ init-male   setxy random-xcor random-ycor ]
  create-females initial-females [ init-female setxy random-xcor random-ycor ]
  ;; the starting population is already grown: adults, past their mortality roll
  ask turtles [
    set age child-until-phase + random (max (list 1 (adult-until-phase - child-until-phase)))
    set mortality-rolled? true
    set-appearance
  ]
  ask patches [ set pcolor black ]
  reset-ticks
end

to init-common
  set age 0
  set lifespan roll-lifespan
  set partner nobody
  set partners-this-phase 0
  set locked-on nobody
  set trauma-load 0
  set mono? false
  set mono-class? false
  set mega? false
  set bred-this-phase? false
  set gestation 0
  set mortality-rolled? false
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
  report max (list 1 (lifespan-phases + random (2 * lifespan-variance + 1) - lifespan-variance))
end

;; ---- type constructors ----

to become-m1
  set breed males  set sex-type "M1"
  set trust m1-trust-min + random-float (max (list 0 (m1-trust-max - m1-trust-min)))
  set mono? false
end

to become-m3
  set breed males  set sex-type "M3"
  set trust inf-trust
  set mono? true
end

to become-f0
  set breed females set sex-type "F0"    set trust 0     set mono? false
end

to become-f01
  set breed females set sex-type "F-0.1" set trust -0.1  set mono? false
end

to become-f02
  set breed females set sex-type "F-0.2" set trust -0.2  set mono? false
end

to random-male-type
  let total (weight-m1 + weight-m3)
  if total <= 0 [ become-m1 stop ]
  ifelse random-float total < weight-m1 [ become-m1 ] [ become-m3 ]
end

to random-female-type
  let total (weight-f0 + weight-f01 + weight-f02)
  if total <= 0 [ become-f0 stop ]
  let r random-float total
  ifelse r < weight-f0
    [ become-f0 ]
    [ ifelse r < weight-f0 + weight-f01 [ become-f01 ] [ become-f02 ] ]
end

;; ================= LIFE STAGE =================

to-report life-phase                  ;; 1 on the phase it is born
  report age + 1
end

to-report child?
  if mega? [ report false ]
  report life-phase <= child-until-phase
end

to-report old?
  if mega? [ report false ]
  report life-phase > adult-until-phase
end

to-report adult?
  report (not child?) and (not old?)
end

;; ================= MAIN LOOP =================

to go
  if not any? turtles [ stop ]
  if stop-at-phase > 0 and ticks >= stop-at-phase [ stop ]

  set births-this-phase 0
  set deaths-this-phase 0
  set cheats-this-phase 0
  set event-this-phase ""

  clear-mega
  ask patches [ set pcolor black ]
  reset-phase-state

  run-trauma
  ask turtles [ wander ]
  do-mating
  do-reproduction
  progress-aids
  do-child-mortality
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
    set partners-this-phase 0
    ;; drop references to dead partners
    if partner != nobody [ if not member? partner turtles [ set partner nobody ] ]
    ;; only mono bonds persist between phases
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

;; ================= TRUST & MATING =================

to-report effective-trust             ;; turtle reporter
  ;; AIDS collapses a mono's infinite trust down to a mortal number
  if infected? [ report aids-crash-trust - trauma-load ]
  report trust - trauma-load
end

to-report collapsed?                  ;; turtle reporter -- the trust floor
  if mega? [ report false ]
  if mono? and not infected? [ report false ]   ;; healthy mono never collapses
  report effective-trust <= trust-floor
end

to-report appeal                      ;; male reporter
  let a effective-trust
  if mono-class? [ set a a + mono-class-bonus ]
  if mega?       [ set a a + mega-bonus ]
  report a
end

to-report available?                  ;; male reporter
  if mega? [ report false ]           ;; the mega-handsome cannot reproduce
  if collapsed? [ report false ]
  if not adult? [ report false ]      ;; child protection
  ;; M3 wants exactly one partner, for life. M1 wants as many as it can get.
  if mono? [ report partner = nobody ]
  report partners-this-phase < max-partners
end

to-report seeking?                    ;; female reporter
  if not adult? [ report false ]      ;; child protection
  if gestation > 0 [ report false ]   ;; still recovering from giving birth
  if collapsed? [ report false ]
  if locked-on != nobody [ report false ]
  report partner = nobody
end

to-report mate-probability [ m ]      ;; female reporter, m = candidate male
  ;; pair score = his trust + her own (0 / -0.1 / -0.2) trust, minus her trauma
  let pair-score ([ appeal ] of m) + effective-trust
  let z attraction-sensitivity * (pair-score - mating-threshold)
  if z >  30 [ report 1 ]
  if z < -30 [ report 0 ]
  report 1 / (1 + exp (- z))
end

to do-mating
  ask females with [ seeking? ] [
    let pool males in-radius mate-radius
    set pool pool with [ available? ]
    if any? pool [
      let best max-one-of pool [ appeal + random-float choice-noise ]
      if random-float 1 < mate-probability best [
        set partner best
        ask best [ take-partner myself ]
        transmit-aids best
      ]
    ]
  ]
end

to take-partner [ f ]                 ;; male procedure, f = the female
  set partner f
  set partners-this-phase partners-this-phase + 1
  ;; M3 keeps a single partner for life, so its trust never declines at all
  if mono? [ stop ]
  ;; every meeting costs a little trust
  set trust trust - meet-trust-cost
  ;; cheating costs him whatever she is worth
  if every-partner-is-cheat? or partners-this-phase > 1 [
    set trust trust - (abs ([ trust ] of f) * cheat-penalty-multiplier)
    set cheats-this-phase cheats-this-phase + 1
  ]
end

;; ================= REPRODUCTION =================

to do-reproduction
  ask females [ try-breed ]
end

to try-breed                          ;; female procedure
  if bred-this-phase? [ stop ]
  if not adult? [ stop ]              ;; child protection: mother must be grown
  if gestation > 0 [ stop ]
  if locked-on != nobody [ stop ]     ;; wasted the phase on the mega-handsome
  if collapsed? [ stop ]
  if partner = nobody [ stop ]
  if not member? partner turtles [ set partner nobody stop ]
  let dad partner
  if [ mega? ] of dad [ stop ]
  if not [ adult? ] of dad [ stop ]   ;; child protection: father must be grown
  if [ collapsed? ] of dad [ stop ]
  if aids-sterile? and [ infected? ] of dad [ stop ]

  set bred-this-phase? true
  ask dad [ set bred-this-phase? true ]
  set gestation gestation-phases      ;; giving birth takes a phase

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
  ;; Only the father can catch it, and only if he is mono.
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
    become-m3
  ] [
    ifelse random-float 100 < inherit-fidelity [
      ifelse dad-type = "M3"
        ;; mono lines rarely breed true
        [ ifelse random-float 100 < mono-birth-chance [ become-m3 ] [ become-m1 ] ]
        [ become-m1 ]
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

;; --- 3. Godd Geonwoo (diddy): a mega-handsome magnetises every single female
;;        for exactly one phase, and cannot reproduce during it. ---
to diddy-event
  set diddy-count diddy-count + 1
  create-males 1 [
    init-common
    set sex-type "MEGA"
    set trust mega-trust
    set mega? true
    set mortality-rolled? true
    set lifespan 99                   ;; clear-mega removes him next phase
    setxy random-xcor random-ycor
    set-appearance
    set mega-who who
  ]
  let target females with [ partner = nobody and adult? ]
  if diddy-steals-partnered? [ set target females with [ adult? ] ]
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

;; --- 4. 2/3 THANOS: snaps two thirds of everyone except mono. ---
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

;; --- 5. AIDS: only ever infects mono entities. ---
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
  if aids-carriers? and partner != nobody [
    ask partner [ if not mono? [ set carrier? true ] ]
  ]
end

to transmit-aids [ m ]                ;; female procedure, m = male just paired with
  if not aids-on? [ stop ]
  if carrier? and [ mono? and not infected? ] of m [
    if random-float 100 < aids-transmission [ ask m [ infect ] ]
  ]
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

;; Childhood is dangerous, and it is far more dangerous for M1 than for M3.
to do-child-mortality
  ask turtles with [ child? and not mortality-rolled? ] [
    set mortality-rolled? true
    let risk child-death-female
    if breed = males [
      set risk ifelse-value mono? [ child-death-mono ] [ child-death-m1 ]
    ]
    if random-float 100 < risk [
      set child-deaths child-deaths + 1
      perish
    ]
  ]
end

to do-collapse
  if not collapse-is-fatal? [ stop ]
  ask turtles with [ collapsed? ] [
    set collapse-deaths collapse-deaths + 1
    perish
  ]
end

to do-aging
  ask turtles [
    ;; don't tick down the phase she is giving birth in, or gestation-phases = 1
    ;; would expire before it ever blocked anything
    if gestation > 0 and not bred-this-phase? [ set gestation gestation - 1 ]
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
  if sex-type = "M1"    [ set color blue    set size 1.2 ]
  if sex-type = "M3"    [ set color violet  set size 1.8  set shape "star" ]
  if sex-type = "MEGA"  [ set color magenta set size 3.5  set shape "star" ]
  if sex-type = "F0"    [ set color red     set size 1.0  set shape "circle 2" ]
  if sex-type = "F-0.1" [ set color orange  set size 1.0  set shape "circle 2" ]
  if sex-type = "F-0.2" [ set color yellow  set size 1.0  set shape "circle 2" ]
  if mono-class? [ set shape "star" set size size + 0.6 ]
  if carrier?    [ set shape "circle" ]
  if infected?   [ set shape "x" set color lime ]
  if child?      [ set size size * 0.5 ]
  if old?        [ set color color - 2 ]
  if collapsed?  [ set color gray ]
end

to-report count-type [ t ]
  report count turtles with [ sex-type = t ]
end

to-report child-count  report count turtles with [ child? ] end
to-report adult-count  report count turtles with [ adult? and not mega? ] end
to-report old-count    report count turtles with [ old? ] end

to-report mean-male-trust
  let pool males with [ not mono? and not mega? ]
  ifelse any? pool [ report mean [ trust ] of pool ] [ report 0 ]
end

to-report mean-eff-trust
  let pool turtles with [ not mono? and not mega? ]
  ifelse any? pool [ report mean [ effective-trust ] of pool ] [ report 0 ]
end

to-report mean-trauma
  ifelse any? turtles [ report mean [ trauma-load ] of turtles ] [ report 0 ]
end

to-report mono-class-count  report count turtles with [ mono-class? ] end
to-report infected-count    report count turtles with [ infected? ] end
to-report carrier-count     report count turtles with [ carrier? ] end
to-report mono-count        report count turtles with [ mono? ] end

to-report pair-rate
  let pool females with [ adult? ]
  ifelse any? pool
    [ report 100 * (count pool with [ partner != nobody ]) / (count pool) ]
    [ report 0 ]
end
@#$#@#$#@
GRAPHICS-WINDOW
810
10
1247
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
75.0
1
1
%
HORIZONTAL

SLIDER
5
155
200
188
weight-m3
weight-m3
0
100
25.0
1
1
%
HORIZONTAL

SLIDER
5
190
200
223
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
225
200
258
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
260
200
293
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
295
200
328
child-until-phase
child-until-phase
1
4
1.0
1
1
phases
HORIZONTAL

SLIDER
5
330
200
363
adult-until-phase
adult-until-phase
2
12
6.0
1
1
phases
HORIZONTAL

SLIDER
5
365
200
398
lifespan-phases
lifespan-phases
2
20
8.0
1
1
phases
HORIZONTAL

SLIDER
5
400
200
433
lifespan-variance
lifespan-variance
0
4
0.0
1
1
NIL
HORIZONTAL

SLIDER
5
435
200
468
child-death-m1
child-death-m1
0
100
60.0
1
1
%
HORIZONTAL

SLIDER
5
470
200
503
child-death-mono
child-death-mono
0
100
20.0
1
1
%
HORIZONTAL

SLIDER
5
505
200
538
child-death-female
child-death-female
0
100
20.0
1
1
%
HORIZONTAL

SLIDER
5
540
200
573
gestation-phases
gestation-phases
0
4
1.0
1
1
phases
HORIZONTAL

SLIDER
5
575
200
608
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
610
200
643
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
645
200
678
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
680
200
713
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
5
715
200
748
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
205
50
400
83
inf-trust
inf-trust
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
m1-trust-min
m1-trust-min
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
m1-trust-max
m1-trust-max
0
5
2.0
0.1
1
NIL
HORIZONTAL

SLIDER
205
155
400
188
meet-trust-cost
meet-trust-cost
0
1
0.1
0.01
1
per meeting
HORIZONTAL

SLIDER
205
190
400
223
cheat-penalty-multiplier
cheat-penalty-multiplier
0
10
1.0
0.1
1
x her trust
HORIZONTAL

SWITCH
205
225
400
258
every-partner-is-cheat?
every-partner-is-cheat?
0
1
-1000

SLIDER
205
260
400
293
max-partners
max-partners
1
10
3.0
1
1
per phase
HORIZONTAL

SLIDER
205
295
400
328
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
330
400
363
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
365
400
398
mega-trust
mega-trust
0
50
10.0
1
1
NIL
HORIZONTAL

SLIDER
205
400
400
433
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
435
400
468
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
470
400
503
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
505
400
538
trust-floor
trust-floor
-3
1
-0.5
0.1
1
NIL
HORIZONTAL

SWITCH
205
540
400
573
collapse-is-fatal?
collapse-is-fatal?
0
1
-1000

SLIDER
205
575
400
608
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
205
610
400
643
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
205
645
400
678
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
680
400
713
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
715
400
748
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
405
50
600
83
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
405
85
600
118
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
405
120
600
153
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
405
155
600
188
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
405
190
600
223
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
405
225
600
258
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
262
600
295
trauma-on?
trauma-on?
0
1
-1000

CHOOSER
405
297
600
342
trauma-mode
trauma-mode
"random" "scheduled"
0

SLIDER
405
344
600
377
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
379
600
412
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
414
600
447
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
449
600
482
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
484
600
517
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
519
600
552
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
554
600
587
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
589
600
622
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
624
600
657
tornado-trauma
tornado-trauma
0
2
0.04
0.01
1
NIL
HORIZONTAL

SLIDER
405
659
600
692
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
694
600
727
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
729
600
762
diddy-steals-partnered?
diddy-steals-partnered?
1
1
-1000

SLIDER
405
764
600
797
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
799
600
832
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
605
50
800
83
aids-on?
aids-on?
0
1
-1000

SLIDER
605
85
800
118
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
605
120
800
153
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
605
155
800
188
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
605
190
800
223
aids-crash-trust
aids-crash-trust
-2
3
0.3
0.1
1
NIL
HORIZONTAL

SLIDER
605
225
800
258
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
605
260
800
293
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
605
295
800
328
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
605
330
800
363
aids-carriers?
aids-carriers?
0
1
-1000

SWITCH
605
365
800
398
aids-sterile?
aids-sterile?
0
1
-1000

PLOT
605
405
800
690
life stages
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
"child" 1.0 0 -1184463 true "" "plot child-count"
"adult" 1.0 0 -13840069 true "" "plot adult-count"
"old" 1.0 0 -7500403 true "" "plot old-count"

MONITOR
810
455
878
500
phase
ticks
0
1
11

MONITOR
881
455
960
500
alive
count turtles
0
1
11

MONITOR
963
455
1060
500
paired %
pair-rate
1
1
11

MONITOR
1063
455
1247
500
trauma event
event-this-phase
17
1
11

MONITOR
810
503
880
548
M1
count-type "M1"
0
1
11

MONITOR
883
503
953
548
M3 (mono)
count-type "M3"
0
1
11

MONITOR
956
503
1050
548
mono class
mono-class-count
0
1
11

MONITOR
1053
503
1247
548
mean M1 trust
mean-male-trust
3
1
11

MONITOR
810
551
880
596
F0
count-type "F0"
0
1
11

MONITOR
883
551
960
596
F-0.1
count-type "F-0.1"
0
1
11

MONITOR
963
551
1040
596
F-0.2
count-type "F-0.2"
0
1
11

MONITOR
1043
551
1247
596
mean effective trust (non-mono)
mean-eff-trust
3
1
11

MONITOR
810
599
890
644
children
child-count
0
1
11

MONITOR
893
599
970
644
adults
adult-count
0
1
11

MONITOR
973
599
1050
644
old
old-count
0
1
11

MONITOR
1053
599
1247
644
cheats this phase
cheats-this-phase
0
1
11

MONITOR
810
647
900
692
AIDS infected
infected-count
0
1
11

MONITOR
903
647
1010
692
carriers
carrier-count
0
1
11

MONITOR
1013
647
1120
692
AIDS deaths
aids-deaths
0
1
11

MONITOR
1123
647
1247
692
child deaths
child-deaths
0
1
11

PLOT
810
696
1247
886
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
"M3 mono" 1.0 0 -8630108 true "" "plot count-type \"M3\""
"F0" 1.0 0 -2674135 true "" "plot count-type \"F0\""
"F-0.1" 1.0 0 -955883 true "" "plot count-type \"F-0.1\""
"F-0.2" 1.0 0 -1184463 true "" "plot count-type \"F-0.2\""
"monoclass" 1.0 0 -10899396 true "" "plot mono-class-count"
"infected" 1.0 0 -13840069 true "" "plot infected-count"

PLOT
810
889
1247
1039
trust & trauma
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
"mean M1 trust" 1.0 0 -13345367 true "" "plot mean-male-trust"
"eff. trust" 1.0 0 -16777216 true "" "plot mean-eff-trust"
"trauma load" 1.0 0 -2674135 true "" "plot mean-trauma"
"floor" 1.0 0 -7500403 true "" "plot trust-floor"

PLOT
5
755
400
930
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
"cheats" 1.0 0 -955883 true "" "plot cheats-this-phase"

@#$#@#$#@
# SOSOPH :: TRUST REPRODUCTION MODEL

An agent-based reproduction model in which male mating value is a depleting
resource called **trust**, and the two male strategies - promiscuity and
monogamy - pay for it in completely different ways.

One tick = one **phase**.

## MALE TYPES

Only males have trust in the sense that matters: theirs is a stock that can be
spent down. There are two of them. **M2 has been removed**; M1 now covers the
whole 1.0-2.0 range that M1 and M2 used to split between them.

| Type | trust | wants | trust decay |
| --- | --- | --- | --- |
| M1 | 1.0 - 2.0, rolled at birth | **many** partners | yes - and fast |
| M3 | infinite | **one** partner, for life | **never** |

**M1** takes up to `max-partners` females per phase. Every meeting costs him
`meet-trust-cost` (0.1). On top of that he cheats, and cheating costs him
whatever his partner is worth: her trust value, times
`cheat-penalty-multiplier`. With `every-partner-is-cheat?` on - the default,
since M1 always cheats - that penalty applies to every single partner, not
just the extras.

**M3 is mono.** It bonds with exactly one female and holds that bond for life,
so it never meets anyone new and never cheats. Its trust therefore never
declines at all. This is the whole trade-off in the model: M1 can out-breed M3
in any single phase, but it burns down its own trust doing so, and once its
effective trust hits `trust-floor` it collapses - it can no longer attract
anyone, and it dies if `collapse-is-fatal?` is on.

## FEMALE TYPES

| Type | trust |
| --- | --- |
| F0 | 0 |
| F-0.1 | -0.1 |
| F-0.2 | -0.2 |

A female's trust does two jobs. It drags on the pair score of any match she is
in (`pair score = his trust + her trust - her trauma`), and it is the price a
cheating male pays to be with her. Note the consequence: an **F0 female is free
to cheat with** - she costs the male nothing beyond the flat meeting cost.
Raise `cheat-penalty-multiplier` to scale all three female types up at once.

## LIFE CYCLE - 8 PHASES

| Life phase | Stage | Can reproduce |
| --- | --- | --- |
| 1 | child | **no** |
| 2 - 6 | adult | yes |
| 7 - 8 | old | **no** |

Boundaries are set by `child-until-phase` (1), `adult-until-phase` (6) and
`lifespan-phases` (8).

**Child protection.** Nothing can reproduce until it has grown for at least
one full phase. The check runs on both parents, so a grown female cannot
breed with a male child either.

**Childhood is lethal, and unevenly so.** Every entity takes exactly one
mortality roll, during its child phase:

- M1 male child: **60%** chance of dying (`child-death-m1`)
- M3 male child: **20%** chance of dying (`child-death-mono`)
- female child: **20%** chance of dying (`child-death-female`)

This is the counterweight to M1's breeding advantage - it produces far more
children, but two out of three of its sons never reach adulthood.

**Giving birth takes a phase.** After a female gives birth she is occupied for
`gestation-phases` (1), during which she cannot pair or breed.

## GENERATIONAL TRAUMA

Five events. In `random` mode each rolls its own per-phase chance. In
`scheduled` mode they rotate in order every `trauma-interval` phases.

1. **Tsunami** - a band sweeps the world (1% per phase, 25% lethality).
2. **Tornado** - a vortex kills and scatters (2% per phase, 20% lethality).
3. **Godd Geonwoo (diddy)** - a mega-handsome magnetises every single adult
   female for one phase and cannot reproduce, so they all waste the phase.
4. **2/3 Thanos** - removes two thirds of everyone except mono, and promotes
   surviving mono entities to **mono class**.
5. **AIDS** - see below.

`trauma-load` passes to children at `trauma-heritability` and subtracts from
trust permanently.

## AIDS

AIDS **only ever infects mono (M3) entities**. It is the counterweight to
mono, which is otherwise unbeatable: infinite trust that never decays, no
collapse, and an explicit exemption from the Thanos snap.

An infected mono has its infinite trust crashed to `aids-crash-trust`, cannot
reproduce while `aids-sterile?` is on, keeps holding its lifelong bond
regardless, and dies after `aids-duration` phases.

Four transmission routes: **outbreaks**, **reproduction** (a mono father rolls
`aids-breeding-chance` every time he produces offspring, and rolls again at
`aids-transmission` if the mother is a carrier), **carriers** (a female bonded
to an infected mono is never infected herself but passes it to the next mono
she bonds with), and **vertical** transmission to mono sons.

## WHAT TO WATCH

- The M1-vs-M3 race is the point of the model. Watch `mean M1 trust` fall
  while the `M1` count climbs, then watch M1 collapse as trust hits the floor.
- Turn `every-partner-is-cheat?` off and M1 becomes far more sustainable.
- Set `child-death-m1` down to 20% to match M3 and M1 runs away with the
  population.
- Turn `aids-on?` off and mono ratchets upward forever.
- The `life stages` plot shows the child mortality bottleneck directly.

## COLOR KEY

blue = M1, violet star = M3 (mono), magenta star = mega-handsome,
red = F0, orange = F-0.1, yellow = F-0.2, lime x = AIDS-infected,
gray = collapsed, star = mono class. Children render at half size, old
entities render darker.
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
