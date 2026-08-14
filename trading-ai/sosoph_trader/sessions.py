"""US equity trading calendar and post -> session assignment.

Everything in the pipeline is indexed by *session date*: the trading day whose
bar a piece of text is allowed to influence. Mapping text to sessions correctly
is the whole ballgame for avoiding lookahead, so it lives in one small module
with tests.

The calendar is computed from NYSE holiday rules rather than downloaded, so the
pipeline runs offline. Early closes are ignored -- they do not change which
session a post belongs to under a mid-afternoon cutoff.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

from .config import MARKET_TZ

MARKET_ZONE = ZoneInfo(MARKET_TZ)


def _easter(year: int) -> date:
    """Anonymous Gregorian algorithm."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    n = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * n) // 451
    month, day = divmod(h + n - 7 * m + 114, 31)
    return date(year, month, day + 1)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """n-th (1-based) `weekday` of a month; Monday == 0."""
    d = date(year, month, 1)
    shift = (weekday - d.weekday()) % 7
    return d + timedelta(days=shift + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    d = date(year, month, 1) + timedelta(days=32)
    d = date(d.year, d.month, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d: date) -> date:
    """Saturday holidays observe Friday, Sunday holidays observe Monday."""
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


@lru_cache(maxsize=64)
def market_holidays(year: int) -> frozenset[date]:
    days = {
        _observed(date(year, 1, 1)),                  # New Year's Day
        _nth_weekday(year, 1, 0, 3),                  # MLK Jr Day
        _nth_weekday(year, 2, 0, 3),                  # Washington's Birthday
        _easter(year) - timedelta(days=2),            # Good Friday
        _last_weekday(year, 5, 0),                    # Memorial Day
        _observed(date(year, 7, 4)),                  # Independence Day
        _nth_weekday(year, 9, 0, 1),                  # Labor Day
        _nth_weekday(year, 11, 3, 4),                 # Thanksgiving
        _observed(date(year, 12, 25)),                # Christmas
    }
    if year >= 2022:
        days.add(_observed(date(year, 6, 19)))        # Juneteenth
    return frozenset(days)


def is_session(d: date) -> bool:
    return d.weekday() < 5 and d not in market_holidays(d.year)


def next_session(d: date, inclusive: bool = False) -> date:
    cur = d if inclusive else d + timedelta(days=1)
    for _ in range(15):
        if is_session(cur):
            return cur
        cur += timedelta(days=1)
    raise RuntimeError(f"no trading session found near {d}")


def prev_session(d: date, inclusive: bool = False) -> date:
    cur = d if inclusive else d - timedelta(days=1)
    for _ in range(15):
        if is_session(cur):
            return cur
        cur -= timedelta(days=1)
    raise RuntimeError(f"no trading session found near {d}")


def sessions_between(start: date, end: date) -> list[date]:
    out: list[date] = []
    cur = start
    while cur <= end:
        if is_session(cur):
            out.append(cur)
        cur += timedelta(days=1)
    return out


def parse_cutoff(cutoff_et: str) -> time:
    hh, mm = cutoff_et.split(":")
    return time(int(hh), int(mm))


def assign_session(created_utc: datetime, cutoff: time) -> date:
    """The session a post is allowed to inform.

    A post written before the cutoff on a trading day informs that day's bar.
    Anything later -- after the cutoff, overnight, weekend, holiday -- rolls
    forward to the next session. No post ever informs a bar that closed before
    it was written.
    """
    local = created_utc.astimezone(MARKET_ZONE)
    d = local.date()
    if is_session(d) and local.time() < cutoff:
        return d
    return next_session(d)
