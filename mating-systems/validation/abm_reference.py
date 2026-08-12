"""
Reference implementation of the mating-system agent-based model.

This is a line-for-line Python port of the rules implemented in
  ../monogamy.nlogo   (MATING-SYSTEM = "monogamy")
  ../polygyny.nlogo   (MATING-SYSTEM = "polygyny")

It exists so the model can be executed, tuned and replicated in environments
without a NetLogo install, and so the numbers quoted in ../README.md are
measured rather than asserted. Every constant here also appears, with the same
name and value, in the two .nlogo files.

Usage:
    python3 abm_reference.py --years 500 --reps 8
    python3 abm_reference.py --years 200 --reps 2 --quick
"""

from __future__ import annotations

import argparse
import math
import random
from dataclasses import dataclass, field

import numpy as np

# =====================================================================
# CONSTANTS  (identical in both .nlogo models)
# =====================================================================

MONTHS_PER_YEAR = 12
DAYS_PER_MONTH = 30.44

# --- Mortality: Siler (1979) competing-hazards model -----------------
# Functional form and the juvenile/constant components follow the
# hunter-gatherer average of Gurven & Kaplan (2007) Pop.Dev.Rev. 33:321-365.
# The senescent pair (A3, B3) was fitted here so the model reproduces their
# published summary statistics simultaneously; see demography_check.py.
SILER_A1 = 0.422    # juvenile hazard intercept  (per year)
SILER_B1 = 1.131    # juvenile hazard decay rate
SILER_A2 = 0.013    # age-independent hazard (accident, violence, epidemic)
SILER_A3 = 4.32e-5  # senescent (Gompertz) intercept
SILER_B3 = 0.1075   # senescent rate of increase

# --- Energetics ------------------------------------------------------
# Total energy expenditure, kcal/day, by age. Adult values are the
# doubly-labelled-water measurements for Hadza foragers, Pontzer et al. (2012)
# PLoS ONE 7:e40503 (men 2649, women 1877 kcal/day); child values follow the
# FAO/WHO/UNU (2004) energy requirement schedules.
TEE_MALE = [(1, 550), (2, 900), (6, 1400), (10, 1800),
            (14, 2250), (18, 2500), (999, 2650)]
TEE_FEMALE = [(1, 550), (2, 900), (6, 1350), (10, 1750),
              (14, 2050), (18, 2050), (999, 1880)]

# Breast milk covers all of an infant's needs to 6 months and tapers to weaning
# at 24 months; the energy is charged to the mother, uplifted for the metabolic
# cost of milk synthesis. This reproduces the WHO +500 kcal/day lactation
# surcharge without hard-coding it.
MILK_SYNTHESIS_COST = 1.05
PREGNANCY_SURCHARGE = 300        # kcal/day over the last two trimesters

# Peak food acquisition, kcal/day, at the top of the age curve.
# Kaplan, Hill, Lancaster & Hurtado (2000) Evol.Anthropol. 9:156-185 report
# peak male production of ~6300 kcal/day (Ache); Hadza women's tuber and berry
# return rates support the female figure. Together with PATCH_K these settle the
# population at ~0.17 people/km2, within the observed forager range (!Kung 0.16,
# Ache 0.2, Hadza 0.25). See the calibration section of README.md.
PEAK_PRODUCTION_MALE = 6300
PEAK_PRODUCTION_FEMALE = 3500
PROD_RISE_MID, PROD_RISE_K = 13.5, 3.0    # logistic rise to adult competence
PROD_FALL_MID, PROD_FALL_K = 58.0, 7.0    # senescent decline
CHILDCARE_PRODUCTION_COST = 0.65          # multiplier while pregnant or nursing

# Body energy reserve. ~10 kg of fat on a lean adult is ~90 000 kcal; expressed
# here as days of maintenance so it scales with body size / age.
RESERVE_DAYS = 55
# Mortality does not rise at the first missed meal: a forager carrying normal
# fat reserves is not at risk. Excess hazard begins only once the reserve is
# drawn down past STARVATION_ONSET, then climbs steeply.
STARVATION_ONSET = 0.60        # fraction of the reserve below which risk begins
STARVATION_HAZARD_BETA = 12.0  # hazard multiplier at total reserve depletion
CHILD_STARVATION_EXTRA = 1.8   # under-5s suffer the undernutrition-infection synergy

# --- Fertility -------------------------------------------------------
MENARCHE_AGE = 15.0
MENOPAUSE_AGE = 45.0
ADOLESCENT_SUBFECUNDITY_YEARS = 4.0
PEAK_FECUNDABILITY = 0.20      # monthly conception probability, well nourished
FECUND_DECLINE_MID, FECUND_DECLINE_K = 38.0, 3.0
GESTATION_MONTHS = 9
LACTATIONAL_AMENORRHEA_MONTHS = 18
STILLBIRTH_RATE = 0.05         # pregnancy loss / stillbirth, pre-modern
MATERNAL_MORTALITY = 0.012     # per birth, pre-modern range 0.005-0.025

