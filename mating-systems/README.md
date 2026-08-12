# Mating systems and the evolution of a foraging population

Two NetLogo agent-based models of a hunter-gatherer population, identical in
every respect except one: whether a married man may marry again.

| | |
|---|---|
| `monogamy.nlogo` | a man may have one wife at a time |
| `polygyny.nlogo` | a man may have up to `max-wives` |

The question they are built to answer is the obvious one — **which mating
system would have been the better direction for human evolution?** — and the
useful result is that it does not have a single answer. The two systems trade
off against each other along axes that point in opposite directions.

## Running them

Open either `.nlogo` file in NetLogo 6.4 or later, press **setup**, then **go**.
One tick is one month; one patch is one square kilometre; all energy is in
kilocalories. `go 100 yr` runs 1200 ticks without redrawing.

Five BehaviorSpace experiments ship with each model:
`mating-system-comparison`, `drought-robustness`, `isolate-bachelor-risk`,
`wealth-compounding-sweep` and `no-band-sharing`.

## How the two files stay honest

The two models are **generated from a single shared code body** by
`build_models.py`. Everything — the mortality curve, the energetics, the food
dynamics, the foraging rules, the fertility schedule, the inheritance — is
literally the same source text. Only the marriage rule is substituted.

You can check this yourself:

```console
$ diff <(sed -n '1,/^@#\$#@#\$#@$/p' monogamy.nlogo) \
       <(sed -n '1,/^@#\$#@#\$#@$/p' polygyny.nlogo)
```

The only substantive difference the diff reports is `not any? my-marriages`
versus `count my-marriages < max-wives`. That is the whole experiment. Any
divergence in results is caused by the mating system and not by two files
having drifted apart.

To regenerate both models after editing the shared body:

```console
$ python3 build_models.py
```

## What is in the model

**The land.** Every patch carries a stock of harvestable food that regrows
logistically, cycles with the seasons and collapses during droughts. Patch
richness varies smoothly across the map, because some country is simply better
than other country. Note that the stock is only the fraction of net primary
production people can actually eat and reach, which is a tiny share of what a
landscape grows.

**Foraging.** Food acquisition rises through childhood, peaks in the thirties
and declines with age, scaled by a heritable efficiency trait. Intake follows a
Holling type-II response on the food standing within range, so returns fall as
a neighbourhood is drawn down. Camps relocate when a reachable neighbourhood
offers better returns — Charnov's marginal value theorem — and they split and
merge to stay in the ethnographic size range of roughly 10–50 people.

**Provisioning.** A married man meets his own needs first and divides what is
left equally among his wives' sub-households. In monogamy that divisor is
always one; under polygyny it is the number of co-wives. **This dilution is not
an imposed penalty.** It is the arithmetic of one man's production divided more
ways, and it is the mechanism behind the elevated child mortality Strassmann
measured in polygynous Dogon households. A fixed share of every household's
surplus is then shared band-wide, as food sharing is in every forager society on
record, applied identically in both models so neither is advantaged by it.

**Death.** A Siler competing-hazards curve: a steep juvenile hazard decaying
with age, a constant background of accident, violence and epidemic, and a
Gompertz senescent term. Hazard is multiplied up once body reserves are
seriously drawn down — not at the first missed meal, which is not how
starvation works. Unmarried men of prime age carry a risk premium standing for
male-male competition; `bachelor-risk = 1` switches it off.

**Birth.** Natural fertility: adolescent subfecundity, a fecundability decline
after the late thirties, gestation, and lactational amenorrhoea that lengthens
when the mother is thin. A mother pays for her infant's milk out of her own
energy budget, which is what makes closely spaced births costly.

**Marriage.** Bridewealth must be accumulated before a man can marry, in both
models. Women rank suitors by expected provisioning, discounted by existing
wives through `co-wife-penalty` — see the finding about it below.

**Wealth.** Where `wealth-growth` is above zero, accumulated wealth compounds:
herds breed, so a man with a large herd gains more each year than a man with a
small one. This turns out to be the engine of the entire result. Food
acquisition is capped by physical capability, so without compounding every
prime-age man earns about the same, and a society of near-equals produces
almost no polygyny however permissive its marriage rule is.

**Inheritance.** A maternally inherited marker and a paternally inherited one
stand in for mitochondrial DNA and the Y chromosome. Bridewealth passes to
surviving sons; with `primogeniture?` on it goes to the eldest alone, which
concentrates estates rather than diluting them each generation.

## Calibration

Every headline constant is taken from measured forager data rather than chosen
to make the model behave. `validation/demography_check.py` exercises the
life-history core in isolation and checks it against published ranges:

```console
$ cd validation && python3 demography_check.py
```

