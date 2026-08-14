"""End-to-end checks on a small synthetic corpus.

The important assertions here are not "does it produce a number" but "does it
refuse to see the future". Feature rows are rebuilt with the future truncated
away, and the past must come out byte-identical.
"""

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

from sosoph_trader.backtest import BacktestConfig, run_backtest, summarise
from sosoph_trader.config import DatasetConfig, FeatureConfig
from sosoph_trader.dataset import build_dataset
from sosoph_trader.features import FEATURE_COLUMNS, aggregate_posts, build_panel
from sosoph_trader.ingest import Post
from sosoph_trader.model import walk_forward
from sosoph_trader.prices import add_returns, load_prices
from sosoph_trader.sessions import sessions_between
from sosoph_trader.universe import universe_from_symbols

SYMBOLS = ["GME", "AMC", "PLTR", "NOK", "BB", "TSLA", "SPY"]
U = universe_from_symbols(SYMBOLS)
CFG = FeatureConfig(min_mentions=1, baseline_window=10)


def make_posts(n_days=90, seed=3):
    """A deterministic fake subreddit: every symbol, every day, varying volume."""
    rng = np.random.default_rng(seed)
    start = datetime(2021, 2, 1, 14, 0, tzinfo=timezone.utc)
    posts, pid = [], 0
    for day in range(n_days):
        when = start + timedelta(days=day)
        for sym in SYMBOLS:
            for _ in range(int(rng.integers(2, 9))):
                pid += 1
                bullish = rng.random() > 0.4
                text = f"${sym} " + ("calls to the moon 🚀" if bullish else "puts, this is drilling")
                posts.append(
                    Post(
                        post_id=str(pid),
                        created=when + timedelta(minutes=int(rng.integers(0, 90))),
                        title=text,
                        body="diamond hands" if bullish else "bagholding",
                        score=int(rng.integers(0, 500)),
                        comments=int(rng.integers(0, 200)),
                    )
                )
    return posts


@pytest.fixture(scope="module")
def panel():
    return build_panel(aggregate_posts(make_posts(), U, CFG), CFG)


@pytest.fixture(scope="module")
def prices(panel):
    sessions = pd.DatetimeIndex(sorted(panel["session"].unique()))
    px = load_prices(
        sorted(panel["symbol"].unique()),
        sessions.min().date(), sessions.max().date(),
        provider="synthetic", sessions=sessions, seed=11, verbose=False,
    )
    return add_returns(px)


def test_panel_has_every_feature_column(panel):
    missing = set(FEATURE_COLUMNS) - set(panel.columns)
    assert not missing, missing
    assert panel[FEATURE_COLUMNS].notna().all().all()


def test_panel_sessions_are_trading_days(panel):
    valid = set(pd.Timestamp(d) for d in sessions_between(
        panel["session"].min().date(), panel["session"].max().date()))
    assert set(panel["session"]) <= valid


def test_features_do_not_change_when_the_future_is_deleted():
    """Truncating the corpus must not alter any earlier feature value."""
    posts = make_posts()
    full = build_panel(aggregate_posts(posts, U, CFG), CFG)

    cutoff = pd.Timestamp(sorted(full["session"].unique())[-15])
    truncated_posts = [p for p in posts if pd.Timestamp(p.created.date()) < cutoff]
    partial = build_panel(aggregate_posts(truncated_posts, U, CFG), CFG)

    key = ["session", "symbol"]
    a = full[full["session"] < cutoff].set_index(key)[FEATURE_COLUMNS].sort_index()
    b = partial[partial["session"] < cutoff].set_index(key)[FEATURE_COLUMNS].sort_index()
    common = a.index.intersection(b.index)
    assert len(common) > 100
    pd.testing.assert_frame_equal(
        a.loc[common], b.loc[common], check_exact=False, atol=1e-9
    )


def test_bullish_corpus_scores_positive(panel):
    assert panel["tone"].mean() > 0
    assert panel["stance"].between(-1, 1).all()


def test_dataset_labels_are_balanced_cross_sectionally(panel, prices):
    data = build_dataset(panel, prices, DatasetConfig(label="cross_sectional"))
    assert 0.3 < data["y"].mean() < 0.7
    assert data["fwd_ret"].notna().all()
    # A cross-sectional label must have both winners and losers every session.
    per_session = data.groupby("session")["y"].mean()
    assert (per_session < 1.0).all()


def test_forward_return_matches_the_price_series(panel, prices):
    data = build_dataset(panel, prices, DatasetConfig(execution="close"))
    px = prices.set_index(["symbol", "session"])["adj_close"]
    row = data.iloc[10]
    sessions = sorted(prices.loc[prices["symbol"] == row["symbol"], "session"])
    nxt = sessions[sessions.index(row["session"]) + 1]
    expected = px[(row["symbol"], nxt)] / px[(row["symbol"], row["session"])] - 1
    assert row["fwd_ret"] == pytest.approx(expected, rel=1e-9)


def test_unlabeled_rows_are_kept_only_on_request(panel, prices):
    cfg = DatasetConfig()
    labeled = build_dataset(panel, prices, cfg)
    both = build_dataset(panel, prices, cfg, include_unlabeled=True)
    assert not both["is_labeled"].all()  # the newest session is live
    assert len(both) > len(labeled)
    assert both.loc[~both["is_labeled"], "y"].isna().all()


def test_walk_forward_predictions_are_out_of_sample(panel, prices):
    data = build_dataset(panel, prices, DatasetConfig())
    cfg = BacktestConfig(min_train_sessions=30, retrain_every=10)
    result = walk_forward(data, "gbm", cfg)
    first_scored = result.predictions["session"].min()
    all_sessions = sorted(data["session"].unique())
    assert first_scored >= all_sessions[cfg.min_train_sessions]
    assert result.predictions["score"].between(0, 1).all()
    assert result.n_folds >= 2


def test_heuristics_score_the_same_sessions_as_models(panel, prices):
    data = build_dataset(panel, prices, DatasetConfig())
    cfg = BacktestConfig(min_train_sessions=30, retrain_every=10)
    gbm = walk_forward(data, "gbm", cfg).predictions
    buzz = walk_forward(data, "buzz", cfg).predictions
    assert set(buzz["session"]) >= set(gbm["session"])


def test_backtest_costs_reduce_returns(panel, prices):
    data = build_dataset(panel, prices, DatasetConfig())
    cfg = BacktestConfig(min_train_sessions=30, top_k=3, cost_bps=0.0)
    preds = walk_forward(data, "buzz", cfg).predictions

    free = run_backtest(preds, cfg)["model"]
    costly = run_backtest(preds, BacktestConfig(
        min_train_sessions=30, top_k=3, cost_bps=50.0))["model"]
    assert costly.stats["total_return"] < free.stats["total_return"]
    assert free.stats["avg_names"] <= 3


def test_summarise_on_a_known_series():
    r = pd.Series([0.01] * 252, index=pd.date_range("2021-01-04", periods=252, freq="B"))
    s = summarise(r)
    assert s["total_return"] == pytest.approx(1.01 ** 252 - 1)
    assert s["hit_rate"] == 1.0
    assert s["max_drawdown"] == 0.0