# --- Landscape -------------------------------------------------------
# One patch = 1 km^2. K is *harvestable* standing stock: only the fraction of net
# primary production that people can actually eat and reach, which is a tiny
# share of what the landscape grows.
WORLD_SIZE = 51
PATCH_K = 400_000.0            # kcal/km2 carrying capacity
PATCH_R = 0.24                 # intrinsic monthly regrowth rate
PATCH_SEED_FLOOR = 0.02        # fraction of K that never disappears
SEASONAL_AMPLITUDE = 0.40      # +/- fraction on monthly regrowth
FORAGE_RADIUS = 2              # patches reachable from camp (Chebyshev)
# Intake follows a Holling type-II response on the standing stock within range.
# The half-saturation constant is set as a fraction of a pristine neighbourhood
# so the response is independent of how rich the landscape is made.
HALF_SATURATION_FRACTION = 0.15
MOVE_RADIUS = 8
# Foragers live in residential camps that relocate when the surrounding patch
# is drawn down. Camp sizes follow the ethnographic range (~10-50 people).
CAMP_TARGET = 30
CAMP_MAX = 50
CAMP_MIN = 7
# Camps relocate by Charnov's (1976) marginal value theorem: leave the current
# patch once a reachable one offers materially better returns. Being a ratio,
# this rule does not have to be retuned when the landscape is made richer.
CAMP_MOVE_GAIN = 1.15
DROUGHT_PER_CENTURY = 6.0      # expected severe droughts per 100 years
DROUGHT_K_MULT = 0.45
DROUGHT_MIN_MONTHS, DROUGHT_MAX_MONTHS = 6, 24

# --- Social ----------------------------------------------------------
MALE_MARRIAGE_AGE = 18.0
FEMALE_MARRIAGE_AGE = 16.0
BRIDE_PRICE = 250_000.0         # kcal-equivalent of exchangeable surplus
MAX_WEALTH_DAYS = 20000         # ceiling on storable / exchangeable surplus
WEALTH_DECAY = 0.005           # monthly loss: food spoils, obligations are called
# Herds breed. Where wealth is livestock rather than stored food it compounds,
# so a man with a large herd gains more each year than a man with a small one.
# That multiplicative growth is what turns a roughly equal society into a very
# unequal one, and it is why the strongly polygynous societies on record are
# pastoralists and farmers rather than foragers: you cannot accumulate a herd
# of wild tubers. Set to 0 for a pure forager economy.
WEALTH_GROWTH = 0.01           # monthly compounding rate on held wealth
REMARRIAGE_DELAY_MONTHS = 12
MAX_WIVES = 12
# How strongly an existing wife devalues a suitor in the marriage market.
# 1.0 is the strict Orians polygyny threshold, in which a woman weighs a man's
# resources divided equally among his co-wives and so almost never accepts a
# married man. 0.0 is a pure bridewealth auction, in which the bride's kin
# accept the highest bidder and existing wives are irrelevant. Real polygynous
# societies sit in between, because bridewealth is paid to the bride's kin.
CO_WIFE_PENALTY = 0.0
# Forager marriage networks are regional, routinely spanning tens of kilometres
# and many camps, so mate search is not confined to the local band.
MATE_SEARCH_RADIUS = 20
BAND_SHARING = 0.45            # fraction of surplus shared beyond the household
# Orians' polygyny threshold only bites when males differ in the resources they
# control, so the landscape is heterogeneous and wealth passes to sons. Both
# apply identically in the two models; they are what makes polygyny possible
# rather than what makes it costly.
LANDSCAPE_HETEROGENEITY = 0.75  # sd of the multiplicative richness field
WEALTH_INHERITANCE = 0.7        # share of a man's wealth passing to his sons
# Splitting an estate between all sons dilutes it every generation and keeps
# wealth flat. Primogeniture concentrates it instead, which is exactly how
# strongly polygynous societies sustain a class of men rich enough to marry
# many wives.
PRIMOGENITURE = True
BACHELOR_RISK = 1.35           # hazard multiplier on SILER_A2 for unmarried
BACHELOR_RISK_AGE = (18.0, 40.0)   # males within this age band

# --- Genetics --------------------------------------------------------
MUTATION_SD = 0.02
EFFICIENCY_MIN, EFFICIENCY_MAX = 0.50, 2.00

INITIAL_POPULATION = 200
BURN_IN_YEARS = 100


# =====================================================================
# helper curves
# =====================================================================

def siler_hazard(age_years: float) -> float:
    return (SILER_A1 * math.exp(-SILER_B1 * age_years)
            + SILER_A2
            + SILER_A3 * math.exp(SILER_B3 * age_years))


def _table_lookup(table, age_years: float) -> float:
    for cut, val in table:
        if age_years < cut:
            return val
    return table[-1][1]


def maintenance_kcal_day(age_years: float, male: bool) -> float:
    """Total energy expenditure: what the body burns, whatever the source."""
    return _table_lookup(TEE_MALE if male else TEE_FEMALE, age_years)


def milk_fraction(age_months: float) -> float:
    """Share of a child's energy supplied by breast milk rather than by food."""
    if age_months < 6:
        return 1.0
    if age_months < 12:
        return 0.6
    if age_months < 24:
        return 0.3
    return 0.0