| Quantity | Model | Published range |
|---|---|---|
| Infant mortality q(0,1) | 0.243 | 0.20–0.30 |
| Survival to age 15 | 0.556 | 0.50–0.62 |
| Life expectancy at birth | 30.4 yr | 21–37 (mean ~31) |
| Further life expectancy at 15 | +37.6 yr | +30 to +45 |
| Modal adult age at death | 70 yr | 62–80 |
| Completed fertility, no mortality | 8.48 | 4.5–8.5 (Ache 8.0) |
| Mean birth interval | 38 months | 30–46 (Ache 37, Hadza 40) |
| Adult male TEE | 2650 kcal/day | Hadza, measured: 2649 |
| Adult female TEE | 1880 kcal/day | Hadza, measured: 1877 |
| Peak male production | 6068 kcal/day | Ache ~6300, Hadza 3500–4500 |
| Population production / requirement | 1.40 | must exceed 1 to pay for juveniles |
| Dependants under 15 | 31.5% | 28–45% |

All 13 checks fall inside their published ranges.

The landscape is then tuned so the population settles at **≈0.17 people per
square kilometre** — inside the observed forager range (!Kung 0.16, Ache 0.20,
Hadza 0.25). Population is genuinely food-regulated: with food unlimited the
same demography grows at about +1.8%/yr, comparable to pre-contact Ache, and it
is the landscape that stops it.

## Results

Measured over 300-year runs, six replicate seeds per system, averaged after a
100-year burn-in. These come from `validation/abm_reference.py`, a Python port
that implements the same rules (see *Honest limitations* below).

| Metric | Monogamy | Polygyny | Change |
|---|---:|---:|---:|
| Mean population | 445 | 369 | −17.0% |
| Minimum population reached | 297 | 253 | −14.7% |
| Mean nutritional condition | 0.88 | 0.87 | −0.6% |
| Under-5 deaths per 1000 births | 425 | 439 | +3.3% |
| **% adult men unmarried** | **40.2%** | **75.5%** | **+88%** |
| Wives per married man | 1.00 | 2.36 | +136% |
| Married men with 2+ wives | 0% | 62% | — |
| Most wives held by one man | 1.0 | 6.3 | +527% |
| Mean lifetime offspring per man | 5.64 | 5.30 | −6.0% |
| **Variance in male offspring** | **8.4** | **82.1** | **+875%** |
| **% men who father no children** | **8.4%** | **53.1%** | **+530%** |
| **Effective population size Ne** | **170** | **83** | **−51.0%** |
| Ne / N | 0.38 | 0.23 | −40.1% |
| Surviving mtDNA lineages | 15.2 | 12.3 | −18.7% |
| **Surviving Y lineages** | **28.7** | **17.5** | **−39.0%** |
| Mean foraging efficiency | 1.000 | 1.012 | +1.2% |

Read across the table, three things stand out.

**Polygyny is no longer demographically free.** At the weak levels of polygyny
an earlier parameterisation produced — 1.3 wives per married man — population
and child mortality were indistinguishable between the two systems, because
band-wide food sharing absorbed the dilution of paternal investment. Push it to
2.4 wives and that buffer is overwhelmed: the population runs 17% smaller and
under-5 mortality is 3% higher. Three quarters of adult men are supporting a
food supply whose reproductive benefit accrues to someone else.

**More than half of all men are evolutionary dead ends.** 53% father no
children, against 8% under monogamy, and the variance in male reproductive
success is nearly ten times higher. This is the same number of people
distributing their ancestry through a far narrower channel.

**That channel shows in the genome, asymmetrically.** Effective population size
halves. Paternal lineages fall 39%, maternal lineages 19% — and the maternal
loss is mostly just the smaller population, whereas the paternal loss is skew
on top of that. Polygyny prunes the Y chromosome roughly twice as hard as the
mitochondria, which is the signature actually observed in human
population-genetic data after the Neolithic.

## Two findings worth pulling out

**1. The adaptation gain does not scale, but the costs do.**
Intense selection on males is polygyny's one advantage in this model: the
heritable foraging trait ends up higher under polygyny, so the population
optimises faster. But that gain is small and it stays small — about 1% — while
the costs grow steeply as polygyny intensifies. Going from 1.3 to 2.4 wives per
married man roughly doubled the Ne penalty (12% to 51%) and turned a neutral
population effect into a 17% shortfall, while the adaptation advantage actually
*shrank* slightly. So the honest answer to which direction was better is that
**mild polygyny is close to a free lunch and strong polygyny is not**. There is
a defensible case for a little skew; there is not much of one for a lot.

**2. Whether polygyny happens at all depends on who controls the marriage.**
The `co-wife-penalty` slider spans two ways marriages actually get made. At 1.0
it is the strict Orians polygyny threshold — a woman weighs a man's resources
divided among his co-wives — and under it the polygyny model goes very nearly
**monogamous even though polygyny is permitted**: with plenty of bachelors
around, almost no woman prefers a half share. Polygyny only takes hold as the
penalty falls towards 0, a bridewealth auction in which the bride's kin take the
highest bidder and her co-wife burden is not their problem. Sweeping it:

