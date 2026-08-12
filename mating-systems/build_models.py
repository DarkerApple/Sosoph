#!/usr/bin/env python3
"""
Generates monogamy.nlogo and polygyny.nlogo from one shared code body.

The two models are deliberately identical in every respect except the marriage
rule, so that any difference in outcome is attributable to the mating system
and not to an incidental difference in how the two files were written. Keeping
a single source of truth here is what guarantees that.

Run:  python3 build_models.py
"""

import pathlib

HERE = pathlib.Path(__file__).parent

# ---------------------------------------------------------------------------
# The NetLogo code tab, shared by both models.
# {SUITOR_CLAUSE} and {FIELD_CLAUSE} are the ONLY substitutions that change
# behaviour; everything else differs at most in wording.
# ---------------------------------------------------------------------------
CODE = r''';; =========================================================================
;;  MATING SYSTEMS AND THE EVOLUTION OF A FORAGING POPULATION
;;  -- {TITLE} MODEL --
;;
;;  One tick = one month.  One patch = one square kilometre.  Energy in kcal.
;;
;;  This file and its companion ({OTHER}.nlogo) are generated from a single
;;  shared code body by build_models.py. The only behavioural difference is
;;  the marriage rule in `marry`, so any divergence in outcome is caused by
;;  the mating system and not by an incidental difference in implementation.
;;
;;  Sources for every constant are given in the Info tab.
;; =========================================================================

breed [ folk  person ]
breed [ camps camp   ]

undirected-link-breed [ marriages marriage ]   ;; husband <-> wife
directed-link-breed   [ births    birth    ]   ;; mother  --> child

globals [
  half-saturation           ;; Holling type-II constant, kcal
  drought-months-left
  season-multiplier
  next-lineage
  births-this-year
  deaths-this-year
  u5-deaths-this-year
  window-births
  window-u5-deaths
]

patches-own [
  food                      ;; harvestable standing stock, kcal
  local-k                   ;; this square kilometre's carrying capacity
]

camps-own [ camp-size ]

folk-own [
  age-months
  male?
  energy                    ;; body energy reserve, kcal
  wealth                    ;; exchangeable surplus (bridewealth), kcal-equivalent
  pregnant-months
  amenorrhea-months
  widowed-months
  n-offspring               ;; lifetime reproductive success
  efficiency                ;; heritable foraging ability, mean 1.0
  mt-lineage                ;; maternally inherited marker
  y-lineage                 ;; paternally inherited marker
  my-camp
  intake-ratio              ;; share of requirement met last month
  harvest-store             ;; kcal acquired this month
  residual                  ;; a married man's surplus, passed to his wives
  father-was                ;; father, recorded so bridewealth can be inherited
]

;; =========================================================================
;;  SETUP
;; =========================================================================

to setup
  clear-all
  set half-saturation
    half-saturation-fraction * (2 * forage-radius + 1) ^ 2 * patch-carrying-capacity
  set drought-months-left 0
  set next-lineage 0
  set window-births 0
  set window-u5-deaths 0
  build-richness-field
  ask patches [
    set food 0.85 * local-k
    recolour-patch
  ]
  create-camps max (list 1 (floor (initial-population / camp-target))) [
    set hidden? true
    setxy random-xcor random-ycor
  ]
  let camp-list sort camps
  create-folk initial-population [
    set male? (random-float 1 < 0.5)
    set age-months 12 * draw-stationary-age
    set my-camp item (who mod (length camp-list)) camp-list
    move-to my-camp
    set efficiency 1.0
    set mt-lineage next-lineage
    set y-lineage next-lineage
    set next-lineage next-lineage + 1
    set energy 0.8 * reserve-cap
    set wealth 0
    set pregnant-months 0
    set amenorrhea-months 0
    set widowed-months 999
    set n-offspring 0
    set intake-ratio 1
    set father-was nobody
    set-appearance
  ]
  reset-ticks
end

;; Some country is simply better than other country. Orians' polygyny
;; threshold only bites when men differ in the resources they control, so the
;; landscape carries a smooth multiplicative richness field. It applies
;; identically in both models: it is what makes polygyny possible, not what
;; makes it costly.
to build-richness-field
  ask patches [ set local-k random-normal 0 1 ]
  repeat 6 [                                   ;; blur into broad regions
    ask patches [ set local-k (local-k + sum [ local-k ] of neighbors4) / 5 ]
  ]
  let mu mean [ local-k ] of patches
  let sigma standard-deviation [ local-k ] of patches
  if sigma = 0 [ set sigma 1 ]
  ask patches [ set local-k exp (landscape-heterogeneity * (local-k - mu) / sigma) ]
  let scale mean [ local-k ] of patches
  ask patches [ set local-k patch-carrying-capacity * local-k / scale ]
end

;; Draw an age from the stationary age distribution implied by the Siler
;; hazard, so the run does not start from an artificial age structure.
to-report draw-stationary-age
  let weights []
  let surv 1
  let a 0
  repeat 90 [
    set weights lput surv weights
    set surv surv * exp (0 - siler-hazard a)
    set a a + 1
  ]
  let r random-float (sum weights)
  let acc 0
  let i 0
  while [ i < length weights ] [
    set acc acc + item i weights
    if acc >= r [ report i + random-float 1 ]
    set i i + 1
  ]
  report 0
end

;; =========================================================================
;;  MAIN LOOP
;; =========================================================================

to go
  if not any? folk [ stop ]
  set births-this-year 0
  set deaths-this-year 0
  set u5-deaths-this-year 0

  grow-food
  forage-and-provision
  relocate-camps
  reproduce
  marry
  apply-mortality
  advance-age

  ask patches [ recolour-patch ]
  ask folk [ set-appearance ]
  tick
end

;; =========================================================================
;;  LANDSCAPE
;;  Logistic regrowth of harvestable stock, a seasonal cycle, and occasional
;;  multi-month droughts that cut carrying capacity.
;; =========================================================================

to grow-food
  set season-multiplier 1 + seasonal-amplitude * sin (360 * (ticks mod 12) / 12)

  ifelse drought-months-left > 0
    [ set drought-months-left drought-months-left - 1 ]
    [ if random-float 1 < droughts-per-century / 1200
        [ set drought-months-left 6 + random 19 ] ]

  let shock ifelse-value (drought-months-left > 0) [ drought-severity ] [ 1 ]
  let r regrowth-rate * season-multiplier

  ask patches [
    let k local-k * shock
    set food food + r * food * (1 - food / k)
    if food < 0.02 * local-k [ set food 0.02 * local-k ]
    if food > local-k [ set food local-k ]
  ]
end

;; =========================================================================
;;  ENERGETICS
;; =========================================================================

to-report days-per-month
  report 30.44
end

to-report age-years
  report age-months / 12
end

;; Total energy expenditure, kcal/day. Adult values are doubly-labelled-water
;; measurements for Hadza foragers; child values follow FAO/WHO/UNU schedules.
to-report tee
  let a age-years
  if a <  1 [ report 550 ]
  if a <  2 [ report 900 ]
  if a <  6 [ report ifelse-value male? [ 1400 ] [ 1350 ] ]
  if a < 10 [ report ifelse-value male? [ 1800 ] [ 1750 ] ]
  if a < 14 [ report ifelse-value male? [ 2250 ] [ 2050 ] ]
  if a < 18 [ report ifelse-value male? [ 2500 ] [ 2050 ] ]
  report ifelse-value male? [ 2650 ] [ 1880 ]
end

;; Share of a child's energy that comes from milk rather than from food.
to-report milk-share
  if age-months <  6 [ report 1.0 ]
  if age-months < 12 [ report 0.6 ]
  if age-months < 24 [ report 0.3 ]
  report 0
end

;; Energy that must arrive as food this month. Milk is charged to the mother.
to-report own-food-need
  let base tee * (1 - milk-share)
  if (not male?) and pregnant-months > 3 [ set base base + 300 ]
  report base * days-per-month
end

;; Full monthly requirement, including milk a nursing mother must synthesise.
to-report requirement
  let need own-food-need
  if not male? [
    let nursling min-one-of (out-birth-neighbors with [ age-months < 24 ]) [ age-months ]
    if nursling != nobody [
      set need need + days-per-month * milk-synthesis-cost *
        ([ tee ] of nursling) * ([ milk-share ] of nursling)
    ]
  ]
  report need
end

to-report reserve-cap
  report (max (list 1 tee)) * reserve-days
end

to-report condition
  report min (list 1 (energy / reserve-cap))
end

;; Food acquisition capability, kcal/day: a logistic rise to adult competence
;; and a senescent decline, scaled by the heritable efficiency trait.
to-report capability
  let a age-years
  let rise 1 / (1 + exp (0 - (a - production-rise-mid) / 3.0))
  let fall 1 / (1 + exp ((a - 58.0) / 7.0))
  let peak ifelse-value male? [ peak-production-male ] [ peak-production-female ]
  let c peak * rise * fall * efficiency
  ;; pregnancy and infant care cut a woman's foraging time
  if (not male?) and (pregnant-months > 0 or amenorrhea-months > 0) [
    set c c * childcare-production-cost
  ]
  report c
end

;; =========================================================================
;;  FORAGING AND PROVISIONING
;;
;;  Intake follows a Holling type-II response on the stock within foraging
;;  range, so returns fall as a neighbourhood is drawn down. A married man
;;  meets his own needs first and divides what is left equally among his
;;  wives' sub-households: in the monogamy model that divisor is always one,
;;  under polygyny it is the number of co-wives. That is the mechanism by
;;  which co-wives dilute paternal investment -- it is arithmetic, not an
;;  imposed penalty. A share of every household's surplus is then shared
;;  band-wide, identically in both models.
;; =========================================================================

to forage-and-provision
  ;; 1. harvest
  ask folk [
    let cells patches in-radius forage-radius
    let avail sum [ food ] of cells
    set harvest-store 0
    if capability > 0 and avail > 0 [
      let take capability * days-per-month * avail / (avail + half-saturation)
      set harvest-store take
      ask cells [ set food food - take * (food / avail) ]
    ]
  ]

  ;; 2. married men eat, top up reserves, and pass on the remainder
  ask folk with [ male? and any? my-marriages ] [
    let need requirement
    ifelse harvest-store >= need [
      let surplus harvest-store - need
      let top-up min (list (reserve-cap - energy) surplus)
      if top-up > 0 [
        set energy energy + top-up
        set surplus surplus - top-up
      ]
      set intake-ratio 1
      set residual surplus
    ] [
      let drawn min (list energy (need - harvest-store))
      set energy energy - drawn
      set intake-ratio (harvest-store + drawn) / need
      set residual 0
    ]
  ]

  ;; 3. provisioning units, then band-wide sharing of surplus
  let units household-units
  if empty? units [ stop ]
  let pools map [ u -> unit-pool u ] units
  let needs map [ u -> unit-need u ] units

  let kitty 0
  let i 0
  while [ i < length pools ] [
    let excess (item i pools) - (item i needs)
    if excess > 0 [
      let given excess * band-sharing
      set pools replace-item i pools ((item i pools) - given)
      set kitty kitty + given
    ]
    set i i + 1
  ]
  let shortfalls (map [ [p n] -> max (list 0 (n - p)) ] pools needs)
  let total-short sum shortfalls
  if total-short > 0 and kitty > 0 [
    let frac min (list 1 (kitty / total-short))
    set pools (map [ [p s] -> p + s * frac ] pools shortfalls)
    set kitty max (list 0 (kitty - total-short * frac))
  ]
  if kitty > 0 [
    let per kitty / (length pools)
    set pools map [ p -> p + per ] pools
  ]

  ;; 4. allocate within each unit
  set i 0
  while [ i < length units ] [
    allocate-to-unit (item i units) (item i pools)
    set i i + 1
  ]
end

;; A provisioning unit is a list of people who eat from one pool: a wife with
;; her dependent children, or an unattached adult with hers.
to-report household-units
  let wives sort folk with [ not male? and any? my-marriages ]
  let loose sort folk with [ not any? my-marriages and not is-dependent-child? ]
  report (sentence
    (map [ w -> sentence w (sort [ dependent-children ] of w) ] wives)
    (map [ s -> ifelse-value ([ male? ] of s)
                  [ (list s) ]
                  [ sentence s (sort [ dependent-children ] of s) ] ] loose))
end

to-report dependent-children
  report out-birth-neighbors with [ age-years < 15 ]
end

to-report is-dependent-child?
  report age-years < 15 and any? in-birth-neighbors
end

to-report husband
  let m one-of my-marriages
  if m = nobody [ report nobody ]
  report [ other-end ] of m
end

to-report unit-pool [ u ]
  let total sum map [ p -> [ harvest-store ] of p ] u
  let head-of-unit first u
  if not [ male? ] of head-of-unit [
    let hus [ husband ] of head-of-unit
    if hus != nobody [
      set total total + ([ residual ] of hus) / (max (list 1 ([ count my-marriages ] of hus)))
    ]
  ]
  report total
end

to-report unit-need [ u ]
  report sum map [ p -> [ requirement ] of p ] u
end

;; children are served first, youngest first
to-report feeding-order-key
  report ifelse-value (age-years < 15) [ age-years ] [ 1000 + age-years ]
end

to allocate-to-unit [ u pool ]
  let avail pool
  let ranked sort-by [ [a b] -> [ feeding-order-key ] of a < [ feeding-order-key ] of b ] u

  foreach ranked [ p ->
    ask p [
      let need requirement
      let got min (list need (max (list 0 avail)))
      set avail avail - got
      if need - got > 0 [
        let drawn min (list energy (need - got))
        set energy energy - drawn
        set got got + drawn
      ]
      set intake-ratio ifelse-value (need > 0) [ got / need ] [ 1 ]
    ]
  ]
  ;; leftovers rebuild body reserves, children first
  foreach ranked [ p ->
    if avail > 0 [
      ask p [
        let add min (list (max (list 0 (reserve-cap - energy))) avail)
        set energy energy + add
        set avail avail - add
      ]
    ]
  ]
  ;; anything still spare is banked as exchangeable surplus
  if avail > 0 [
    let holder first ranked
    let hus [ husband ] of (first u)
    if hus != nobody [ set holder hus ]
    ask holder [ set wealth min (list (tee * max-wealth-days) (wealth + avail)) ]
  ]
end

;; =========================================================================
;;  RESIDENTIAL MOBILITY
;;  Camps relocate by Charnov's marginal value theorem: leave once a reachable
;;  neighbourhood offers materially better returns. Camps split when they
;;  outgrow the local resource base and merge when they get too small.
;; =========================================================================

to relocate-camps
  ask camps [ set camp-size count folk with [ my-camp = myself ] ]

  ;; fission
  ask camps with [ camp-size > camp-max ] [
    let parent self
    let leavers n-of (floor (camp-size / 2)) folk with [ my-camp = parent ]
    hatch-camps 1 [
      set hidden? true
      setxy (xcor + 3 + random 4) (ycor - 4 + random 9)
      let newcamp self
      ask leavers [ set my-camp newcamp ]
    ]
  ]

  ;; fusion and clean-up
  ask camps [ set camp-size count folk with [ my-camp = myself ] ]
  ask camps with [ camp-size = 0 ] [ die ]
  ask camps [
    if camp-size < camp-min and count camps > 1 [
      let mine self
      let mysize camp-size
      let target min-one-of (other camps with [ camp-size + mysize <= camp-max ])
                            [ distance mine ]
      if target != nobody [
        if distance target <= 12 [
          ask folk with [ my-camp = mine ] [ set my-camp target ]
          ask target [ set camp-size camp-size + mysize ]
          die
        ]
      ]
    ]
  ]

  ;; relocation
  ask camps [
    let here-stock neighbourhood-stock
    let pool patches in-radius move-radius
    let sample n-of (min (list 20 (count pool))) pool
    let best max-one-of sample [ neighbourhood-stock ]
    if best != nobody [
      if [ neighbourhood-stock ] of best > here-stock * camp-move-gain [
        move-to best
      ]
    ]
  ]

  ask folk [ if my-camp != nobody [ move-to my-camp ] ]
end

to-report neighbourhood-stock
  report sum [ food ] of patches in-radius forage-radius
end

;; =========================================================================
;;  REPRODUCTION
;;  Natural fertility: adolescent subfecundity, a fecundability decline after
;;  the late thirties, gestation, and lactational amenorrhoea that lengthens
;;  when the mother is thin (the nutrition-fertility link).
;; =========================================================================

to-report fecundability
  let a age-years
  if a < menarche-age or a >= menopause-age [ report 0 ]
  let ramp min (list 1 ((a - menarche-age) / adolescent-subfecundity))
  let decline 1 / (1 + exp ((a - 38.0) / 3.0))
  report peak-fecundability * ramp * decline
end

to reproduce
  ask folk with [ not male? ] [
    ifelse pregnant-months > 0 [
      set pregnant-months pregnant-months + 1
      if pregnant-months > gestation-months [ give-birth ]
    ] [
      ifelse amenorrhea-months > 0 [
        let stretch 1 + 0.8 * (1 - condition)
        set amenorrhea-months amenorrhea-months + 1
        if amenorrhea-months > lactational-amenorrhea * stretch [
          set amenorrhea-months 0
        ]
      ] [
        if husband != nobody [
          let p fecundability * max (list 0 (min (list 1 ((condition - 0.30) / 0.35))))
          if random-float 1 < p [ set pregnant-months 1 ]
        ]
      ]
    ]
  ]
end

to give-birth
  set pregnant-months 0
  ifelse random-float 1 < stillbirth-rate [
    set amenorrhea-months 3
  ] [
    let dad husband
    let mum-eff efficiency
    let dad-eff ifelse-value (dad != nobody) [ [ efficiency ] of dad ] [ efficiency ]
    let dad-y   ifelse-value (dad != nobody) [ [ y-lineage ] of dad ] [ 0 - 1 ]
    let mother-self self
    hatch-folk 1 [
      set age-months 0
      set male? (random-float 1 < 0.515)      ;; human secondary sex ratio
      set efficiency max (list efficiency-min
                    (min (list efficiency-max
                     ((mum-eff + dad-eff) / 2 + random-normal 0 mutation-sd))))
      set y-lineage dad-y
      set pregnant-months 0
      set amenorrhea-months 0
      set widowed-months 999
      set n-offspring 0
      set wealth 0
      set energy 0.6 * reserve-cap
      set intake-ratio 1
      set my-camp [ my-camp ] of mother-self
      set father-was dad
      create-birth-from mother-self
      set-appearance
    ]
    set n-offspring n-offspring + 1
    if dad != nobody [ ask dad [ set n-offspring n-offspring + 1 ] ]
    set births-this-year births-this-year + 1
    set window-births window-births + 1
    set amenorrhea-months 1

    if random-float 1 < maternal-mortality [
      ask my-marriages [ ask other-end [ set widowed-months 0 ] ]
      set deaths-this-year deaths-this-year + 1
      die
    ]
  ]
end

;; =========================================================================
;;  MARRIAGE
;;
;;  *** THIS IS THE ONLY PROCEDURE THAT DIFFERS BETWEEN THE TWO MODELS. ***
;;
;;  Women rank the men in their marriage network by the provisioning they
;;  would actually receive: expected production divided among existing wives
;;  plus one. This is Orians' polygyny threshold -- a woman accepts an
;;  already-married man when his divided resources still beat the best
;;  unmarried man's undivided resources. Marriage costs bridewealth that must
;;  be accumulated first, in BOTH models, so the two differ only in whether a
;;  man may marry more than once.
;; =========================================================================

to marry
  let suitors folk with [
    male? and age-years >= male-marriage-age and wealth >= bride-price
    {SUITOR_CLAUSE}
  ]
  if not any? suitors [ stop ]

  ask folk with [ not male?
                  and age-years >= female-marriage-age
                  and age-years < menopause-age
                  and not any? my-marriages
                  and widowed-months >= remarriage-delay ] [
    let me self
    let field suitors with [
      distance me <= mate-search-radius and wealth >= bride-price
      {FIELD_CLAUSE}
    ]
    if any? field [
      let choice max-one-of field [ suitor-value ]
      if choice != nobody [
        ask choice [ set wealth wealth - bride-price ]
        create-marriage-with choice
        ;; patrilocal residence: the bride and her children join his camp
        let hiscamp [ my-camp ] of choice
        set my-camp hiscamp
        ask dependent-children [ set my-camp hiscamp ]
      ]
    ]
  ]
end

;; How a suitor is valued in the marriage market.
;;
;; `co-wife-penalty` spans the two ways marriages actually get made. At 1.0 it
;; is the strict Orians polygyny threshold: a woman weighs a man's resources
;; divided equally among his co-wives, and so almost never accepts a married
;; man. At 0.0 it is a pure bridewealth auction: the bride's kin take the
;; highest bidder and existing wives are irrelevant. Because bridewealth is
;; paid to the bride's kin, real polygynous societies sit near the low end --
;; and if you raise this to 1.0 the polygyny model goes very nearly
;; monogamous even though polygyny is permitted, which is a result worth
;; seeing for itself.
to-report suitor-value
  let divisor 1 + co-wife-penalty * (count my-marriages)
  report ((capability + wealth / 365) / divisor) * (0.85 + random-float 0.30)
end

;; =========================================================================
;;  MORTALITY
;;  A Siler competing-hazards baseline fitted to hunter-gatherer data,
;;  multiplied up once body reserves are seriously drawn down, plus a risk
;;  premium on unmarried men of prime age standing for the male-male
;;  competition that reproductive skew generates.
;; =========================================================================

to-report siler-hazard [ a ]
  report siler-a1 * exp (0 - siler-b1 * a) + siler-a2 + siler-a3 * exp (siler-b3 * a)
end

to apply-mortality
  ask folk [
    let h siler-hazard age-years
    let stress max (list 0 ((starvation-onset - condition) / starvation-onset))
    let beta starvation-beta
    if age-years < 5 [ set beta beta * child-starvation-extra ]
    set h h * (1 + beta * stress * stress)
    if male? and age-years >= 18 and age-years <= 40 and not any? my-marriages [
      set h h + siler-a2 * (bachelor-risk - 1)
    ]
    if random-float 1 < 1 - exp (0 - h / 12) [
      set deaths-this-year deaths-this-year + 1
      if age-years < 5 [
        set u5-deaths-this-year u5-deaths-this-year + 1
        set window-u5-deaths window-u5-deaths + 1
      ]
      ask my-marriages [ ask other-end [ set widowed-months 0 ] ]
      bequeath
      die
    ]
  ]
end

;; Bridewealth passes to surviving sons. This is what lets advantage compound
;; across generations in the societies where polygyny is common, and it applies
;; identically in both models.
to bequeath
  if not male? or wealth <= 0 [ stop ]
  let heirs folk with [ male? and father-was = myself ]
  if any? heirs [
    let each wealth * wealth-inheritance / (count heirs)
    ask heirs [ set wealth min (list (tee * max-wealth-days) (wealth + each)) ]
  ]
end

to advance-age
  ask folk [
    set wealth wealth * (1 - wealth-decay)
    set age-months age-months + 1
    set widowed-months widowed-months + 1
  ]
end

;; =========================================================================
;;  REPORTERS  (used by the plots, monitors and BehaviorSpace)
;; =========================================================================

to-report population
  report count folk
end

to-report adult-males
  report count folk with [ male? and age-years >= 18 ]
end

to-report adult-females
  report count folk with [ not male? and age-years >= 18 ]
end

to-report married-males
  report count folk with [ male? and any? my-marriages ]
end

to-report pct-bachelors
  if adult-males = 0 [ report 0 ]
  report 100 * (adult-males - married-males) / adult-males
end

to-report mean-wives-per-married-man
  if married-males = 0 [ report 0 ]
  report (count folk with [ not male? and any? my-marriages ]) / married-males
end

to-report mean-condition
  if not any? folk [ report 0 ]
  report mean [ condition ] of folk
end

to-report child-mortality-per-1000
  if window-births = 0 [ report 0 ]
  report 1000 * window-u5-deaths / window-births
end

;; completed reproductive success, over men past reproductive age
to-report completed-males
  report folk with [ male? and age-years >= 45 ]
end

to-report mean-male-rs
  if not any? completed-males [ report 0 ]
  report mean [ n-offspring ] of completed-males
end

to-report variance-male-rs
  if count completed-males < 2 [ report 0 ]
  report variance [ n-offspring ] of completed-males
end

to-report pct-males-childless
  if not any? completed-males [ report 0 ]
  report 100 * (count completed-males with [ n-offspring = 0 ]) / (count completed-males)
end

;; Effective population size. Unequal numbers of breeding males and females
;; push Ne below the census size: the central genetic cost of reproductive skew.
to-report effective-population-size
  let nm max (list 1 married-males)
  let nf max (list 1 adult-females)
  report 4 * nm * nf / (nm + nf)
end

to-report ne-over-n
  if population = 0 [ report 0 ]
  report effective-population-size / population
end

to-report mt-lineages-left
  if not any? folk [ report 0 ]
  report length remove-duplicates [ mt-lineage ] of folk
end

to-report y-lineages-left
  if not any? folk with [ male? ] [ report 0 ]
  report length remove-duplicates [ y-lineage ] of folk with [ male? ]
end

to-report mean-efficiency
  if not any? folk [ report 0 ]
  report mean [ efficiency ] of folk
end

to-report mean-food
  report (sum [ food ] of patches) / (sum [ local-k ] of patches)
end

to-report year
  report floor (ticks / 12)
end

;; =========================================================================
;;  DISPLAY
;; =========================================================================

to recolour-patch
  set pcolor scale-color green (food / local-k) -0.4 1.6
end

to set-appearance
  ifelse age-years < 15 [
    set shape "circle"
    set size 0.7
    set color yellow
  ] [
    set shape "person"
    set size 1.2
    ifelse male?
      [ set color ifelse-value (any? my-marriages) [ blue ] [ gray ] ]
      [ set color ifelse-value (any? my-marriages) [ pink ] [ violet ] ]
  ]
end
'''

