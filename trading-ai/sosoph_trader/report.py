"""Human-readable output for the training and backtest steps."""

from __future__ import annotations

import pandas as pd

from .backtest import Strategy, bootstrap_pvalue, top_holdings
from .model import WalkForwardResult, classification_report

_PCT = {"total_return", "ann_return", "ann_vol", "max_drawdown", "hit_rate",
        "best_day", "worst_day", "mean_day"}


def _fmt(key: str, value: float) -> str:
    if value != value:  # NaN
        return "n/a"
    if key in _PCT:
        return f"{value * 100:,.2f}%"
    if key in {"n_sessions", "n", "ic_n", "n_boot"}:
        return f"{value:,.0f}"
    return f"{value:,.3f}"


def strategy_table(strategies: dict[str, Strategy]) -> str:
    keys = ["total_return", "ann_return", "ann_vol", "sharpe", "max_drawdown",
            "hit_rate", "avg_names", "avg_turnover", "n_sessions"]
    names = list(strategies)
    width = max(len(k) for k in keys) + 2

    lines = [" " * width + "".join(f"{n:>16}" for n in names)]
    for k in keys:
        row = f"{k:<{width}}"
        for n in names:
            row += f"{_fmt(k, strategies[n].stats.get(k, float('nan'))):>16}"
        lines.append(row)
    return "\n".join(lines)


def signal_quality(result: WalkForwardResult) -> str:
    m = classification_report(result)
    return (
        f"  rows scored out-of-sample : {_fmt('n', m['n'])}\n"
        f"  AUC (up vs down)          : {_fmt('auc', m['auc'])}\n"
        f"  pooled rank IC            : {_fmt('ic', m['ic'])}\n"
        f"  per-session IC (mean/std) : {_fmt('ic_mean', m['ic_mean'])}"
        f" / {_fmt('ic_std', m['ic_std'])} over {_fmt('ic_n', m['ic_n'])} sessions\n"
        f"  IC information ratio      : {_fmt('ic_ir', m['ic_ir'])}"
    )


def render(
    result: WalkForwardResult,
    strategies: dict[str, Strategy],
    dataset_summary: str,
    notes: list[str] | None = None,
) -> str:
    model = strategies["model"]
    boot = bootstrap_pvalue(model.returns)

    parts = [
        "=" * 72,
        f"  WSB signal -> {result.model_name} -> top-K portfolio",
        "=" * 72,
        "",
        f"dataset : {dataset_summary}",
        f"folds   : {result.n_folds} refits"
        + (f", train sizes {min(result.train_sizes)}-{max(result.train_sizes)} rows"
           if result.train_sizes else " (heuristic, no fitting)"),
        "",
        "SIGNAL QUALITY (out-of-sample)",
        signal_quality(result),
        "",
        "PORTFOLIO",
        strategy_table(strategies),
        "",
        f"bootstrap p-value that mean daily return <= 0 : "
        f"{_fmt('p', boot.get('p_value', float('nan')))} "
        f"({boot.get('n_boot', 0):,.0f} resamples)",
    ]

    held = top_holdings(model)
    if not held.empty:
        parts += ["", "MOST-HELD NAMES", held.to_string(index=False, float_format=lambda v: f"{v:,.4f}")]

    if notes:
        parts += ["", "NOTES"] + [f"  ! {n}" for n in notes]

    parts.append("")
    return "\n".join(parts)


def equity_frame(strategies: dict[str, Strategy]) -> pd.DataFrame:
    out = pd.DataFrame({name: s.equity for name, s in strategies.items()})
    out.index.name = "session"
    return out
