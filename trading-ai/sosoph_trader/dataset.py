"""Join the Reddit panel to prices and turn it into a supervised problem.

Two execution conventions are supported, and they differ in what the model is
allowed to look at:

``close``  decide from text written before the afternoon cutoff, enter at that
           session's close, hold to the next close. Price features are lagged a
           full session, because you do not know today's close before you trade
           it.
``open``   decide from text up to the cutoff, enter at tomorrow's open, hold to
           the following open. Price features may use tonight's close, since it
           prints before the entry. Pair this with a later ``--cutoff-et`` if
           you want the signal to see the full trading day.

Either way, no feature on a row can be computed from a print that happens after
the entry the row is labelled against.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import BENCHMARK, DatasetConfig
from .features import FEATURE_COLUMNS

PRICE_FEATURES = [
    "px_ret_1d", "px_ret_5d", "px_ret_20d", "px_vol_20d", "px_gap",
    "px_from_high20", "px_volume_z", "px_turnover", "px_range",
]


def _price_history_features(prices: pd.DataFrame) -> pd.DataFrame:
    """Trailing price/volume descriptors, causal as of each session's close."""
    df = prices.sort_values(["symbol", "session"]).copy()
    g = df.groupby("symbol", sort=False)

    df["px_ret_1d"] = g["adj_close"].pct_change(1)
    df["px_ret_5d"] = g["adj_close"].pct_change(5)
    df["px_ret_20d"] = g["adj_close"].pct_change(20)
    df["px_vol_20d"] = (
        g["ret_cc"].rolling(20, min_periods=5).std().reset_index(level=0, drop=True)
    )
    # Gap compares raw prints to raw prints -- mixing adjusted and unadjusted
    # here would manufacture a fake gap on every split and dividend date.
    df["px_gap"] = df["open"] / g["close"].shift(1) - 1.0
    high20 = (
        g["adj_close"].rolling(20, min_periods=5).max().reset_index(level=0, drop=True)
    )
    df["px_from_high20"] = df["adj_close"] / high20 - 1.0
    logvol = np.log1p(df["volume"].clip(lower=0))
    vmean = logvol.groupby(df["symbol"]).transform(
        lambda s: s.rolling(20, min_periods=5).mean()
    )
    vstd = logvol.groupby(df["symbol"]).transform(
        lambda s: s.rolling(20, min_periods=5).std()
    )
    df["px_volume_z"] = ((logvol - vmean) / vstd.replace(0, np.nan)).clip(-8, 8)
    df["px_turnover"] = np.log1p(df["dollar_volume"])
    df["px_range"] = (df["high"] - df["low"]) / df["adj_close"].replace(0, np.nan)

    keep = ["session", "symbol", *PRICE_FEATURES]
    return df[keep].replace([np.inf, -np.inf], np.nan)


def build_dataset(
    panel: pd.DataFrame,
    prices: pd.DataFrame,
    cfg: DatasetConfig,
    benchmark: str = BENCHMARK,
    include_unlabeled: bool = False,
) -> pd.DataFrame:
    """Return one row per tradeable (session, symbol) with features and a label.

    The most recent session has no forward return yet -- that is precisely the
    session you would trade. Pass ``include_unlabeled=True`` to keep it, marked
    by ``is_labeled == False``, for live scoring.
    """
    if cfg.execution not in {"close", "open"}:
        raise ValueError(f"execution must be 'close' or 'open', got {cfg.execution!r}")

    ret_col = "fwd_ret_close" if cfg.execution == "close" else "fwd_ret_open"
    price_lag = 1 if cfg.execution == "close" else 0

    px_feats = _price_history_features(prices)
    if price_lag:
        px_feats = px_feats.sort_values(["symbol", "session"])
        cols = PRICE_FEATURES
        px_feats[cols] = px_feats.groupby("symbol", sort=False)[cols].shift(price_lag)

    liquidity = prices[["session", "symbol", "adj_close", "dollar_volume", ret_col]]
    if price_lag:
        liq = liquidity.sort_values(["symbol", "session"]).copy()
        gl = liq.groupby("symbol", sort=False)
        liq["gate_price"] = gl["adj_close"].shift(price_lag)
        liq["gate_dv"] = gl["dollar_volume"].shift(price_lag)
    else:
        liq = liquidity.copy()
        liq["gate_price"] = liq["adj_close"]
        liq["gate_dv"] = liq["dollar_volume"]

    df = (
        panel.merge(px_feats, on=["session", "symbol"], how="inner")
        .merge(
            liq[["session", "symbol", ret_col, "gate_price", "gate_dv"]],
            on=["session", "symbol"],
            how="inner",
        )
        .rename(columns={ret_col: "fwd_ret"})
    )

    df["is_labeled"] = df["fwd_ret"].notna()
    if not include_unlabeled:
        df = df[df["is_labeled"]]
    df = df[df["gate_price"] >= cfg.min_price]
    df = df[df["gate_dv"] >= cfg.min_dollar_volume]

    if df.empty:
        raise ValueError(
            "no rows survived the price join. Check that price data covers the "
            "Reddit date range and the mentioned symbols."
        )

    # Benchmark return for the same holding window, used by the 'excess' label
    # and reported by the backtest.
    bench = (
        prices.loc[prices["symbol"] == benchmark, ["session", ret_col]]
        .rename(columns={ret_col: "bench_ret"})
    )
    df = df.merge(bench, on="session", how="left")

    df = _attach_label(df, cfg)
    df = df.sort_values(["session", "symbol"]).reset_index(drop=True)
    df.attrs.update(panel.attrs)
    return df


def _attach_label(df: pd.DataFrame, cfg: DatasetConfig) -> pd.DataFrame:
    """Attach `target_ret`/`y`. Unlabeled rows keep NaN and are never trained on."""
    labeled = df["is_labeled"]

    if cfg.label == "cross_sectional":
        med = df[labeled].groupby("session")["fwd_ret"].transform("median")
        df.loc[labeled, "target_ret"] = df.loc[labeled, "fwd_ret"] - med
        # A session with one labeled candidate carries no cross-sectional
        # information -- there is nothing to rank it against.
        counts = df[labeled].groupby("session")["symbol"].transform("size")
        drop = counts[counts < 2].index
        df = df.drop(index=drop)
    elif cfg.label == "excess":
        # A labeled row with no benchmark return cannot be scored against it.
        df = df.drop(index=df.index[labeled & df["bench_ret"].isna()])
        ok = df["is_labeled"]
        df.loc[ok, "target_ret"] = df.loc[ok, "fwd_ret"] - df.loc[ok, "bench_ret"]
    elif cfg.label == "absolute":
        df.loc[labeled, "target_ret"] = df.loc[labeled, "fwd_ret"]
    else:
        raise ValueError(f"unknown label {cfg.label!r}")

    if "target_ret" not in df.columns:
        df["target_ret"] = np.nan
    df["y"] = np.where(df["target_ret"].notna(), (df["target_ret"] > 0).astype(float), np.nan)
    return df


def feature_matrix(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    cols = [c for c in FEATURE_COLUMNS + PRICE_FEATURES if c in df.columns]
    X = df[cols].replace([np.inf, -np.inf], np.nan)
    return X, cols


def describe(df: pd.DataFrame) -> str:
    sessions = df["session"].nunique()
    per_session = df.groupby("session").size()
    return (
        f"{len(df):,} rows | {sessions} sessions | "
        f"{df['symbol'].nunique()} symbols | "
        f"{per_session.median():.0f} names/session (median), "
        f"{per_session.min()}-{per_session.max()} range | "
        f"base rate {df['y'].mean():.3f}"
    )