# ---------------------------------------------------------------------------
# Interface widgets
# ---------------------------------------------------------------------------
SLIDERS = [
    ("initial-population", 50, 10, 600, 200, "people"),
    ("patch-carrying-capacity", 100000, 25000, 1000000, 400000, "kcal/km2"),
    ("regrowth-rate", 0.05, 0.01, 0.5, 0.24, "per month"),
    ("seasonal-amplitude", 0, 0.05, 0.8, 0.4, "fraction"),
    ("droughts-per-century", 0, 1, 20, 6, "per 100yr"),
    ("drought-severity", 0.2, 0.05, 1, 0.45, "x K"),
    ("forage-radius", 1, 1, 5, 2, "km"),
    ("move-radius", 2, 1, 20, 8, "km"),
    ("half-saturation-fraction", 0.05, 0.05, 0.6, 0.15, "of pristine"),
    ("camp-move-gain", 1.0, 0.05, 2.0, 1.15, "ratio"),
    ("camp-target", 10, 5, 60, 30, "people"),
    ("camp-max", 20, 5, 90, 50, "people"),
    ("camp-min", 3, 1, 20, 7, "people"),
    ("peak-production-male", 2000, 100, 9000, 6300, "kcal/day"),
    ("peak-production-female", 1000, 100, 6000, 3500, "kcal/day"),
    ("production-rise-mid", 10, 0.5, 20, 13.5, "years"),
    ("childcare-production-cost", 0.3, 0.05, 1, 0.65, "multiplier"),
    ("reserve-days", 20, 5, 90, 55, "days"),
    ("starvation-onset", 0.2, 0.05, 1, 0.6, "of reserve"),
    ("starvation-beta", 0, 1, 30, 12, "hazard mult"),
    ("child-starvation-extra", 1, 0.1, 3, 1.8, "multiplier"),
    ("milk-synthesis-cost", 1, 0.05, 1.5, 1.05, "multiplier"),
    ("menarche-age", 12, 0.5, 18, 15, "years"),
    ("menopause-age", 40, 1, 55, 45, "years"),
    ("adolescent-subfecundity", 0.5, 0.5, 8, 4, "years"),
    ("peak-fecundability", 0.05, 0.01, 0.4, 0.2, "per month"),
    ("gestation-months", 8, 1, 10, 9, "months"),
    ("lactational-amenorrhea", 6, 1, 36, 18, "months"),
    ("stillbirth-rate", 0, 0.01, 0.2, 0.05, "fraction"),
    ("maternal-mortality", 0, 0.001, 0.05, 0.012, "per birth"),
    ("male-marriage-age", 14, 1, 30, 18, "years"),
    ("female-marriage-age", 13, 1, 30, 16, "years"),
    ("bride-price", 0, 10000, 600000, 250000, "kcal"),
    ("max-wealth-days", 100, 50, 2500, 1200, "days"),
    ("wealth-decay", 0, 0.005, 0.1, 0.01, "per month"),
    ("wealth-inheritance", 0, 0.05, 1, 0.5, "to sons"),
    ("co-wife-penalty", 0, 0.05, 1, 0.0, "0=auction 1=Orians"),
    ("landscape-heterogeneity", 0, 0.05, 1.5, 0.75, "sd of richness"),
    ("remarriage-delay", 0, 1, 36, 12, "months"),
    ("mate-search-radius", 3, 1, 30, 20, "km"),
    ("band-sharing", 0, 0.05, 1, 0.45, "fraction"),
    ("bachelor-risk", 1, 0.05, 2.5, 1.35, "hazard mult"),
    ("max-wives", 1, 1, 10, 6, "wives"),
    ("mutation-sd", 0, 0.005, 0.1, 0.02, "sd"),
    ("efficiency-min", 0.1, 0.05, 1, 0.5, "x"),
    ("efficiency-max", 1, 0.05, 3, 2.0, "x"),
    ("siler-a1", 0, 0.01, 1, 0.422, "per yr"),
    ("siler-b1", 0.5, 0.01, 2, 1.131, "NIL"),
    ("siler-a2", 0, 0.001, 0.05, 0.013, "per yr"),
    ("siler-a3", 0, 0.00001, 0.001, 4.32e-05, "per yr"),
    ("siler-b3", 0.05, 0.0005, 0.2, 0.1075, "NIL"),
]

