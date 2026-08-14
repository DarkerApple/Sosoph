"""Daily OHLCV loading.

Providers, in the order you would normally try them:

* ``local``     -- read ``data/prices/<SYMBOL>.csv``. Always available.
* ``stooq``     -- free daily CSV, no key.
* ``yahoo``     -- Yahoo chart JSON, no key.
* ``synthetic`` -- generated random walks. **Not market data.** It exists so the
                   training and backtest code can be exercised end to end in a
                   sandbox with no market-data egress. Any number produced on
                   top of it is meaningless as evidence and is labelled as such
                   everywhere it surfaces.

Downloads are cached as CSV under ``data/prices`` so a second run is offline.
"""

from __future__ import annotations

import io
import json
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
import pandas as pd

from .config import PRICE_DIR

COLUMNS = ["session", "symbol", "open", "high", "low", "close", "adj_close", "volume"]

SYNTHETIC_WARNING = (
    "SYNTHETIC PRICES: these bars are randomly generated, not market data. "
    "Any performance number computed from them is a plumbing check only."
)

_UA = {"User-Agent": "Mozilla/5.0 (compatible; sosoph-trader/1.0)"}


class PriceError(RuntimeError):
    pass


def _cache_path(symbol: str) -> Path:
    return PRICE_DIR / f"{symbol.upper().replace('/', '_')}.csv"


def _normalise(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    df = df.rename(columns={c: c.strip().lower().replace(" ", "_") for c in df.columns})
    if "date" in df.columns:
        df = df.rename(columns={"date": "session"})
    if "adj_close" not in df.columns:
        df["adj_close"] = df["close"]
    df["session"] = pd.to_datetime(df["session"]).dt.normalize()
    df["symbol"] = symbol.upper()
    for col in ("open", "high", "low", "close", "adj_close", "volume"):
        if col not in df.columns:
            df[col] = np.nan
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["close"]).drop_duplicates("session")
    return df[COLUMNS].sort_values("session").reset_index(drop=True)


# --------------------------------------------------------------------------
# providers
# --------------------------------------------------------------------------

def _fetch_stooq(symbol: str, start: date, end: date) -> pd.DataFrame:
    sym = symbol.lower().replace(".", "-")
    url = (
        f"https://stooq.com/q/d/l/?s={sym}.us&i=d"
        f"&d1={start:%Y%m%d}&d2={end:%Y%m%d}"
    )
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8", "replace")
    if not text.startswith("Date"):
        raise PriceError(f"stooq returned no data for {symbol}: {text[:80]!r}")
    return _normalise(pd.read_csv(io.StringIO(text)), symbol)


def _fetch_yahoo(symbol: str, start: date, end: date) -> pd.DataFrame:
    p1 = int(datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp())
    p2 = int(datetime(end.year, end.month, end.day, tzinfo=timezone.utc).timestamp()) + 86400
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?period1={p1}&period2={p2}&interval=1d&events=div%2Csplit"
    )
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    result = (payload.get("chart") or {}).get("result")
    if not result:
        raise PriceError(f"yahoo returned no data for {symbol}")
    node = result[0]
    quote = node["indicators"]["quote"][0]
    adj = node["indicators"].get("adjclose", [{}])[0].get("adjclose")
    frame = pd.DataFrame(
        {
            "date": pd.to_datetime(node["timestamp"], unit="s", utc=True)
            .tz_convert("America/New_York")
            .tz_localize(None)
            .normalize(),
            "open": quote.get("open"),
            "high": quote.get("high"),
            "low": quote.get("low"),
            "close": quote.get("close"),
            "adj_close": adj if adj is not None else quote.get("close"),
            "volume": quote.get("volume"),
        }
    )
    return _normalise(frame, symbol)