| `co-wife-penalty` | wives per married man | married men with 2+ wives | most wives held |
|---|---:|---:|---:|
| 1.00 (strict Orians) | 1.01 | 1% | 1.3 |
| 0.50 | 1.04 | 4% | 1.7 |
| 0.25 | 1.06 | 6% | 2.0 |
| 0.10 | 1.35 | 34% | 2.0 |
| 0.00 (bridewealth auction) | 2.22 | 59% | 6.0 |

Note how sharply non-linear that is: the whole transition happens below 0.25.
The default is 0.0, which reproduces the levels seen in strongly polygynous
societies. The reading is that polygyny is not a consequence of male wealth
alone — even with wealth compounding, female choice under the strict threshold
holds it to 1% of married men. It also needs marriage decisions to sit with
someone other than the bride.

**3. Polygyny needs an economy that lets wealth compound.**
Set `wealth-growth` to 0 and polygyny very nearly disappears even with the
permissive marriage rule and a zero co-wife penalty. Food acquisition is capped
by physical capability, so without compounding every prime-age man earns about
the same, and women have nothing to sort on. Turning it up produces polygyny —
but only up to a point: past about 1%/month every man reaches the wealth
ceiling, inequality collapses (a Gini of 0.02 at 3%/month) and polygyny weakens
again. Polygyny is a phenomenon of *intermediate* inequality, and the model
reaches it only through an economy of breeding herds rather than gathered food.
That is consistent with the ethnographic record, where the strongly polygynous
societies are pastoralists and farmers rather than foragers.

## Honest limitations

**The NetLogo models were not executed.** This environment's network policy
blocks `ccl.northwestern.edu`, so no NetLogo runtime could be installed and
nothing here ran the `.nlogo` files. What was run — extensively — is
`validation/abm_reference.py`, a Python implementation of the same rules with
the same constants, and that is where every number quoted above comes from.

The `.nlogo` files pass `validation/check_nlogo.py`, which checks bracket and
parenthesis balance, that every procedure is closed, that no identifier is used
without being defined by a declaration or a slider, and that slider defaults sit
inside their ranges. It also validates the file *format* against a genuine
NetLogo 6.4 model (`Wolf Sheep Predation.nlogo`, read from NetLogo's own Sample
Models): every widget block must have the exact line count that widget type
occupies, empty sections must be adjacent separator lines rather than blank
lines, slider values must avoid scientific notation, and the view's pixel
extents must match its patch count. A first release of these files failed to
open because two sliders had an empty units field, which writes a blank line
inside the widget block and splits it in two; that class of error is what this
check now catches.

That is real verification, but it is still not execution: it cannot catch a
runtime error or a semantic mistake in the model logic. **Open them in NetLogo
and check the behaviour before relying on results from the `.nlogo` files
themselves.**

Beyond that:

- Wealth is inherited but status and territory are not, so advantage compounds
  less than it does in real stratified societies.
- There is no polyandry, and no serial monogamy distinct from remarriage after
  widowhood.
- The bachelor risk premium is a parameter, not a mechanism: men do not actually
  fight. Set `bachelor-risk` to 1 to see how much of the difference survives
  without it.
- Maternal mortality is modelled explicitly *on top of* the Siler curve, which
  is fitted to all-cause mortality and so already contains maternal deaths. It
  is a small double-count.

## Files

```
monogamy.nlogo              the monogamous model
polygyny.nlogo              the polygynous model
build_models.py             generates both from one shared code body
README.md                   this file
validation/
  demography_check.py       life-history core vs published forager rates
  abm_reference.py          Python port of the model; what was actually run
  check_nlogo.py            static checks on the generated .nlogo files
```

## References

Siler, W. (1979) A competing-risk model for animal mortality. *Ecology*
60:750–757.

Gurven, M. & Kaplan, H. (2007) Longevity among hunter-gatherers.
*Population and Development Review* 33:321–365.

Pontzer, H. et al. (2012) Hunter-gatherer energetics and human obesity.
*PLoS ONE* 7:e40503.

Kaplan, H., Hill, K., Lancaster, J. & Hurtado, A.M. (2000) A theory of human
life history evolution. *Evolutionary Anthropology* 9:156–185.

Orians, G.H. (1969) On the evolution of mating systems in birds and mammals.
*American Naturalist* 103:589–603.

Borgerhoff Mulder, M. (1990) Kipsigis women's preferences for wealthy men.
*Behavioral Ecology and Sociobiology* 27:255–264.

Strassmann, B.I. (1997) Polygyny as a risk factor for child mortality among the
Dogon. *Current Anthropology* 38:688–695.

Charnov, E.L. (1976) Optimal foraging, the marginal value theorem.
*Theoretical Population Biology* 9:129–136.

Karmin, M. et al. (2015) A recent bottleneck of Y chromosome diversity.
*Genome Research* 25:459–466.