MONITORS = [
    ("population", "population"),
    ("year", "year"),
    ("% men unmarried", "pct-bachelors"),
    ("wives per married man", "mean-wives-per-married-man"),
    ("mean condition", "mean-condition"),
    ("under-5 deaths /1000", "child-mortality-per-1000"),
    ("Ne / N", "ne-over-n"),
    ("mtDNA lineages", "mt-lineages-left"),
    ("Y lineages", "y-lineages-left"),
    ("mean efficiency", "mean-efficiency"),
]

# name, xlabel, ylabel, ymax, [(pen name, colour code, plot command)]
BLACK, BLUE, RED, GREEN, PURPLE, ORANGE = (
    "-16777216", "-13345367", "-2674135", "-10899396", "-8630108", "-955883")
PLOTS = [
    ("Population", "years", "people", [("people", BLACK, "plot population")]),
    ("Nutrition and food", "years", "0-1",
     [("mean condition", BLUE, "plot mean-condition"),
      ("landscape food", GREEN, "plot mean-food")]),
    ("Unmarried men", "years", "%", [("% unmarried", RED, "plot pct-bachelors")]),
    ("Male reproductive skew", "years", "value",
     [("variance in RS", PURPLE, "plot variance-male-rs"),
      ("% childless", ORANGE, "plot pct-males-childless")]),
    ("Genetic diversity", "years", "lineages",
     [("mtDNA", RED, "plot mt-lineages-left"),
      ("Y chromosome", BLUE, "plot y-lineages-left")]),
    ("Effective population size", "years", "Ne / N",
     [("Ne / N", GREEN, "plot ne-over-n")]),
    ("Adaptation", "years", "efficiency",
     [("mean efficiency", PURPLE, "plot mean-efficiency")]),
    ("Under-5 mortality", "years", "per 1000 births",
     [("u5 deaths", RED, "plot child-mortality-per-1000")]),
]


