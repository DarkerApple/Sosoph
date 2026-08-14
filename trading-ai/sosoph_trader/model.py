"""Walk-forward model fitting.

There is no train/test split in the usual sense. The panel is a time series, so
the only honest evaluation is: fit on the past, score the next block of
sessions, roll forward, never look back. Every prediction this module returns is
out-of-sample with respect to the model that produced it.

Two guards against leakage:

* an embargo of `cfg.embargo` sessions between the end of the training window
  and the block being scored, because a training row labelled at session t
  already contains the outcome of t+1;
* features are built causally upstream (see `features.py` / `dataset.py`).

Baselines are first-class here. A gradient-boosted model that cannot beat
"rank by mention z-score" is not worth deploying, and the comparison is the
point of the exercise.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .config import BacktestConfig
from .dataset import feature_matrix


def _gbm(seed: int):
    return HistGradientBoostingClassifier(
        max_depth=3,
        max_iter=200,
        learning_rate=0.05,
        min_samples_leaf=20,
        l2_regularization=1.0,
        early_stopping=False,
        random_state=seed,
    )


def _logistic(seed: int):
    return Pipeline(
        [
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            ("clf", LogisticRegression(max_iter=2000, C=0.3, random_state=seed)),
        ]
    )


MODELS: dict[str, Callable[[int], object]] = {
    "gbm": _gbm,
    "logistic": _logistic,
}

# Heuristics that need no fitting. Higher score = more attractive.
HEURISTICS: dict[str, Callable[[pd.DataFrame], pd.Series]] = {
    "buzz": lambda df: df["mention_z"],
    "buzz_accel": lambda df: df["mention_accel"],
    "share": lambda df: df["share_of_board"],
    "tone": lambda df: df["tone_att"],
    "stance": lambda df: df["stance_att"],
    "contrarian_buzz": lambda df: -df["mention_z"],
}


def labeled_only(df: pd.DataFrame) -> pd.DataFrame:
    """Rows with a realised outcome. Everything that fits or scores uses this."""
    out = df[df["y"].notna()].copy()
    out["y"] = out["y"].astype(int)
    return out.reset_index(drop=True)


@dataclass
class WalkForwardResult:
    predictions: pd.DataFrame  # session, symbol, score, y, fwd_ret, target_ret
    n_folds: int
    train_sizes: list[int]
    model_name: str

    @property
    def coverage(self) -> int:
        return self.predictions["session"].nunique()


def walk_forward(
    df: pd.DataFrame,
    model_name: str = "gbm",
    cfg: BacktestConfig | None = None,
) -> WalkForwardResult:
    cfg = cfg or BacktestConfig()
    df = labeled_only(df)

    if model_name in HEURISTICS:
        return _heuristic_result(df, model_name, cfg)
    if model_name not in MODELS:
        raise ValueError(
            f"unknown model {model_name!r}; "
            f"choose from {sorted(MODELS) + sorted(HEURISTICS)}"
        )

    X_all, cols = feature_matrix(df)
    y_all = df["y"].to_numpy()
    sessions = np.array(sorted(df["session"].unique()))
    session_of_row = df["session"].to_numpy()

    if len(sessions) <= cfg.min_train_sessions + cfg.embargo:
        raise ValueError(
            f"need more than {cfg.min_train_sessions + cfg.embargo} sessions to "
            f"walk forward; the dataset has {len(sessions)}"
        )

    chunks: list[pd.DataFrame] = []
    train_sizes: list[int] = []
    start = cfg.min_train_sessions

    while start < len(sessions):
        stop = min(start + cfg.retrain_every, len(sessions))
        test_sessions = sessions[start:stop]
        # Training stops `embargo` sessions before the block opens so that no
        # training label overlaps the scored window.
        cutoff = sessions[max(0, start - cfg.embargo)]
        train_mask = session_of_row < cutoff
        test_mask = np.isin(session_of_row, test_sessions)

        n_train = int(train_mask.sum())
        if n_train >= 100 and len(np.unique(y_all[train_mask])) == 2:
            model = MODELS[model_name](cfg.seed)
            model.fit(X_all.loc[train_mask], y_all[train_mask])
            score = model.predict_proba(X_all.loc[test_mask])[:, 1]

            block = df.loc[test_mask, ["session", "symbol", "y", "fwd_ret", "target_ret"]].copy()
            block["score"] = score
            chunks.append(block)
            train_sizes.append(n_train)

        start = stop

    if not chunks:
        raise ValueError("no fold had enough training data to fit a model")

    preds = pd.concat(chunks, ignore_index=True).sort_values(["session", "symbol"])
    preds.attrs["features"] = cols
    return WalkForwardResult(preds.reset_index(drop=True), len(chunks), train_sizes, model_name)


def _heuristic_result(
    df: pd.DataFrame, name: str, cfg: BacktestConfig
) -> WalkForwardResult:
    """Score every row with a fixed rule, on the same sessions a model would see."""
    sessions = np.array(sorted(df["session"].unique()))
    live = sessions[cfg.min_train_sessions:]
    block = df[df["session"].isin(live)].copy()
    raw = HEURISTICS[name](block).astype(float)
    # Map to a per-session percentile so it composes with probability outputs.
    block["score"] = raw.groupby(block["session"]).rank(pct=True)
    out = block[["session", "symbol", "y", "fwd_ret", "target_ret", "score"]]
    return WalkForwardResult(out.reset_index(drop=True), 0, [], name)


def classification_report(result: WalkForwardResult) -> dict[str, float]:
    """Ranking quality, which is what a top-K portfolio actually consumes."""
    from sklearn.metrics import roc_auc_score

    preds = result.predictions
    y = preds["y"].to_numpy()
    s = preds["score"].to_numpy()

    out: dict[str, float] = {"n": float(len(preds))}
    out["auc"] = float(roc_auc_score(y, s)) if len(np.unique(y)) == 2 else float("nan")

    # Spearman of score vs realised excess return, pooled and per session.
    out["ic"] = float(
        pd.Series(s).rank().corr(pd.Series(preds["target_ret"].to_numpy()).rank())
    )
    per_session = (
        preds.groupby("session")
        .apply(
            lambda g: g["score"].rank().corr(g["target_ret"].rank())
            if len(g) >= 3 else np.nan,
            include_groups=False,
        )
        .dropna()
    )
    out["ic_mean"] = float(per_session.mean()) if len(per_session) else float("nan")
    out["ic_std"] = float(per_session.std()) if len(per_session) > 1 else float("nan")
    out["ic_n"] = float(len(per_session))
    if out["ic_std"] and out["ic_std"] > 0:
        # "Information ratio" of the signal itself, annualised over 252 days.
        out["ic_ir"] = out["ic_mean"] / out["ic_std"] * np.sqrt(252)
    else:
        out["ic_ir"] = float("nan")
    return out


def fit_full(df: pd.DataFrame, model_name: str, cfg: BacktestConfig):
    """Fit on all labeled history -- used only to score today's live panel."""
    if model_name in HEURISTICS:
        return None
    train = labeled_only(df)
    X, _ = feature_matrix(train)
    model = MODELS[model_name](cfg.seed)
    model.fit(X, train["y"].to_numpy())
    return model


def score_live(
    df_all: pd.DataFrame, model_name: str, cfg: BacktestConfig
) -> pd.DataFrame:
    """Rank the newest session using a model fit on every labeled row before it.

    The newest session is the one with no forward return yet -- the only session
    a live trader could actually act on.
    """
    unlabeled = df_all[df_all["y"].isna()]
    target = unlabeled if not unlabeled.empty else df_all
    last = target["session"].max()
    live = target[target["session"] == last].copy()

    history = df_all[(df_all["session"] < last) & df_all["y"].notna()]
    if history.empty:
        raise ValueError("no labeled history before the session being scored")

    if model_name in HEURISTICS:
        raw = HEURISTICS[model_name](live).astype(float)
        live["score"] = raw.rank(pct=True)
    else:
        model = fit_full(history, model_name, cfg)
        X, _ = feature_matrix(live)
        live["score"] = model.predict_proba(X)[:, 1]

    live.attrs["session"] = last
    live.attrs["n_train"] = len(history)
    return live.sort_values("score", ascending=False)
