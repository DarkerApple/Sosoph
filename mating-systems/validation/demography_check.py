"""
Validation of the life-history core against published forager vital rates.

This is NOT the agent-based model. It exercises the *demographic engine* that
both .nlogo models use -- the Siler mortality hazard, the age-specific
fecundability schedule and the birth-spacing process -- in isolation, so that
the constants baked into the models can be shown to reproduce measured
hunter-gatherer demography rather than merely asserted to.

Constants are imported from abm_reference.py so this file cannot drift out of
step with the model it is checking.

Run: python3 demography_check.py
"""

import math
import random

import abm_reference as M


# ---------------------------------------------------------------- life table
def life_table(step=1.0 / 12, max_age=110):
    """Exact l(x) and e(x) from the Siler hazard, by monthly integration."""
    ages, surv = [], []
    a, H = 0.0, 0.0
    while a < max_age:
        ages.append(a)
        surv.append(math.exp(-H))
        H += M.siler_hazard(a) * step
        a += step
    return ages, surv


def summarise(ages, surv, step=1.0 / 12):
    def l(x):
        return surv[min(int(x / step), len(surv) - 1)]

    e0 = sum(surv) * step
    e15 = sum(surv[int(15 / step):]) * step / l(15)
    deaths = [surv[i] * M.siler_hazard(ages[i]) for i in range(len(ages))]
    i20 = int(20 / step)
    modal = ages[i20 + max(range(len(ages) - i20), key=lambda k: deaths[i20 + k])]
    return dict(imr=1 - l(1), s15=l(15), s45=l(45), e0=e0, e15=e15, modal=modal)


# ---------------------------------------------------------------- fertility
def fertility_career(rng, with_mortality):
    """
    Month-by-month simulation of one woman's reproductive career using exactly
    the rules in the model: conception, gestation, stillbirth, then lactational
    amenorrhoea before she can conceive again.
    """
    age_m = int(M.MENARCHE_AGE * 12)
    births, intervals, last = 0, [], None
    state, timer = "cycling", 0
    while age_m < int((M.MENOPAUSE_AGE + 1) * 12):
        age = age_m / 12
        if with_mortality:
            if rng.random() < 1 - math.exp(-M.siler_hazard(age) / 12):
                break
        if state == "cycling":
            p = fecundability(age)
            if p > 0 and rng.random() < p:
                state, timer = "pregnant", 0
        elif state == "pregnant":
            timer += 1
            if timer > M.GESTATION_MONTHS:
                if rng.random() >= M.STILLBIRTH_RATE:
                    births += 1
                    if last is not None:
                        intervals.append(age_m - last)
                    last = age_m
                    if rng.random() < M.MATERNAL_MORTALITY:
                        break
                    state, timer = "amenorrhoeic", 0
                else:
                    state, timer = "amenorrhoeic", 0
        else:
            timer += 1
            if timer > M.LACTATIONAL_AMENORRHEA_MONTHS:
                state = "cycling"
        age_m += 1
    return births, intervals


def fecundability(age):
    if age < M.MENARCHE_AGE or age >= M.MENOPAUSE_AGE:
        return 0.0
    ramp = min(1.0, (age - M.MENARCHE_AGE) / M.ADOLESCENT_SUBFECUNDITY_YEARS)
    decline = 1.0 / (1.0 + math.exp((age - M.FECUND_DECLINE_MID) / M.FECUND_DECLINE_K))
    return M.PEAK_FECUNDABILITY * ramp * decline


def check(label, value, lo, hi, fmt="{:.3f}"):
    mark = "ok " if lo <= value <= hi else "OUT"
    print(f"  [{mark}] {label:<34}{fmt.format(value):>9}   "
          f"published {fmt.format(lo)}-{fmt.format(hi)}")
    return lo <= value <= hi


