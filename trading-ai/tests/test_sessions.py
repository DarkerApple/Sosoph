from datetime import date, datetime, time, timezone

import pytest

from sosoph_trader.sessions import (assign_session, is_session, market_holidays,
                                    next_session, prev_session, sessions_between)

CUTOFF = time(15, 45)


def utc(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


def test_known_2021_holidays():
    h = market_holidays(2021)
    assert date(2021, 1, 18) in h      # MLK
    assert date(2021, 4, 2) in h       # Good Friday
    assert date(2021, 5, 31) in h      # Memorial Day
    assert date(2021, 7, 5) in h       # July 4 observed (Sunday)
    assert date(2021, 11, 25) in h     # Thanksgiving
    assert date(2021, 12, 24) in h     # Christmas observed (Saturday)
    assert date(2021, 6, 19) not in h  # Juneteenth was not yet a market holiday


def test_juneteenth_from_2022():
    assert date(2022, 6, 20) in market_holidays(2022)  # observed, Sunday the 19th


def test_weekends_are_not_sessions():
    assert not is_session(date(2021, 1, 30))  # Saturday
    assert not is_session(date(2021, 1, 31))  # Sunday
    assert is_session(date(2021, 2, 1))


def test_morning_post_informs_the_same_session():
    # 14:30 UTC == 09:30 ET on a Monday
    assert assign_session(utc(2021, 2, 1, 14, 30), CUTOFF) == date(2021, 2, 1)


def test_post_after_cutoff_rolls_to_the_next_session():
    # 21:00 UTC == 16:00 ET, after the 15:45 cutoff
    assert assign_session(utc(2021, 2, 1, 21, 0), CUTOFF) == date(2021, 2, 2)


def test_weekend_posts_roll_to_monday():
    assert assign_session(utc(2021, 1, 30, 18, 0), CUTOFF) == date(2021, 2, 1)
    assert assign_session(utc(2021, 1, 31, 18, 0), CUTOFF) == date(2021, 2, 1)


def test_holiday_posts_roll_forward():
    # Good Friday 2021; the next session is the Monday.
    assert assign_session(utc(2021, 4, 2, 15, 0), CUTOFF) == date(2021, 4, 5)


def test_assignment_is_never_backwards():
    """The core no-lookahead property, checked hourly across a full year."""
    from datetime import timedelta

    from sosoph_trader.sessions import MARKET_ZONE

    cur = utc(2021, 1, 1, 0, 0)
    end = utc(2022, 1, 1, 0, 0)
    while cur < end:
        session = assign_session(cur, CUTOFF)
        local = cur.astimezone(MARKET_ZONE)
        # A post never informs a session that closed before it was written.
        assert session >= local.date()
        assert is_session(session)
        # It only informs the same day when it beat the cutoff.
        if session == local.date():
            assert local.time() < CUTOFF
        cur += timedelta(hours=1)


def test_next_and_prev_session_round_trip():
    d = date(2021, 2, 5)  # Friday
    assert next_session(d) == date(2021, 2, 8)
    assert prev_session(date(2021, 2, 8)) == d
    assert next_session(d, inclusive=True) == d


def test_sessions_between_counts_february_2021():
    days = sessions_between(date(2021, 2, 1), date(2021, 2, 28))
    assert len(days) == 19  # 20 weekdays minus Presidents' Day
    assert date(2021, 2, 15) not in days


def test_unknown_cutoff_format_raises():
    from sosoph_trader.sessions import parse_cutoff

    assert parse_cutoff("09:30") == time(9, 30)
    with pytest.raises(ValueError):
        parse_cutoff("nonsense")