def production_capability(age_years: float, male: bool, efficiency: float) -> float:
    """Peak-scaled food acquisition capability, kcal/day."""
    rise = 1.0 / (1.0 + math.exp(-(age_years - PROD_RISE_MID) / PROD_RISE_K))
    fall = 1.0 / (1.0 + math.exp((age_years - PROD_FALL_MID) / PROD_FALL_K))
    peak = PEAK_PRODUCTION_MALE if male else PEAK_PRODUCTION_FEMALE
    return peak * rise * fall * efficiency


def fecundability(age_years: float) -> float:
    if age_years < MENARCHE_AGE or age_years >= MENOPAUSE_AGE:
        return 0.0
    ramp = min(1.0, (age_years - MENARCHE_AGE) / ADOLESCENT_SUBFECUNDITY_YEARS)
    decline = 1.0 / (1.0 + math.exp((age_years - FECUND_DECLINE_MID) / FECUND_DECLINE_K))
    return PEAK_FECUNDABILITY * ramp * decline


# =====================================================================
# agents
# =====================================================================

@dataclass
class Person:
    uid: int
    male: bool
    age_m: float
    x: int
    y: int
    efficiency: float
    mt_lineage: int          # maternally inherited marker
    y_lineage: int           # paternally inherited marker (males only)
    energy: float = 0.0
    wealth: float = 0.0
    husband: "Person | None" = None      # set on a wife
    mother: "Person | None" = None
    father: "Person | None" = None
    pregnant_m: int = 0
    amenorrhea_m: int = 0
    widowed_m: int = 999
    n_offspring: int = 0
    alive: bool = True
    last_intake_ratio: float = 1.0
    camp: int = 0

    @property
    def age(self) -> float:
        return self.age_m / MONTHS_PER_YEAR

    @property
    def reserve_cap(self) -> float:
        return max(1.0, maintenance_kcal_day(self.age, self.male)) * RESERVE_DAYS

    @property
    def dependent(self) -> bool:
        return self.age < 15.0

    def need_kcal_month(self) -> float:
        """Energy that must come from *food* (milk is charged to the mother)."""
        base = maintenance_kcal_day(self.age, self.male)
        base *= 1.0 - milk_fraction(self.age_m)
        if not self.male and self.pregnant_m > 3:
            base += PREGNANCY_SURCHARGE
        return base * DAYS_PER_MONTH


# =====================================================================
# the model
# =====================================================================