def num(x):
    """
    Format a number the way NetLogo writes them. Plain decimal only: the
    widget reader cannot parse scientific notation, so repr()'s "4.32e-05"
    silently breaks the whole interface section.
    """
    if isinstance(x, int) or float(x).is_integer():
        return str(int(x))
    return f"{x:.10f}".rstrip("0")


def build_interface():
    w = []
    # Field order and geometry mirror a stock NetLogo 6.4 model: 51x51 patches
    # at 10 px, so the pixel extents must be 518 x 519 including the border.
    w.append("\n".join([
        "GRAPHICS-WINDOW", "355", "10", "873", "529", "-1", "-1", "10.0", "1",
        "14", "1", "1", "1", "0", "1", "1", "1",
        "-25", "25", "-25", "25", "1", "1", "1", "months", "30.0"]))

    def button(x1, y1, x2, y2, label, code, forever):
        return "\n".join([
            "BUTTON", str(x1), str(y1), str(x2), str(y2), label, code,
            "T" if forever else "NIL", "1", "T", "OBSERVER",
            "NIL", "NIL", "NIL", "NIL", "1"])

    w.append(button(10, 10, 90, 50, "setup", "setup", False))
    w.append(button(95, 10, 175, 50, "go", "go", True))
    w.append(button(180, 10, 285, 50, "go 100 yr", "repeat 1200 [ go ]", False))

    y = 58
    for name, lo, inc, hi, val, units in SLIDERS:
        # an empty units field would emit a blank line and split the widget
        units = units or "NIL"
        w.append("\n".join([
            "SLIDER", "10", str(y), "345", str(y + 33), name, name,
            num(lo), num(hi), num(val), num(inc), "1", units, "HORIZONTAL"]))
        y += 36

    mx, my = 895, 10
    for label, rep in MONITORS:
        w.append("\n".join([
            "MONITOR", str(mx), str(my), str(mx + 175), str(my + 47),
            label, rep, "3", "1", "11"]))
        my += 50

    px, py = 365, 540
    for i, (pname, xlab, ylab, pens) in enumerate(PLOTS):
        x0 = px + (i % 2) * 270
        y0 = py + (i // 2) * 180
        pen_block = "\n".join(
            f'"{pn}" 1.0 0 {pc} true "" "{cmd}"' for pn, pc, cmd in pens)
        w.append("\n".join([
            "PLOT", str(x0), str(y0), str(x0 + 260), str(y0 + 170),
            pname, xlab, ylab, "0.0", "10.0", "0.0", "10.0",
            "true", "true", '"" ""', "PENS", pen_block]))
    return "\n\n".join(w)


INFO = r'''## WHAT IS IT?

This is one of a pair of agent-based models asking a question about human
evolution: **would a monogamous or a polygynous society have fared better?**

The companion model is `{OTHER}.nlogo`. The two are generated from a single
shared code body and are identical in every parameter, equation and random
process. They differ in exactly one rule: whether a man who is already married
may marry again. Mortality, energetics, food, foraging, fertility and
inheritance are the same in both. Any difference in results is therefore caused
by the mating system alone.

"Better" is not one question, and the models deliberately measure several
answers at once. They do not all point the same way.

## HOW IT WORKS

One tick is one month. One patch is one square kilometre. All energy is in
kilocalories.

**The land.** Each patch carries a stock of harvestable food that regrows
logistically, cycles with the seasons, and collapses during droughts. This
stock is only the fraction of net primary production that people can actually
eat and reach -- a tiny share of what the landscape grows.

**Foraging.** Food acquisition rises through childhood, peaks in the thirties
and declines with age, scaled by a heritable efficiency trait. Intake follows a
Holling type-II response on the food standing within foraging range, so returns
fall as a neighbourhood is drawn down. Camps relocate when a reachable
neighbourhood offers better returns (Charnov's marginal value theorem) and they
split and merge to stay within the ethnographic size range of about 10-50
people.

**Provisioning.** A married man meets his own needs first and divides what is
left equally among his wives' sub-households. In the monogamy model that
divisor is always one. Under polygyny it is the number of co-wives, so each
wife and her children get a smaller share of the same man. That dilution is not
imposed as a penalty; it falls out of the arithmetic of one man's production
divided more ways. A fixed share of every household's surplus is then shared
band-wide, as food sharing is in every forager society on record, and this
applies identically in both models so neither is advantaged by the assumption.

**Death.** Mortality follows a Siler competing-hazards curve: a steep juvenile
hazard that decays with age, a constant background of accident, violence and
epidemic, and a Gompertz senescent term. Hazard is multiplied up once body
reserves are seriously drawn down -- not at the first missed meal, which is not
how starvation works. Unmarried men of prime age carry a risk premium standing
for the male-male competition that reproductive skew generates; set
`bachelor-risk` to 1 to switch it off.

**Birth.** Natural fertility: adolescent subfecundity, a fecundability decline
after the late thirties, gestation, and lactational amenorrhoea that lengthens
when the mother is thin. A mother pays for her infant's milk out of her own
energy budget, which is what makes closely spaced births costly.

**Marriage.** Women rank the men in their marriage network by the provisioning
they would actually receive: the man's expected production divided among his
existing wives plus one. This is Orians' polygyny threshold. Marriage costs
bridewealth that must be accumulated first, in **both** models.

**Inheritance.** Each person carries a maternally inherited marker and a
paternally inherited one, standing in for mitochondrial DNA and the Y
chromosome, plus a heritable foraging-efficiency trait that mutates slightly
each generation.

## HOW IT IS CALIBRATED

The demographic core reproduces published forager vital rates rather than
asserting them. With the default settings the life table gives an infant
mortality of 0.24, survival to age 15 of 0.56, life expectancy at birth of
about 30 years and a modal adult age at death of about 70 -- all inside the
hunter-gatherer ranges reported by Gurven and Kaplan. Adult energy requirements
are the doubly-labelled-water measurements for the Hadza. Peak male food
production is the figure measured for Ache men. Together the food and
production settings settle the population at roughly 0.17 people per square
kilometre, within the observed forager range (!Kung 0.16, Ache 0.2, Hadza
0.25).

## THINGS TO NOTICE

Watch **Genetic diversity**. Maternal lineages are lost slowly in both models.
Paternal lineages are lost far faster under polygyny, because a few men father
a large share of each generation. The model reproduces from first principles
the pattern read out of real human Y-chromosome data for the period after the
Neolithic.

Watch **Ne / N**. Effective population size falls when breeding concentrates in
few males, so polygyny discards genetic diversity for the same number of
bodies, and drift then overwhelms selection more easily.

Watch **Adaptation** and **Male reproductive skew** together. Skew is not
purely a cost: high variance in male reproductive success means selection on
male traits is intense, so a beneficial trait can spread faster. The real
trade-off the models expose is adaptation speed against diversity retained.

Watch **Unmarried men**. Under polygyny a large pool of men never marries.
Their foraging still feeds the band through sharing, but they leave no
descendants.

## THINGS TO TRY

Set `bachelor-risk` to 1 to remove the male-male competition premium and see
how much of the difference survives without it.

Set `band-sharing` to 0 so households must provision themselves alone. This
should hurt the polygyny model more, because it removes the buffer that
compensates for diluted paternal investment.

Raise `droughts-per-century`. Shocks test which system is more robust, which is
a different question from which is better on average.

Set `max-wives` to 1 in the polygyny model. It should then behave like the
monogamy model -- a useful check that the two really are the same model
underneath.

## EXTENDING THE MODEL

Wealth is not inherited between generations: sons start with nothing. Adding
inheritance would let advantage compound across generations, which is what
makes polygyny self-reinforcing in stratified societies.

There is no polyandry, and no serial monogamy distinct from remarriage after
widowhood. Both are worth adding before drawing general conclusions about
which direction of evolution was better.

## CREDITS AND REFERENCES

Mortality: Siler, W. (1979) A competing-risk model for animal mortality.
*Ecology* 60:750-757. Parameters follow the hunter-gatherer average in Gurven,
M. and Kaplan, H. (2007) Longevity among hunter-gatherers. *Population and
Development Review* 33:321-365.

Energetics: Pontzer, H. et al. (2012) Hunter-gatherer energetics and human
obesity. *PLoS ONE* 7:e40503. Child requirements follow FAO/WHO/UNU (2004).

Production: Kaplan, H., Hill, K., Lancaster, J. and Hurtado, A.M. (2000) A
theory of human life history evolution. *Evolutionary Anthropology* 9:156-185.

Mate choice: Orians, G.H. (1969) On the evolution of mating systems in birds
and mammals. *American Naturalist* 103:589-603; Borgerhoff Mulder, M. (1990)
Kipsigis women's preferences for wealthy men. *Behavioral Ecology and
Sociobiology* 27:255-264.

Co-wife competition: Strassmann, B.I. (1997) Polygyny as a risk factor for
child mortality among the Dogon. *Current Anthropology* 38:688-695.

Patch departure: Charnov, E.L. (1976) Optimal foraging, the marginal value
theorem. *Theoretical Population Biology* 9:129-136.

Y-chromosome bottleneck: Karmin, M. et al. (2015) A recent bottleneck of Y
chromosome diversity. *Genome Research* 25:459-466.
'''

SHAPES = '''circle
false
0
Circle -7500403 true true 0 0 300

default
true
0
Polygon -7500403 true true 150 5 40 250 150 205 260 250

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
Rectangle -7500403 true true 30 30 270 270'''

LINK_SHAPES = '''default
0.0
-0.2 0 0.0 1.0
0.0 1 1.0 0.0
0.2 0 0.0 1.0
link direction
true
0
Line -7500403 true 150 150 90 180
Line -7500403 true 150 150 210 180'''

EXPERIMENTS = '''<experiments>
  <experiment name="mating-system-comparison" repetitions="10" runMetricsEveryStep="false">
    <setup>setup</setup>
    <go>go</go>
    <timeLimit steps="4800"/>
    <metric>population</metric>
    <metric>mean-condition</metric>
    <metric>pct-bachelors</metric>
    <metric>mean-wives-per-married-man</metric>
    <metric>child-mortality-per-1000</metric>
    <metric>mean-male-rs</metric>
    <metric>variance-male-rs</metric>
    <metric>pct-males-childless</metric>
    <metric>effective-population-size</metric>
    <metric>ne-over-n</metric>
    <metric>mt-lineages-left</metric>
    <metric>y-lineages-left</metric>
    <metric>mean-efficiency</metric>
    <enumeratedValueSet variable="initial-population">
      <value value="200"/>
    </enumeratedValueSet>
  </experiment>
  <experiment name="drought-robustness" repetitions="10" runMetricsEveryStep="false">
    <setup>setup</setup>
    <go>go</go>
    <timeLimit steps="4800"/>
    <metric>population</metric>
    <metric>mean-condition</metric>
    <metric>child-mortality-per-1000</metric>
    <steppedValueSet variable="droughts-per-century" first="0" step="4" last="16"/>
  </experiment>
  <experiment name="isolate-bachelor-risk" repetitions="10" runMetricsEveryStep="false">
    <setup>setup</setup>
    <go>go</go>
    <timeLimit steps="4800"/>
    <metric>population</metric>
    <metric>y-lineages-left</metric>
    <metric>ne-over-n</metric>
    <enumeratedValueSet variable="bachelor-risk">
      <value value="1"/>
      <value value="1.35"/>
    </enumeratedValueSet>
  </experiment>
  <experiment name="no-band-sharing" repetitions="10" runMetricsEveryStep="false">
    <setup>setup</setup>
    <go>go</go>
    <timeLimit steps="4800"/>
    <metric>population</metric>
    <metric>child-mortality-per-1000</metric>
    <metric>mean-condition</metric>
    <enumeratedValueSet variable="band-sharing">
      <value value="0"/>
      <value value="0.45"/>
    </enumeratedValueSet>
  </experiment>
</experiments>'''


def build(system):
    other = "polygyny" if system == "monogamy" else "monogamy"

    if system == "monogamy":
        suitor_clause = "and not any? my-marriages"
        field_clause = "and not any? my-marriages"
    else:
        suitor_clause = "and count my-marriages < max-wives"
        field_clause = "and count my-marriages < max-wives"

    code = (CODE
            .replace("{TITLE}", system.upper())
            .replace("{OTHER}", other)
            .replace("{SUITOR_CLAUSE}", suitor_clause)
            .replace("{FIELD_CLAUSE}", field_clause))

    parts = [
        code,
        build_interface(),
        INFO.replace("{OTHER}", other),
        SHAPES,
        "NetLogo 6.4.0",
        "setup\nrepeat 1200 [ go ]",
        "",
        EXPERIMENTS,
        "",
        LINK_SHAPES,
        "1",
    ]
    # A .nlogo file is a run of sections each terminated by a separator line.
    # An EMPTY section contributes no line at all, so two separators end up
    # adjacent; writing a blank line instead shifts every later section and
    # NetLogo then fails to parse the interface.
    out = []
    for part in parts:
        if part:
            out.append(part.rstrip("\n") + "\n")
        out.append("@#$#@#$#@\n")
    return "".join(out)


if __name__ == "__main__":
    for system in ("monogamy", "polygyny"):
        path = HERE / f"{system}.nlogo"
        path.write_text(build(system))
        print(f"wrote {path.name}  ({path.stat().st_size:,} bytes)")
