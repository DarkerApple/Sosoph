"""Portfolio simulation on top of walk-forward scores.

The strategy is deliberately plain, because the interesting question is whether
the *signal* has anything in it, not whether a clever overlay can rescue it:

  each session, take the top K names by score, equal weight, hold one session,
  repeat. Costs are charged on realised turnover.

Two benchmarks run alongside, and both matter:

* ``board``     -- equal weight across *every* candidate that session. This is
                   "just buy whatever WSB is talking about". If the model does
                   not beat it, the model is adding nothing to the ranking.
* ``benchmark`` -- buy and hold SPY over the same sessions.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import BacktestConfig

TRADING_DAYS = 252


@dataclass
class Strategy:
    name: str
    returns: pd.Series           # net per-session returns, indexed by session
    gross: pd.Series
    turnover: pd.Series
    holdings: pd.DataFrame       # session, symbol, weight
    stats: dict[str, float] = field(default_factory=dict)

    @property
    def equity(self) -> pd.Series:
        return (1.0 + self.returns).cumprod()


def _weights_topk(preds: pd.DataFrame, k: int) -> pd.DataFrame:
    """Equal weight over the top-k scores per session (ties broken by symbol)."""
    ranked = preds.sort_values(
        ["session", "score", "symbol"], ascending=[True, False, True]
    )
    picked = ranked.groupby("session", sort=True).head(k).copy()
    picked["weight"] = 1.0 / picked.groupby("session")["symbol"].transform("size")
    return picked[["session", "symbol", "weight", "fwd_ret"]]


def _weights_all(preds: pd.DataFrame) -> pd.DataFrame:
    out = preds[["session", "symbol", "fwd_ret"]].copy()
    out["weight"] = 1.0 / out.groupby("session")["symbol"].transform("size")
    return out


def _simulate(holdings: pd.DataFrame, cost_bps: float, name: str) -> Strategy:
    gross = (
        holdings.assign(c=holdings["weight"] * holdings["fwd_ret"])
        .groupby("session")["c"]
        .sum()
        .sort_index()
    )

    wide = (
        holdings.pivot_table(
            index="session", columns="symbol", values="weight", aggfunc="sum"
        )
        .reindex(gross.index)
        .fillna(0.0)
    )
    # Turnover is the L1 distance between consecutive target books. The first
    # session pays to establish the whole portfolio.
    turnover = wide.diff().abs().sum(axis=1)
    if len(wide):
        turnover.iloc[0] = wide.iloc[0].abs().sum()

    net = gross - turnover * (cost_bps / 1e4)
    strat = Strategy(name=name, returns=net, gross=gross, turnover=turnover,
                     holdings=holdings)
    strat.stats = summarise(net, turnover, holdings)
    return strat


def summarise(
    returns: pd.Series, turnover: pd.Series | None = None,
    holdings: pd.DataFrame | None = None,
) -> dict[str, float]:
    r = returns.dropna()
    if r.empty:
        return {"n_sessions": 0.0}

    equity = (1.0 + r).cumprod()
    total = float(equity.iloc[-1] - 1.0)
    n = len(r)
    ann_ret = float((1.0 + total) ** (TRADING_DAYS / n) - 1.0) if n else float("nan")
    ann_vol = float(r.std(ddof=1) * np.sqrt(TRADING_DAYS)) if n > 1 else float("nan")
    sharpe = float(ann_ret / ann_vol) if ann_vol and ann_vol > 0 else float("nan")
    drawdown = float((equity / equity.cummax() - 1.0).min())

    stats = {
        "n_sessions": float(n),
        "total_return": total,
        "ann_return": ann_ret,
        "ann_vol": ann_vol,
        "sharpe": sharpe,
        "max_drawdown": drawdown,
        "hit_rate": float((r > 0).mean()),
        "best_day": float(r.max()),
        "worst_day": float(r.min()),
        "mean_day": float(r.mean()),
    }
    if turnover is not None and len(turnover):
        stats["avg_turnover"] = float(turnover.mean())
    if holdings is not None and len(holdings):
        stats["avg_names"] = float(holdings.groupby("session").size().mean())
    return stats


def run_backtest(
    preds: pd.DataFrame,
    cfg: BacktestConfig,
    benchmark_returns: pd.Series | None = None,
) -> dict[str, Strategy]:
    """Simulate the model portfolio plus its two reference portfolios."""
    if preds.empty:
        raise ValueError("no predictions to backtest")

    strategies: dict[str, Strategy] = {}
    strategies["model"] = _simulate(
        _weights_topk(preds, cfg.top_k), cfg.cost_bps, f"top{cfg.top_k}"
    )
    strategies["board"] = _simulate(_weights_all(preds), cfg.cost_bps, "board_ew")

    if benchmark_returns is not None:
        bench = benchmark_returns.reindex(strategies["model"].returns.index).dropna()
        if not bench.empty:
            strategies["benchmark"] = Strategy(
                name="benchmark",
                returns=bench,
                gross=bench,
                turnover=pd.Series(0.0, index=bench.index),
                holdings=pd.DataFrame(columns=["session", "symbol", "weight", "fwd_ret"]),
                stats=summarise(bench),
            )
    return strategies


def bootstrap_pvalue(
    returns: pd.Series, n_boot: int = 2000, seed: int = 7
) -> dict[str, float]:
    """How often does a random resample of these returns beat zero mean?

    A stationary-bootstrap-free, deliberately crude check: with ~100 sessions,
    a good-looking Sharpe is routine noise, and this makes that concrete.
    """
    r = returns.dropna().to_numpy()
    if len(r) < 20:
        return {"p_value": float("nan"), "n_boot": 0.0}
    rng = np.random.default_rng(seed)
    centred = r - r.mean()
    draws = rng.choice(centred, size=(n_boot, len(r)), replace=True)
    null_means = draws.mean(axis=1)
    p = float((null_means >= r.mean()).mean())
    return {"p_value": p, "n_boot": float(n_boot), "observed_mean": float(r.mean())}


def top_holdings(strategy: Strategy, n: int = 15) -> pd.DataFrame:
    h = strategy.holdings
    if h.empty:
        return h
    agg = (
        h.assign(contrib=h["weight"] * h["fwd_ret"])
        .groupby("symbol")
        .agg(days_held=("symbol", "size"), avg_ret=("fwd_ret", "mean"),
             total_contrib=("contrib", "sum"))
        .sort_values("days_held", ascending=False)
        .head(n)
    )
    return agg.reset_index()