def _synthetic(symbol: str, sessions: Sequence[pd.Timestamp], seed: int) -> pd.DataFrame:
    """A seeded geometric random walk. See SYNTHETIC_WARNING."""
    rng = np.random.default_rng(abs(hash((symbol, seed))) % (2**32))
    n = len(sessions)
    drift, vol = 0.0002, float(rng.uniform(0.03, 0.11))
    steps = rng.normal(drift, vol, n)
    close = 20.0 * np.exp(np.cumsum(steps))
    intraday = np.abs(rng.normal(0, vol / 2, n))
    frame = pd.DataFrame(
        {
            "date": pd.DatetimeIndex(sessions),
            "open": close * (1 + rng.normal(0, vol / 3, n)),
            "high": close * (1 + intraday),
            "low": close * (1 - intraday),
            "close": close,
            "adj_close": close,
            "volume": rng.integers(5e5, 5e7, n),
        }
    )
    return _normalise(frame, symbol)


# --------------------------------------------------------------------------
# public API
# --------------------------------------------------------------------------

def load_prices(
    symbols: Iterable[str],
    start: date,
    end: date,
    provider: str = "local",
    sessions: Sequence[pd.Timestamp] | None = None,
    seed: int = 7,
    refresh: bool = False,
    verbose: bool = True,
) -> pd.DataFrame:
    """Return a long OHLCV frame for `symbols`, one row per session."""
    PRICE_DIR.mkdir(parents=True, exist_ok=True)
    symbols = sorted({s.upper() for s in symbols})
    frames: list[pd.DataFrame] = []
    failures: list[str] = []

    if provider == "synthetic" and sessions is None:
        raise PriceError("synthetic prices need an explicit session index")

    for sym in symbols:
        cache = _cache_path(sym)
        if cache.exists() and not refresh and provider != "synthetic":
            frames.append(_normalise(pd.read_csv(cache), sym))
            continue

        try:
            if provider == "local":
                raise PriceError(f"no cached prices for {sym} at {cache}")
            if provider == "stooq":
                df = _fetch_stooq(sym, start, end)
            elif provider == "yahoo":
                df = _fetch_yahoo(sym, start, end)
            elif provider == "synthetic":
                df = _synthetic(sym, sessions, seed)
            else:
                raise PriceError(f"unknown price provider {provider!r}")
        except (urllib.error.URLError, PriceError, KeyError, ValueError) as exc:
            failures.append(f"{sym}: {exc}")
            continue

        if provider != "synthetic":
            df.drop(columns=["symbol"]).to_csv(cache, index=False)
        frames.append(df)

    if verbose and failures:
        print(f"[prices] {len(failures)} symbol(s) unavailable via {provider}:")
        for line in failures[:10]:
            print(f"  - {line}")
        if len(failures) > 10:
            print(f"  ... and {len(failures) - 10} more")

    if not frames:
        raise PriceError(
            f"no price data loaded from provider {provider!r}. "
            "Drop CSVs into data/prices/<SYMBOL>.csv, or pick a reachable provider."
        )

    out = pd.concat(frames, ignore_index=True)
    mask = (out["session"] >= pd.Timestamp(start)) & (out["session"] <= pd.Timestamp(end))
    return out.loc[mask].sort_values(["symbol", "session"]).reset_index(drop=True)


def add_returns(prices: pd.DataFrame) -> pd.DataFrame:
    """Attach the forward returns the labels and the backtest are built on."""
    df = prices.sort_values(["symbol", "session"]).copy()
    g = df.groupby("symbol", sort=False)

    df["ret_cc"] = g["adj_close"].pct_change()
    # Close-to-close over the *next* session: what a position opened at today's
    # close actually earns.
    df["fwd_ret_close"] = g["adj_close"].shift(-1) / df["adj_close"] - 1.0
    # Open-to-open over the next two opens: what you earn entering at tomorrow's
    # open with information known by tonight's close.
    open_ratio = g["open"].shift(-2) / g["open"].shift(-1) - 1.0
    df["fwd_ret_open"] = open_ratio
    df["dollar_volume"] = df["close"] * df["volume"]
    return df


def trading_sessions(prices: pd.DataFrame) -> pd.DatetimeIndex:
    return pd.DatetimeIndex(sorted(prices["session"].unique()))
