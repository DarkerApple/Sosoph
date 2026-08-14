"""Reddit posts -> a causal (session, symbol) feature panel.

Every derived column is built from information available strictly before the
bar it is attached to. Rolling statistics are shifted by one session, so a
z-score for Tuesday never sees Tuesday's own value.

Two families of feature:

* attention -- how much is this name being talked about, relative to its own
  history and to the rest of the board today
* opinion   -- what is being said (tone), and what position is implied (stance)

Attention is the part that historically carried signal on this subreddit;
tone/stance are included so the model can decide.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from .config import FeatureConfig
from .ingest import Post, read_posts
from .sentiment import score_text
from .sessions import assign_session, parse_cutoff
from .tickers import TIER_CASHTAG, extract
from .universe import Universe, default_universe

PANEL_KEYS = ["session", "symbol"]


@dataclass
class _Row:
    session: object
    symbol: str
    weight: float = 0.0
    posts: int = 0
    title_posts: int = 0
    cashtag_posts: int = 0
    attention: float = 0.0
    score_sum: float = 0.0
    comment_sum: float = 0.0
    tone_w: float = 0.0
    tone_aw: float = 0.0
    stance_w: float = 0.0
    stance_aw: float = 0.0
    stance_evidence: float = 0.0
    bull_posts: float = 0.0
    bear_posts: float = 0.0
    rockets: float = 0.0
    diamonds: float = 0.0
    bear_emoji: float = 0.0


def _attention(post: Post) -> float:
    """Engagement weight for one post. Log-scaled: the Jan 29 tail is brutal."""
    return float(np.log1p(max(post.score, 0)) + np.log1p(max(post.comments, 0)))


def aggregate_posts(
    posts: Iterable[Post],
    universe: Universe,
    cfg: FeatureConfig,
) -> pd.DataFrame:
    """Collapse posts into raw per-(session, symbol) sums."""
    cutoff = parse_cutoff(cfg.cutoff_et)
    rows: dict[tuple[object, str], _Row] = {}
    posts_per_session: dict[object, int] = defaultdict(int)
    n_posts = 0
    n_matched = 0

    for post in posts:
        n_posts += 1
        session = assign_session(post.created, cutoff)
        posts_per_session[session] += 1

        mentions = extract(post.title, post.body, universe)
        if not mentions:
            continue
        mentions = mentions[: cfg.max_tickers_per_post]
        n_matched += 1

        sc = score_text(post.title, post.body)
        att = _attention(post)
        share = 1.0 / len(mentions) if cfg.split_weight_across_tickers else 1.0

        for m in mentions:
            key = (session, m.symbol)
            row = rows.get(key)
            if row is None:
                row = rows[key] = _Row(session=session, symbol=m.symbol)
            row.weight += share
            row.posts += 1
            row.title_posts += int(m.in_title)
            row.cashtag_posts += int(m.tier == TIER_CASHTAG)
            row.attention += share * att
            row.score_sum += share * np.log1p(max(post.score, 0))
            row.comment_sum += share * np.log1p(max(post.comments, 0))
            row.tone_w += share * sc.tone
            row.tone_aw += share * att * sc.tone
            row.stance_w += share * sc.stance
            row.stance_aw += share * att * sc.stance
            row.stance_evidence += share * sc.stance_evidence
            row.bull_posts += share * (sc.stance > 0.2)
            row.bear_posts += share * (sc.stance < -0.2)
            row.rockets += share * sc.rockets
            row.diamonds += share * sc.diamonds
            row.bear_emoji += share * sc.bear_emoji

    if not rows:
        raise ValueError("no ticker mentions found -- check the universe")

    df = pd.DataFrame([asdict(r) for r in rows.values()])
    df["session"] = pd.to_datetime(df["session"])
    volume = pd.Series(posts_per_session, name="session_posts")
    volume.index = pd.to_datetime(volume.index)
    df = df.merge(
        volume.rename_axis("session").reset_index(), on="session", how="left"
    )
    df.attrs["n_posts"] = n_posts
    df.attrs["n_posts_matched"] = n_matched
    return df


def _densify(raw: pd.DataFrame) -> pd.DataFrame:
    """Reindex every symbol onto every session, filling silence with zeros.

    A symbol nobody mentioned on Tuesday has zero mentions on Tuesday -- that is
    data, not a gap, and rolling baselines are wrong without it.
    """
    sessions = pd.DatetimeIndex(sorted(raw["session"].unique()))
    symbols = sorted(raw["symbol"].unique())
    idx = pd.MultiIndex.from_product([sessions, symbols], names=PANEL_KEYS)

    numeric = [c for c in raw.columns if c not in PANEL_KEYS + ["session_posts"]]
    dense = (
        raw.set_index(PANEL_KEYS)[numeric]
        .reindex(idx)
        .fillna(0.0)
        .reset_index()
    )
    volume = raw[["session", "session_posts"]].drop_duplicates()
    return dense.merge(volume, on="session", how="left")


def _safe_div(num: pd.Series, den: pd.Series) -> pd.Series:
    return (num / den.replace(0, np.nan)).fillna(0.0)


def build_panel(raw: pd.DataFrame, cfg: FeatureConfig) -> pd.DataFrame:
    """Turn raw sums into the causal feature panel."""
    df = _densify(raw).sort_values(PANEL_KEYS).reset_index(drop=True)

    # --- ratios that are meaningful only where there was activity -----------
    df["tone"] = _safe_div(df["tone_w"], df["weight"])
    df["tone_att"] = _safe_div(df["tone_aw"], df["attention"])
    df["stance"] = _safe_div(df["stance_w"], df["weight"])
    df["stance_att"] = _safe_div(df["stance_aw"], df["attention"])
    df["bull_share"] = _safe_div(df["bull_posts"], df["weight"])
    df["bear_share"] = _safe_div(df["bear_posts"], df["weight"])
    df["title_share"] = _safe_div(df["title_posts"], df["posts"])
    df["cashtag_share"] = _safe_div(df["cashtag_posts"], df["posts"])
    df["rocket_rate"] = _safe_div(df["rockets"], df["weight"])
    df["diamond_rate"] = _safe_div(df["diamonds"], df["weight"])
    df["bear_emoji_rate"] = _safe_div(df["bear_emoji"], df["weight"])
    df["score_per_post"] = _safe_div(df["score_sum"], df["weight"])
    df["comments_per_post"] = _safe_div(df["comment_sum"], df["weight"])

    # --- attention, normalised for the board's own daily volume ------------
    df["mentions"] = df["weight"]
    df["log_mentions"] = np.log1p(df["mentions"])
    df["mention_share"] = _safe_div(df["mentions"], df["session_posts"])
    df["log_attention"] = np.log1p(df["attention"])

    by_session = df.groupby("session", sort=False)
    df["board_mentions"] = by_session["mentions"].transform("sum")
    df["share_of_board"] = _safe_div(df["mentions"], df["board_mentions"])

    # Cross-sectional comparisons only make sense against the names that were
    # actually discussed; the zero-filled rows would drag every average down.
    live = df["mentions"] > 0
    df["attention_rank"] = (
        df.loc[live].groupby("session")["mentions"].rank(pct=True, method="average")
        .reindex(df.index).fillna(0.0)
    )
    board_tone = (
        df.loc[live].groupby("session")["tone"].mean().rename("board_tone")
    )
    df["tone_vs_board"] = df["tone"] - df["session"].map(board_tone).fillna(0.0)

    # --- per-symbol history; shift(1) keeps today out of its own baseline ---
    g = df.groupby("symbol", sort=False)
    w = cfg.baseline_window

    prev_log = g["log_mentions"].shift(1)
    roll_mean = (
        g["log_mentions"].shift(1).groupby(df["symbol"]).rolling(w, min_periods=5)
        .mean().reset_index(level=0, drop=True)
    )
    roll_std = (
        g["log_mentions"].shift(1).groupby(df["symbol"]).rolling(w, min_periods=5)
        .std().reset_index(level=0, drop=True)
    )

    df["mention_z"] = ((df["log_mentions"] - roll_mean) / roll_std.replace(0, np.nan))
    df["mention_z"] = df["mention_z"].replace([np.inf, -np.inf], np.nan).fillna(0.0)
    df["mention_z"] = df["mention_z"].clip(-8, 8)
    df["mention_accel"] = (df["log_mentions"] - prev_log).fillna(0.0)
    df["mention_vs_base"] = (df["log_mentions"] - roll_mean).fillna(0.0)

    prev_share = g["share_of_board"].shift(1).fillna(0.0)
    df["share_accel"] = df["share_of_board"] - prev_share

    tone_base = (
        g["tone"].shift(1).groupby(df["symbol"]).rolling(w, min_periods=5)
        .mean().reset_index(level=0, drop=True)
    )
    df["tone_delta"] = (df["tone"] - tone_base).fillna(0.0)

    stance_base = (
        g["stance"].shift(1).groupby(df["symbol"]).rolling(w, min_periods=5)
        .mean().reset_index(level=0, drop=True)
    )
    df["stance_delta"] = (df["stance"] - stance_base).fillna(0.0)

    df["mentions_5d"] = (
        g["mentions"].shift(1).groupby(df["symbol"]).rolling(5, min_periods=1)
        .sum().reset_index(level=0, drop=True).fillna(0.0)
    )
    df["log_mentions_5d"] = np.log1p(df["mentions_5d"])

    active = (df["mentions"] > 0).astype(int)
    df["active_days_20"] = (
        active.groupby(df["symbol"]).shift(1).groupby(df["symbol"])
        .rolling(w, min_periods=1).sum().reset_index(level=0, drop=True).fillna(0.0)
    )
    df["is_fresh"] = (df["active_days_20"] == 0).astype(int)

    df["dow"] = df["session"].dt.dayofweek

    panel = df[df["mentions"] >= cfg.min_mentions].copy()
    panel = panel.sort_values(PANEL_KEYS).reset_index(drop=True)
    panel.attrs.update(raw.attrs)
    return panel


FEATURE_COLUMNS = [
    "log_mentions", "log_mentions_5d", "mention_share", "share_of_board",
    "mention_z", "mention_accel", "mention_vs_base", "share_accel",
    "attention_rank", "log_attention", "active_days_20", "is_fresh",
    "tone", "tone_att", "tone_delta", "tone_vs_board",
    "stance", "stance_att", "stance_delta", "bull_share", "bear_share",
    "rocket_rate", "diamond_rate", "bear_emoji_rate",
    "title_share", "cashtag_share", "score_per_post", "comments_per_post",
    "dow",
]


def build_from_csv(
    csv_path: str | Path,
    cfg: FeatureConfig | None = None,
    universe: Universe | None = None,
) -> pd.DataFrame:
    cfg = cfg or FeatureConfig()
    universe = universe or default_universe()
    raw = aggregate_posts(read_posts(csv_path), universe, cfg)
    return build_panel(raw, cfg)