class World:
    def __init__(self, mating_system: str, seed: int,
                 bachelor_risk: float = BACHELOR_RISK,
                 band_sharing: float = BAND_SHARING):
        assert mating_system in ("monogamy", "polygyny")
        self.system = mating_system
        self.rng = random.Random(seed)
        self.nprng = np.random.default_rng(seed)
        self.bachelor_risk = bachelor_risk
        self.band_sharing = band_sharing

        self.tick = 0
        self.next_uid = 0
        cells = (2 * FORAGE_RADIUS + 1) ** 2
        self.half_saturation = HALF_SATURATION_FRACTION * cells * PATCH_K
        self.patch_k = self._richness_field() * PATCH_K
        self.food = self.patch_k * 0.85
        self.drought_left = 0
        self.people: list[Person] = []

        # neighbourhood box kernel used for the foraging functional response
        k = 2 * FORAGE_RADIUS + 1
        self.kernel = np.ones((k, k))

        self._seed_population()

        # recorders
        self.hist = []
        self._deaths_u5 = 0
        self._births_window = 0
        self._u5_exposure = 0

    def _richness_field(self) -> np.ndarray:
        """A smooth multiplicative field: some country is simply better."""
        f = self.nprng.normal(0, 1, (WORLD_SIZE, WORLD_SIZE))
        for _ in range(6):                       # blur into broad patches
            f = (f
                 + np.roll(f, 1, 0) + np.roll(f, -1, 0)
                 + np.roll(f, 1, 1) + np.roll(f, -1, 1)) / 5.0
        f = (f - f.mean()) / (f.std() + 1e-9)
        field = np.exp(LANDSCAPE_HETEROGENEITY * f)
        return field / field.mean()

    # ---------------------------------------------------------------- setup
    def _new_uid(self) -> int:
        self.next_uid += 1
        return self.next_uid

    _SURV_TABLE: list[float] = []

    @classmethod
    def _survivorship(cls) -> list[float]:
        """l(x) at yearly ages 0..89, cached."""
        if not cls._SURV_TABLE:
            table, H = [], 0.0
            for yr in range(90):
                table.append(math.exp(-H))
                for m in range(MONTHS_PER_YEAR):
                    H += siler_hazard(yr + m / 12) / MONTHS_PER_YEAR
            cls._SURV_TABLE = table
        return cls._SURV_TABLE

    def _stationary_age(self) -> float:
        """Draw an age from the Siler stationary age distribution."""
        table = self._survivorship()
        total = sum(table)
        r = self.rng.random() * total
        acc = 0.0
        for yr, l in enumerate(table):
            acc += l
            if acc >= r:
                return yr + self.rng.random()
        return 0.0

    def _seed_population(self):
        n_camps = max(1, INITIAL_POPULATION // CAMP_TARGET)
        self.camps = {c: (self.rng.randrange(WORLD_SIZE),
                          self.rng.randrange(WORLD_SIZE))
                      for c in range(n_camps)}
        self.next_camp = n_camps
        for i in range(INITIAL_POPULATION):
            male = self.rng.random() < 0.5
            age = self._stationary_age()
            c = i % n_camps
            cx, cy = self.camps[c]
            p = Person(
                uid=self._new_uid(), male=male, age_m=age * MONTHS_PER_YEAR,
                x=cx, y=cy, efficiency=1.0,
                mt_lineage=i, y_lineage=i, camp=c,
            )
            p.energy = p.reserve_cap * 0.8
            self.people.append(p)

    # ---------------------------------------------------------------- step
    def step(self):
        self.tick += 1
        self._grow_food()
        self._forage_and_provision()
        self._move()
        self._reproduce()
        self._marry()
        self._mortality()
        self._age()

    # -- landscape ---------------------------------------------------
    def _grow_food(self):
        month = self.tick % MONTHS_PER_YEAR
        season = 1.0 + SEASONAL_AMPLITUDE * math.sin(2 * math.pi * month / MONTHS_PER_YEAR)

        if self.drought_left > 0:
            self.drought_left -= 1
        elif self.rng.random() < DROUGHT_PER_CENTURY / (100 * MONTHS_PER_YEAR):
            self.drought_left = self.rng.randint(DROUGHT_MIN_MONTHS, DROUGHT_MAX_MONTHS)

        k = self.patch_k * (DROUGHT_K_MULT if self.drought_left > 0 else 1.0)
        r = PATCH_R * season
        f = self.food
        f += r * f * (1.0 - f / k)
        np.clip(f, PATCH_SEED_FLOOR * self.patch_k, self.patch_k, out=self.food)

    def _neighbourhood_stock(self) -> np.ndarray:
        """Sum of food within FORAGE_RADIUS of every cell (wrapped world)."""
        f = self.food
        pad = FORAGE_RADIUS
        wrapped = np.pad(f, pad, mode="wrap")
        out = np.zeros_like(f)
        n = 2 * pad + 1
        for dy in range(n):
            for dx in range(n):
                out += wrapped[dy:dy + WORLD_SIZE, dx:dx + WORLD_SIZE]
        return out

    # -- households --------------------------------------------------
    def _households(self) -> list[list[Person]]:
        """
        A household is a provisioning unit.
          monogamy : husband + wife + their dependent children
          polygyny : each wife + her dependent children form a sub-household
                     that receives 1/n of the husband's production
        Unmarried adults (and orphans) form their own household.
        """
        kids_of: dict[int, list[Person]] = {}
        for p in self.people:
            if p.dependent and p.mother is not None and p.mother.alive:
                kids_of.setdefault(p.mother.uid, []).append(p)

        wives_of: dict[int, list[Person]] = {}
        for p in self.people:
            if not p.male and p.husband is not None and p.husband.alive:
                wives_of.setdefault(p.husband.uid, []).append(p)

        households = []
        assigned = set()
        for man in self.people:
            if not man.male:
                continue
            wives = wives_of.get(man.uid, [])
            if not wives:
                continue
            share = 1.0 / len(wives)
            for w in wives:
                members = [w] + kids_of.get(w.uid, [])
                households.append((members, man, share))
                assigned.add(w.uid)
                assigned.update(k.uid for k in kids_of.get(w.uid, []))
            assigned.add(man.uid)
        # everyone not in a conjugal household
        for p in self.people:
            if p.uid in assigned:
                continue
            if p.dependent and p.mother is not None and p.mother.alive:
                continue  # already counted with the mother
            members = [p] + (kids_of.get(p.uid, []) if not p.male else [])
            households.append((members, None, 0.0))
            assigned.add(p.uid)
            assigned.update(k.uid for k in kids_of.get(p.uid, []))
        return households

    # -- production and consumption ----------------------------------
    def _forage_and_provision(self):
        stock = self._neighbourhood_stock()

        # 1. every non-infant forages, subject to a Holling type-II response
        harvest: dict[int, float] = {}
        demand = np.zeros_like(self.food)
        for p in self.people:
            cap = production_capability(p.age, p.male, p.efficiency)
            if not p.male and (p.pregnant_m > 0 or p.amenorrhea_m > 0):
                cap *= CHILDCARE_PRODUCTION_COST
            if cap <= 0:
                harvest[p.uid] = 0.0
                continue
            avail = stock[p.x, p.y]
            take = cap * DAYS_PER_MONTH * avail / (avail + self.half_saturation)
            harvest[p.uid] = take
            demand[p.x, p.y] += take

        # deplete the landscape: each patch loses its share of every
        # neighbourhood harvest that overlaps it
        with np.errstate(divide="ignore", invalid="ignore"):
            spread = np.where(stock > 0, demand / stock, 0.0)
        pad = FORAGE_RADIUS
        wrapped = np.pad(spread, pad, mode="wrap")
        loss = np.zeros_like(self.food)
        n = 2 * pad + 1
        for dy in range(n):
            for dx in range(n):
                loss += wrapped[dy:dy + WORLD_SIZE, dx:dx + WORLD_SIZE]
        self.food -= loss * self.food
        np.clip(self.food, PATCH_SEED_FLOOR * self.patch_k, self.patch_k, out=self.food)

        # 2. work out each person's requirement, including reproductive costs
        # a nursing mother is charged for the milk her youngest child drinks
        milk_cost: dict[int, float] = {}
        for c in self.people:
            if c.age_m < 24 and c.mother is not None and c.mother.alive:
                cost = (maintenance_kcal_day(c.age, c.male)
                        * milk_fraction(c.age_m) * MILK_SYNTHESIS_COST)
                milk_cost[c.mother.uid] = max(milk_cost.get(c.mother.uid, 0.0), cost)

        def requirement(m: Person) -> float:
            need = m.need_kcal_month()
            if not m.male and m.uid in milk_cost:
                need += milk_cost[m.uid] * DAYS_PER_MONTH
            return need

        # 3. a married man meets his own requirement first, then splits what is
        #    left equally across his wives' sub-households. This is the single
        #    structural difference between the two models: in monogamy the
        #    divisor is always 1, under polygyny it is the number of co-wives.
        households = self._households()
        pooled, needed = [], []
        husband_residual: dict[int, float] = {}
        for members, husband, share in households:
            if husband is None or husband.uid in husband_residual:
                continue
            h_prod = harvest.get(husband.uid, 0.0)
            h_need = requirement(husband)
            if h_prod >= h_need:
                surplus = h_prod - h_need
                top_up = min(husband.reserve_cap - husband.energy, surplus)
                husband.energy += top_up
                surplus -= top_up
                husband.last_intake_ratio = 1.0
                husband_residual[husband.uid] = surplus
            else:
                drawn = min(husband.energy, h_need - h_prod)
                husband.energy -= drawn
                husband.last_intake_ratio = (h_prod + drawn) / h_need if h_need else 1.0
                husband_residual[husband.uid] = 0.0
        for members, husband, share in households:
            pool = sum(harvest.get(m.uid, 0.0) for m in members)
            if husband is not None:
                pool += husband_residual[husband.uid] * share
            pooled.append(pool)
            needed.append(sum(requirement(m) for m in members))

        # 4. band-level sharing of surplus. Wide food sharing is documented in
        #    every forager society studied; it is applied identically in both
        #    models so neither is advantaged by the assumption.
        surplus_pool = 0.0
        for i in range(len(households)):
            excess = pooled[i] - needed[i]
            if excess > 0:
                give = excess * self.band_sharing
                pooled[i] -= give
                surplus_pool += give
        deficits = [max(0.0, needed[i] - pooled[i]) for i in range(len(households))]
        total_deficit = sum(deficits)
        if total_deficit > 0 and surplus_pool > 0:
            frac = min(1.0, surplus_pool / total_deficit)
            for i in range(len(households)):
                pooled[i] += deficits[i] * frac
            surplus_pool = max(0.0, surplus_pool - total_deficit * frac)
        if surplus_pool > 0:            # anything unclaimed returns to producers
            per = surplus_pool / len(households)
            for i in range(len(households)):
                pooled[i] += per

        # 5. allocate inside the household; dependent children are served first
        for i, (members, husband, share) in enumerate(households):
            avail = pooled[i]
            ranked = sorted(members, key=lambda m: (0 if m.age < 15 else 1, m.age))
            for m in ranked:
                need = requirement(m)
                got = min(need, max(0.0, avail))
                avail -= got
                shortfall = need - got
                if shortfall > 0:                    # draw down body reserves
                    drawn = min(m.energy, shortfall)
                    m.energy -= drawn
                    got += drawn
                m.last_intake_ratio = got / need if need > 0 else 1.0
            if avail > 0:            # rebuild body reserves, children first
                for m in ranked:
                    add = min(m.reserve_cap - m.energy, avail)
                    if add > 0:
                        m.energy += add
                        avail -= add
                    if avail <= 0:
                        break
            if avail > 0:                            # bank exchangeable surplus
                holder = husband if husband is not None else members[0]
                cap = maintenance_kcal_day(holder.age, holder.male) * MAX_WEALTH_DAYS
                holder.wealth = min(cap, holder.wealth + avail)


    # -- residential mobility ----------------------------------------
    def _move(self):
        """
        Camps, not individuals, are the mobile unit. A camp relocates when the
        standing stock within foraging range falls below a few months of the
        band's requirement -- the residential mobility that defines the forager
        adaptation. Camps split when they outgrow the local resource base and
        merge when they fall below a viable size.
        """
        stock = self._neighbourhood_stock()

        members: dict[int, list[Person]] = {}
        for p in self.people:
            members.setdefault(p.camp, []).append(p)

        # --- fission / fusion
        for cid, group in list(members.items()):
            if len(group) > CAMP_MAX:
                new = self.next_camp
                self.next_camp += 1
                cx, cy = self.camps[cid]
                self.camps[new] = ((cx + self.rng.randint(3, 6)) % WORLD_SIZE,
                                   (cy + self.rng.randint(-6, 6)) % WORLD_SIZE)
                # split by household so families stay together
                movers = sorted(group, key=lambda p: p.uid)[len(group) // 2:]
                for p in movers:
                    p.camp = new
        members = {}
        for p in self.people:
            members.setdefault(p.camp, []).append(p)
        for cid, group in list(members.items()):
            if len(group) < CAMP_MIN and len(members) > 1:
                cx, cy = self.camps[cid]
                best, bd = None, 1e9
                for other, og in members.items():
                    if (other == cid or other not in self.camps
                            or len(og) + len(group) > CAMP_MAX):
                        continue
                    ox, oy = self.camps[other]
                    dx = min(abs(ox - cx), WORLD_SIZE - abs(ox - cx))
                    dy = min(abs(oy - cy), WORLD_SIZE - abs(oy - cy))
                    d = max(dx, dy)
                    if d < bd:
                        best, bd = other, d
                if best is not None and bd <= 12:
                    for p in group:
                        p.camp = best
                    self.camps.pop(cid, None)

        # --- relocation
        members = {}
        for p in self.people:
            members.setdefault(p.camp, []).append(p)
        for cid, group in members.items():
            if cid not in self.camps:
                self.camps[cid] = (group[0].x, group[0].y)
            cx, cy = self.camps[cid]
            best, bx, by = stock[cx, cy] * CAMP_MOVE_GAIN, cx, cy
            for _ in range(20):
                nx = (cx + self.rng.randint(-MOVE_RADIUS, MOVE_RADIUS)) % WORLD_SIZE
                ny = (cy + self.rng.randint(-MOVE_RADIUS, MOVE_RADIUS)) % WORLD_SIZE
                if stock[nx, ny] > best:
                    best, bx, by = stock[nx, ny], nx, ny
            self.camps[cid] = (bx, by)

        for p in self.people:
            p.x, p.y = self.camps[p.camp]

    # -- reproduction ------------------------------------------------
    def _reproduce(self):
        newborns = []
        for w in list(self.people):
            if w.male or not w.alive:
                continue
            if w.pregnant_m > 0:
                w.pregnant_m += 1
                if w.pregnant_m > GESTATION_MONTHS:
                    w.pregnant_m = 0
                    if self.rng.random() < STILLBIRTH_RATE:
                        w.amenorrhea_m = 3
                        continue
                    if self.rng.random() < MATERNAL_MORTALITY:
                        w.alive = False
                    father = w.husband if (w.husband and w.husband.alive) else None
                    male = self.rng.random() < 0.515   # human secondary sex ratio
                    eff_parent = ((w.efficiency + father.efficiency) / 2
                                  if father else w.efficiency)
                    child = Person(
                        uid=self._new_uid(), male=male, age_m=0.0,
                        x=w.x, y=w.y,
                        efficiency=min(EFFICIENCY_MAX, max(
                            EFFICIENCY_MIN,
                            eff_parent + self.nprng.normal(0, MUTATION_SD))),
                        mt_lineage=w.mt_lineage,
                        y_lineage=(father.y_lineage if father else -1),
                        mother=w, father=father, camp=w.camp,
                    )
                    child.energy = child.reserve_cap * 0.6
                    newborns.append(child)
                    w.amenorrhea_m = 1
                    w.n_offspring += 1
                    if father:
                        father.n_offspring += 1
                    self._births_window += 1
                continue

            if w.amenorrhea_m > 0:
                # lactational amenorrhea, prolonged when the mother is thin
                condition = min(1.0, w.energy / w.reserve_cap)
                extra = 1.0 + 0.8 * (1.0 - condition)
                w.amenorrhea_m += 1
                if w.amenorrhea_m > LACTATIONAL_AMENORRHEA_MONTHS * extra:
                    w.amenorrhea_m = 0
                continue

            if w.husband is None or not w.husband.alive:
                continue
            p = fecundability(w.age)
            if p <= 0:
                continue
            # Ellison's nutrition-fertility link: conception falls with condition
            condition = min(1.0, w.energy / w.reserve_cap)
            p *= max(0.0, min(1.0, (condition - 0.30) / 0.35))
            if self.rng.random() < p:
                w.pregnant_m = 1
        self.people.extend(newborns)

    # -- marriage ----------------------------------------------------
    def _marry(self):
        wives_count: dict[int, int] = {}
        for p in self.people:
            if not p.male and p.husband is not None and p.husband.alive:
                wives_count[p.husband.uid] = wives_count.get(p.husband.uid, 0) + 1

        candidates = [m for m in self.people
                      if m.male and m.alive and m.age >= MALE_MARRIAGE_AGE
                      and m.wealth >= BRIDE_PRICE]
        if self.system == "monogamy":
            candidates = [m for m in candidates if wives_count.get(m.uid, 0) == 0]
        else:
            candidates = [m for m in candidates
                          if wives_count.get(m.uid, 0) < MAX_WIVES]
        if not candidates:
            return

        brides = [w for w in self.people
                  if not w.male and w.alive and w.age >= FEMALE_MARRIAGE_AGE
                  and w.age < MENOPAUSE_AGE
                  and (w.husband is None or not w.husband.alive)
                  and w.widowed_m >= REMARRIAGE_DELAY_MONTHS]
        self.rng.shuffle(brides)

        for w in brides:
            best, best_val = None, 0.0
            for m in candidates:
                if wives_count.get(m.uid, 0) >= (1 if self.system == "monogamy"
                                                 else MAX_WIVES):
                    continue
                dx = min(abs(m.x - w.x), WORLD_SIZE - abs(m.x - w.x))
                dy = min(abs(m.y - w.y), WORLD_SIZE - abs(m.y - w.y))
                if max(dx, dy) > MATE_SEARCH_RADIUS:
                    continue
                # Orians (1969) polygyny threshold: a female ranks males by the
                # provisioning she would receive, i.e. divided among co-wives.
                prod = production_capability(m.age, True, m.efficiency)
                val = ((prod + m.wealth / 365.0)
                       / (1.0 + CO_WIFE_PENALTY * wives_count.get(m.uid, 0)))
                val *= self.rng.uniform(0.85, 1.15)   # imperfect assessment
                if val > best_val:
                    best, best_val = m, val
            if best is None:
                continue
            best.wealth -= BRIDE_PRICE
            w.husband = best
            # patrilocal residence: the bride, and any children she already has,
            # join the husband's camp
            w.camp = best.camp
            for c in self.people:
                if c.mother is w and c.dependent:
                    c.camp = best.camp
            wives_count[best.uid] = wives_count.get(best.uid, 0) + 1

    # -- mortality ---------------------------------------------------
    def _mortality(self):
        married_men = {q.husband.uid for q in self.people
                       if (not q.male) and q.alive
                       and q.husband is not None and q.husband.alive}
        survivors = []
        for p in self.people:
            if not p.alive:
                if p.age < 5:
                    self._deaths_u5 += 1
                continue
            h = siler_hazard(p.age)
            # nutritional stress
            condition = min(1.0, max(0.0, p.energy / p.reserve_cap))
            stress = max(0.0, (STARVATION_ONSET - condition) / STARVATION_ONSET) ** 2
            beta = STARVATION_HAZARD_BETA * (CHILD_STARVATION_EXTRA if p.age < 5 else 1.0)
            h *= (1.0 + beta * stress)
            # unmarried-male risk premium (male-male competition)
            if (p.male and BACHELOR_RISK_AGE[0] <= p.age <= BACHELOR_RISK_AGE[1]
                    and p.uid not in married_men):
                h += SILER_A2 * (self.bachelor_risk - 1.0)
            if self.rng.random() < 1.0 - math.exp(-h / MONTHS_PER_YEAR):
                p.alive = False
                if p.age < 5:
                    self._deaths_u5 += 1
                continue
            survivors.append(p)

        # bridewealth passes to surviving sons, which is what lets advantage
        # compound across generations in the societies where polygyny is common
        dead_men = [p for p in self.people
                    if p.male and not p.alive and p.wealth > 0]
        if dead_men:
            sons_of: dict[int, list[Person]] = {}
            for q in survivors:
                if q.male and q.father is not None:
                    sons_of.setdefault(q.father.uid, []).append(q)
            for m in dead_men:
                heirs = sons_of.get(m.uid, [])
                if heirs and PRIMOGENITURE:
                    heirs = [max(heirs, key=lambda q: q.age_m)]
                if heirs:
                    each = m.wealth * WEALTH_INHERITANCE / len(heirs)
                    for h in heirs:
                        cap = maintenance_kcal_day(h.age, h.male) * MAX_WEALTH_DAYS
                        h.wealth = min(cap, h.wealth + each)

        alive_ids = {p.uid for p in survivors}
        for p in survivors:
            if p.husband is not None and p.husband.uid not in alive_ids:
                p.husband = None
                p.widowed_m = 0
            if p.mother is not None and p.mother.uid not in alive_ids:
                p.mother = None
            if p.father is not None and p.father.uid not in alive_ids:
                p.father = None
        self.people = survivors

    def _age(self):
        for p in self.people:
            p.wealth *= (1.0 + WEALTH_GROWTH - WEALTH_DECAY)
            cap = maintenance_kcal_day(p.age, p.male) * MAX_WEALTH_DAYS
            if p.wealth > cap:
                p.wealth = cap
            p.age_m += 1
            p.widowed_m += 1
            if p.age < 5:
                self._u5_exposure += 1

    # ---------------------------------------------------------------- stats
    def snapshot(self) -> dict:
        n = len(self.people)
        if n == 0:
            return {"pop": 0}
        adults_m = [p for p in self.people if p.male and p.age >= 18]
        adults_f = [p for p in self.people if not p.male and p.age >= 18]
        married_m = set()
        for p in self.people:
            if not p.male and p.husband is not None and p.husband.alive:
                married_m.add(p.husband.uid)
        # completed reproductive success of males who died is not tracked here;
        # use standing RS of males past 45 as the completed-fertility proxy
        old_m = [p for p in self.people if p.male and p.age >= 45]
        rs = [p.n_offspring for p in old_m] or [0]
        wives_per: dict[int, int] = {}
        for p in self.people:
            if not p.male and p.husband is not None and p.husband.alive:
                wives_per[p.husband.uid] = wives_per.get(p.husband.uid, 0) + 1
        counts = list(wives_per.values())
        nm, nf = max(1, len(married_m)), max(1, len(adults_f))
        ne = 4 * nm * nf / (nm + nf)
        return {
            "pop": n,
            "mean_condition": float(np.mean([min(1.0, p.energy / p.reserve_cap)
                                             for p in self.people])),
            "pct_bachelors": 100.0 * (1 - len(married_m) / max(1, len(adults_m))),
            "wives_per_married_man": float(np.mean(counts)) if counts else 0.0,
            "pct_married_men_polygynous": (
                100.0 * sum(1 for c in counts if c > 1) / len(counts) if counts else 0.0),
            "max_wives_held": float(max(counts)) if counts else 0.0,
            "male_rs_var": float(np.var(rs)),
            "male_rs_mean": float(np.mean(rs)),
            "pct_males_zero_rs": 100.0 * sum(1 for r in rs if r == 0) / len(rs),
            "ne": ne,
            "ne_ratio": ne / n,
            "mt_lineages": len({p.mt_lineage for p in self.people}),
            "y_lineages": len({p.y_lineage for p in self.people if p.male}),
            "mean_efficiency": float(np.mean([p.efficiency for p in self.people])),
            "mean_food": float(self.food.sum() / self.patch_k.sum()),
        }


# =====================================================================
# experiment driver
# =====================================================================

def run(system: str, years: int, seed: int) -> dict:
    w = World(system, seed)
    months = years * MONTHS_PER_YEAR
    burn = BURN_IN_YEARS * MONTHS_PER_YEAR
    series = []
    extinct_at = None
    for t in range(months):
        w.step()
        if not w.people:
            extinct_at = t / MONTHS_PER_YEAR
            break
        if t >= burn and t % MONTHS_PER_YEAR == 0:
            series.append(w.snapshot())
    if not series:
        return {"system": system, "seed": seed, "extinct_at": extinct_at, "pop": 0}
    out = {"system": system, "seed": seed, "extinct_at": extinct_at}
    for k in series[0]:
        out[k] = float(np.mean([s[k] for s in series]))
    out["pop_min"] = min(s["pop"] for s in series)
    out["u5_mortality"] = (1000.0 * w._deaths_u5 / max(1, w._births_window))
    out["final_efficiency"] = series[-1]["mean_efficiency"]
    out["final_y_lineages"] = series[-1]["y_lineages"]
    out["final_mt_lineages"] = series[-1]["mt_lineages"]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=500)
    ap.add_argument("--reps", type=int, default=8)
    args = ap.parse_args()

    results = {"monogamy": [], "polygyny": []}
    for sysname in ("monogamy", "polygyny"):
        for rep in range(args.reps):
            r = run(sysname, args.years, seed=1000 + rep)
            results[sysname].append(r)
            print(f"  {sysname:9s} seed={1000+rep}  pop={r.get('pop',0):7.1f} "
                  f"bach={r.get('pct_bachelors',0):5.1f}%  "
                  f"Ne/N={r.get('ne_ratio',0):.3f}  "
                  f"Y={r.get('final_y_lineages',0):4.0f}  "
                  f"mt={r.get('final_mt_lineages',0):4.0f}  "
                  f"eff={r.get('final_efficiency',0):.3f}", flush=True)

    print()
    print("=" * 78)
    print(f"{'metric':<34}{'monogamy':>14}{'polygyny':>14}{'difference':>14}")
    print("=" * 78)
    keys = [
        ("pop", "mean population"),
        ("pop_min", "minimum population"),
        ("mean_condition", "mean nutritional condition"),
        ("u5_mortality", "under-5 deaths per 1000 births"),
        ("pct_bachelors", "% adult males unmarried"),
        ("wives_per_married_man", "wives per married man"),
        ("pct_married_men_polygynous", "% married men with 2+ wives"),
        ("max_wives_held", "most wives held by one man"),
        ("male_rs_mean", "mean male lifetime offspring"),
        ("male_rs_var", "variance in male offspring"),
        ("pct_males_zero_rs", "% males with zero offspring"),
        ("ne", "effective population size Ne"),
        ("ne_ratio", "Ne / N"),
        ("final_mt_lineages", "surviving mtDNA lineages"),
        ("final_y_lineages", "surviving Y lineages"),
        ("final_efficiency", "mean foraging efficiency"),
    ]
    for k, label in keys:
        a = np.mean([r.get(k, 0) for r in results["monogamy"]])
        b = np.mean([r.get(k, 0) for r in results["polygyny"]])
        diff = (b - a) / a * 100 if a else float("nan")
        print(f"{label:<34}{a:>14.2f}{b:>14.2f}{diff:>13.1f}%")
    print("=" * 78)


if __name__ == "__main__":
    main()
