"""Shared paths and tunable defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent
PROJECT_DIR = PKG_DIR.parent

DATA_DIR = Path(os.environ.get("SOSOPH_TRADER_DATA", PROJECT_DIR / "data"))
RAW_DIR = DATA_DIR / "raw"
PRICE_DIR = DATA_DIR / "prices"
BUILD_DIR = DATA_DIR / "build"
REPORT_DIR = DATA_DIR / "reports"

DEFAULT_REDDIT_CSV = RAW_DIR / "reddit_wsb.csv"

MARKET_TZ = "America/New_York"

# A post counts toward session D only if it was created before this wall-clock
# time (market timezone) on D. Everything later rolls into the next session, so
# a signal never sees text that was written after the bar it trades on.
DEFAULT_CUTOFF_ET = "15:45"

# Reference symbol used for the trading calendar and as a market benchmark.
BENCHMARK = "SPY"


@dataclass
class FeatureConfig:
    """Knobs for the Reddit -> daily panel step."""

    cutoff_et: str = DEFAULT_CUTOFF_ET
    # Trailing window (in sessions) for per-ticker z-scores and baselines.
    baseline_window: int = 20
    # A ticker/session row is kept only with at least this many mentions.
    min_mentions: float = 2.0
    # Multi-ticker posts split their weight across the tickers they name.
    split_weight_across_tickers: bool = True
    # Cap on tickers per post; spammy "watchlist" posts naming 30 symbols carry
    # no information about any single one of them.
    max_tickers_per_post: int = 8


@dataclass
class DatasetConfig:
    """Knobs for turning the panel + prices into a supervised problem."""

    # "close": decide with text up to the cutoff, trade at the same session's
    #          close, hold one session (close -> close).
    # "open":  decide with everything up to the session close, trade at the
    #          next open, hold one session (open -> open).
    execution: str = "close"
    horizon: int = 1
    # "cross_sectional": beat the median name that day (market-neutral-ish).
    # "excess":          beat the benchmark that day.
    # "absolute":        positive return.
    label: str = "cross_sectional"
    min_price: float = 1.0
    min_dollar_volume: float = 1_000_000.0


@dataclass
class BacktestConfig:
    """Knobs for the portfolio simulation."""

    top_k: int = 5
    cost_bps: float = 10.0
    # Retrain cadence, in sessions, for the walk-forward loop.
    retrain_every: int = 10
    # Sessions of history required before the first model is fit.
    min_train_sessions: int = 40
    # Sessions dropped between train and test to keep the label horizon from
    # leaking across the boundary.
    embargo: int = 2
    seed: int = 7


@dataclass
class RunConfig:
    features: FeatureConfig = field(default_factory=FeatureConfig)
    dataset: DatasetConfig = field(default_factory=DatasetConfig)
    backtest: BacktestConfig = field(default_factory=BacktestConfig)


def ensure_dirs() -> None:
    for d in (RAW_DIR, PRICE_DIR, BUILD_DIR, REPORT_DIR):
        d.mkdir(parents=True, exist_ok=True)
