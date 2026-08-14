"""Command line entry point.

    python -m sosoph_trader features            # Reddit CSV  -> feature panel
    python -m sosoph_trader prices              # download OHLCV for the panel
    python -m sosoph_trader backtest            # walk-forward fit + simulation
    python -m sosoph_trader signal              # rank the most recent session
    python -m sosoph_trader compare             # model vs every baseline
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

from . import backtest as bt
from . import report as rp
from .config import (BENCHMARK, BacktestConfig, BUILD_DIR, DEFAULT_REDDIT_CSV,
                     DatasetConfig, FeatureConfig, REPORT_DIR, ensure_dirs)
from .dataset import build_dataset, describe
from .features import build_from_csv
from .model import HEURISTICS, MODELS, score_live, walk_forward
from .prices import (PriceError, SYNTHETIC_WARNING, add_returns, load_prices)
from .universe import load_universe

PANEL_PATH = BUILD_DIR / "panel.csv"
DATASET_PATH = BUILD_DIR / "dataset.csv"


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _feature_cfg(args) -> FeatureConfig:
    return FeatureConfig(
        cutoff_et=args.cutoff_et,
        baseline_window=args.baseline_window,
        min_mentions=args.min_mentions,
        max_tickers_per_post=args.max_tickers_per_post,
    )


def _dataset_cfg(args) -> DatasetConfig:
    return DatasetConfig(
        execution=args.execution,
        label=args.label,
        min_price=args.min_price,
        min_dollar_volume=args.min_dollar_volume,
    )


def _backtest_cfg(args) -> BacktestConfig:
    return BacktestConfig(
        top_k=args.top_k,
        cost_bps=args.cost_bps,
        retrain_every=args.retrain_every,
        min_train_sessions=args.min_train_sessions,
        embargo=args.embargo,
        seed=args.seed,
    )


def _load_panel(args, rebuild: bool = False) -> pd.DataFrame:
    if PANEL_PATH.exists() and not rebuild and not args.rebuild:
        panel = pd.read_csv(PANEL_PATH, parse_dates=["session"])
        print(f"[panel] loaded {len(panel):,} rows from {PANEL_PATH}")
        return panel

    print(f"[panel] building from {args.reddit_csv} (this takes ~40s for 53k posts)")
    panel = build_from_csv(
        args.reddit_csv, _feature_cfg(args), load_universe(args.universe)
    )
    PANEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    panel.to_csv(PANEL_PATH, index=False)
    matched = panel.attrs.get("n_posts_matched", 0)
    total = panel.attrs.get("n_posts", 0)
    if total:
        print(f"[panel] {matched:,}/{total:,} posts named a known ticker "
              f"({matched / total:.1%})")
    print(f"[panel] {len(panel):,} rows -> {PANEL_PATH}")
    return panel


def _load_prices(args, panel: pd.DataFrame):
    symbols = sorted(set(panel["symbol"]) | {BENCHMARK})
    start = panel["session"].min().date()
    end = (panel["session"].max() + pd.Timedelta(days=7)).date()
    sessions = pd.DatetimeIndex(sorted(panel["session"].unique()))

    if args.prices == "synthetic":
        print(f"\n*** {SYNTHETIC_WARNING} ***\n")

    prices = load_prices(
        symbols, start, end, provider=args.prices,
        sessions=sessions, seed=args.seed, refresh=args.refresh_prices,
    )
    covered = prices["symbol"].nunique()
    print(f"[prices] {covered}/{len(symbols)} symbols, "
          f"{prices['session'].nunique()} sessions, provider={args.prices}")
    return add_returns(prices)


def _build(args):
    panel = _load_panel(args)
    prices = _load_prices(args, panel)
    data = build_dataset(panel, prices, _dataset_cfg(args))
    print(f"[dataset] {describe(data)}")
    return data, prices


def _bench_returns(prices: pd.DataFrame, execution: str) -> pd.Series | None:
    col = "fwd_ret_close" if execution == "close" else "fwd_ret_open"
    b = prices[prices["symbol"] == BENCHMARK]
    if b.empty:
        return None
    return b.set_index("session")[col].dropna()


def _notes(args, data: pd.DataFrame) -> list[str]:
    notes = []
    if args.prices == "synthetic":
        notes.append(SYNTHETIC_WARNING)
    per_session = data.groupby("session").size()
    if per_session.median() < 10:
        notes.append(
            f"Thin cross-section: median {per_session.median():.0f} candidate names "
            "per session. Top-K selection has little to choose from, and the "
            "portfolio inherits most of its variance from one or two names."
        )
    if data["session"].nunique() < 150:
        notes.append(
            f"Only {data['session'].nunique()} sessions of history. Treat every "
            "performance figure below as an anecdote, not an estimate."
        )
    return notes


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

def cmd_features(args) -> int:
    panel = _load_panel(args, rebuild=True)
    counts = panel.groupby("symbol")["mentions"].sum().sort_values(ascending=False)
    print("\nTop mentioned symbols:")
    print(counts.head(args.top).round(1).to_string())
    print(f"\nSessions: {panel['session'].nunique()} "
          f"({panel['session'].min().date()} -> {panel['session'].max().date()})")
    print(f"Median names per session: {panel.groupby('session').size().median():.0f}")
    return 0


def cmd_prices(args) -> int:
    panel = _load_panel(args)
    try:
        prices = _load_prices(args, panel)
    except PriceError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(prices.groupby("symbol")["session"].agg(["min", "max", "size"]).to_string())
    return 0


def cmd_backtest(args) -> int:
    data, prices = _build(args)
    DATASET_PATH.parent.mkdir(parents=True, exist_ok=True)
    data.to_csv(DATASET_PATH, index=False)

    result = walk_forward(data, args.model, _backtest_cfg(args))
    strategies = bt.run_backtest(
        result.predictions, _backtest_cfg(args),
        _bench_returns(prices, args.execution),
    )
    text = rp.render(result, strategies, describe(data), _notes(args, data))
    print(text)

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / f"backtest_{args.model}.txt").write_text(text)
    rp.equity_frame(strategies).to_csv(REPORT_DIR / f"equity_{args.model}.csv")
    result.predictions.to_csv(REPORT_DIR / f"predictions_{args.model}.csv", index=False)
    print(f"[saved] {REPORT_DIR}")
    return 0


def cmd_compare(args) -> int:
    data, prices = _build(args)
    cfg = _backtest_cfg(args)
    bench = _bench_returns(prices, args.execution)

    rows = []
    for name in list(MODELS) + list(HEURISTICS):
        try:
            result = walk_forward(data, name, cfg)
            strategies = bt.run_backtest(result.predictions, cfg, bench)
            from .model import classification_report
            q = classification_report(result)
            s = strategies["model"].stats
            rows.append({
                "model": name,
                "auc": q["auc"],
                "ic_mean": q["ic_mean"],
                "total_return": s["total_return"],
                "sharpe": s["sharpe"],
                "max_dd": s["max_drawdown"],
                "hit_rate": s["hit_rate"],
            })
        except ValueError as exc:
            print(f"[skip] {name}: {exc}")

    board = bt.run_backtest(
        walk_forward(data, "buzz", cfg).predictions, cfg, bench
    )
    for key in ("board", "benchmark"):
        if key in board:
            s = board[key].stats
            rows.append({"model": f"({key})", "auc": float("nan"),
                         "ic_mean": float("nan"), "total_return": s["total_return"],
                         "sharpe": s["sharpe"], "max_dd": s["max_drawdown"],
                         "hit_rate": s["hit_rate"]})

    table = pd.DataFrame(rows).sort_values("sharpe", ascending=False)
    print("\nMODEL COMPARISON (out-of-sample, top-K portfolio)")
    print(table.to_string(index=False, float_format=lambda v: f"{v:,.3f}"))
    for note in _notes(args, data):
        print(f"  ! {note}")
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    table.to_csv(REPORT_DIR / "comparison.csv", index=False)
    return 0


def cmd_signal(args) -> int:
    panel = _load_panel(args)
    prices = _load_prices(args, panel)
    data = build_dataset(panel, prices, _dataset_cfg(args), include_unlabeled=True)
    cfg = _backtest_cfg(args)

    live = score_live(data, args.model, cfg)
    session = pd.Timestamp(live.attrs["session"])
    known = live["y"].notna().any()

    print(f"\nRanking for session {session.date()} "
          f"(model={args.model}, fit on {live.attrs['n_train']:,} earlier rows)")
    cols = ["symbol", "score", "mentions", "mention_z", "tone", "stance"]
    cols = [c for c in cols if c in live.columns]
    print(live[cols].to_string(index=False, float_format=lambda v: f"{v:,.4f}"))

    picks = live.head(cfg.top_k)["symbol"].tolist()
    entry = "this session's close" if args.execution == "close" else "the next open"
    print(f"\nWould hold ({entry}, equal weight): {', '.join(picks)}")
    if known:
        print("Note: this session already has a realised forward return in the "
              "dataset, so it is a hindsight ranking, not a live one.")
    return 0


# --------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    # Shared options live on a parent parser so they work on either side of the
    # subcommand: `... --top-k 3 backtest` and `... backtest --top-k 3`.
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--reddit-csv", default=str(DEFAULT_REDDIT_CSV), type=Path)
    p.add_argument("--universe", default=None, type=Path,
                   help="symbol list; defaults to the built-in 2021 universe")
    p.add_argument("--rebuild", action="store_true", help="ignore the cached panel")

    p.add_argument("--cutoff-et", default=FeatureConfig.cutoff_et)
    p.add_argument("--baseline-window", type=int, default=FeatureConfig.baseline_window)
    p.add_argument("--min-mentions", type=float, default=FeatureConfig.min_mentions)
    p.add_argument("--max-tickers-per-post", type=int,
                   default=FeatureConfig.max_tickers_per_post)

    p.add_argument("--prices", default="local",
                   choices=["local", "stooq", "yahoo", "synthetic"])
    p.add_argument("--refresh-prices", action="store_true")
    p.add_argument("--execution", default=DatasetConfig.execution,
                   choices=["close", "open"])
    p.add_argument("--label", default=DatasetConfig.label,
                   choices=["cross_sectional", "excess", "absolute"])
    p.add_argument("--min-price", type=float, default=DatasetConfig.min_price)
    p.add_argument("--min-dollar-volume", type=float,
                   default=DatasetConfig.min_dollar_volume)

    p.add_argument("--model", default="gbm",
                   choices=sorted(MODELS) + sorted(HEURISTICS))
    p.add_argument("--top-k", type=int, default=BacktestConfig.top_k)
    p.add_argument("--cost-bps", type=float, default=BacktestConfig.cost_bps)
    p.add_argument("--retrain-every", type=int, default=BacktestConfig.retrain_every)
    p.add_argument("--min-train-sessions", type=int,
                   default=BacktestConfig.min_train_sessions)
    p.add_argument("--embargo", type=int, default=BacktestConfig.embargo)
    p.add_argument("--seed", type=int, default=BacktestConfig.seed)
    p.add_argument("--top", type=int, default=25, help="rows to show in listings")

    root = argparse.ArgumentParser(
        prog="sosoph_trader",
        description="Reddit-sentiment trading research pipeline",
        parents=[p],
    )
    sub = root.add_subparsers(dest="command", required=True)
    for name, fn in (
        ("features", cmd_features), ("prices", cmd_prices),
        ("backtest", cmd_backtest), ("compare", cmd_compare), ("signal", cmd_signal),
    ):
        sp = sub.add_parser(name, help=(fn.__doc__ or name).splitlines()[0],
                            parents=[p])
        sp.set_defaults(func=fn)
    return root


def main(argv: list[str] | None = None) -> int:
    ensure_dirs()
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (PriceError, ValueError, FileNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