# ---------------------------------------------------------------- report
if __name__ == "__main__":
    rng = random.Random(12345)
    passed = []

    print("=" * 78)
    print("MORTALITY -- Siler competing hazards, against Gurven & Kaplan (2007)")
    print("=" * 78)
    ages, surv = life_table()
    st = summarise(ages, surv)
    print(f"  {'age':>5} {'l(x)':>10} {'hazard/yr':>12} ")
    for a in (0, 1, 5, 15, 25, 45, 65, 80):
        print(f"  {a:>5} {surv[int(a * 12)]:>10.3f} {M.siler_hazard(a):>12.4f}")
    print()
    passed.append(check("infant mortality q(0,1)", st["imr"], 0.20, 0.30))
    passed.append(check("survival to age 15", st["s15"], 0.50, 0.62))
    passed.append(check("life expectancy at birth", st["e0"], 21, 37, "{:.1f}"))
    passed.append(check("further life expectancy at 15", st["e15"], 30, 45, "{:.1f}"))
    passed.append(check("modal adult age at death", st["modal"], 62, 80, "{:.0f}"))

    print()
    print("=" * 78)
    print("FERTILITY -- natural fertility, 20 000 simulated careers")
    print("=" * 78)
    n = 20000
    tot, ivs, completed = 0, [], []
    for _ in range(n):
        b, iv = fertility_career(rng, with_mortality=False)
        tot += b
        ivs.extend(iv)
        completed.append(b)
    tfr = tot / n
    ibi = sum(ivs) / len(ivs) if ivs else float("nan")
    passed.append(check("completed fertility (no mortality)", tfr, 4.5, 8.5, "{:.2f}"))
    passed.append(check("mean birth interval, months", ibi, 30, 46, "{:.0f}"))

    born = [fertility_career(rng, with_mortality=True)[0] for _ in range(n)]
    per_survivor = sum(born) / n
    # daughters per girl *born*: also survive childhood to reach menarche
    nrr = per_survivor * 0.485 * st["s15"]
    print(f"  [   ] {'births per woman reaching menarche':<34}{per_survivor:>9.2f}")
    # This is R0 with food unlimited, so it must exceed 1: the population grows
    # until the landscape stops it. Density dependence in the full model brings
    # the realised rate back to ~1 at the food ceiling, which is why the
    # simulated population settles rather than growing without bound.
    passed.append(check("R0, food unlimited (must exceed 1)", nrr, 1.2, 2.6, "{:.2f}"))

    print()
    print("=" * 78)
    print("ENERGETICS -- requirement and production, kcal/day")
    print("=" * 78)
    print(f"  {'age':>5} {'male need':>11} {'female need':>13} "
          f"{'male prod':>11} {'female prod':>13}")
    for a in (0, 2, 5, 10, 15, 20, 35, 50, 70):
        print(f"  {a:>5} {M.maintenance_kcal_day(a, True):>11.0f} "
              f"{M.maintenance_kcal_day(a, False):>13.0f} "
              f"{M.production_capability(a, True, 1.0):>11.0f} "
              f"{M.production_capability(a, False, 1.0):>13.0f}")
    print()
    passed.append(check("adult male TEE", M.maintenance_kcal_day(30, True),
                        2400, 2900, "{:.0f}"))
    passed.append(check("adult female TEE", M.maintenance_kcal_day(30, False),
                        1700, 2100, "{:.0f}"))
    passed.append(check("peak male production", M.production_capability(35, True, 1.0),
                        2000, 6500, "{:.0f}"))

    # population-level energy balance in a stationary population
    tab = M.World._survivorship.__func__(M.World)
    total = sum(tab)
    prod = need = 0.0
    for yr, l in enumerate(tab):
        w = l / total
        for male in (True, False):
            prod += 0.5 * w * M.production_capability(yr + 0.5, male, 1.0)
            need += 0.5 * w * M.maintenance_kcal_day(yr + 0.5, male)
    print()
    passed.append(check("population production / requirement", prod / need,
                        1.2, 2.0, "{:.2f}"))
    dep = sum(tab[y] / total for y in range(15))
    passed.append(check("dependants under 15, share", dep, 0.28, 0.45))

    print()
    print("=" * 78)
    print(f"{sum(passed)}/{len(passed)} checks within published ranges")
    print("=" * 78)
