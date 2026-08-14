"""Pull ticker symbols out of Reddit titles and bodies.

Three acceptance tiers, in descending confidence:

1. ``$GME``            -- explicit cashtag, accepted on sight
2. ``GME``             -- bare token, in the universe, not a word-like symbol
3. ``ON``/``IT``/``A`` -- bare token, in the universe but word-like, accepted
                          only when it is *immediately* wrapped in ticker
                          grammar ("bought IT calls", "shares of A")

Tier 3 is deliberately narrow. A window-based "is there finance vocabulary
nearby" test does not work on this corpus -- every post is about finance, so a
loose window promotes THE, TO, WE and HOLD into the panel. Only tight adjacency
separates a symbol from a pronoun.

Everything else is dropped. The tier is reported per mention so downstream
features can weight a `$`-tagged mention above a heuristic one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .universe import LEVEL_HARD, LEVEL_PLAIN, Universe

# A candidate is 1-5 uppercase letters (optionally with a dot, e.g. BRK.B),
# not glued to other word characters, optionally prefixed with `$`.
_CANDIDATE = re.compile(
    r"(?<![A-Za-z0-9_])(\$?)([A-Z]{1,5}(?:\.[A-Z])?)(?![A-Za-z0-9_])"
)

# Ticker grammar that may follow an ambiguous symbol: "IT calls", "A 150c".
_RIGHT_CUE = re.compile(
    r"^[\s\-:,]{0,3}(?:"
    r"calls?|puts?|shares?|stock|holders?|squeeze|earnings|leaps?|warrants?|"
    r"gang|apes?|moon(?:ing)?|to\s+the\s+moon|"
    r"\$\s?\d|\d{1,5}(?:\.\d+)?\s?[cp]\b|\d{1,3}(?:\.\d+)?%"
    r")\b",
    re.IGNORECASE,
)

# ...and grammar that may precede it: "shares of A", "long IT".
_LEFT_CUE = re.compile(
    r"(?:"
    r"shares?\s+(?:of|in)|bought|buying|sold|selling|holding|hold|"
    r"long|short(?:ing)?|ticker|position\s+in|calls?\s+on|puts?\s+on|"
    r"bullish\s+on|bearish\s+on|invest(?:ed|ing)?\s+in|yolo(?:ed|ing)?\s+(?:into|in)?"
    r")[\s:,\-]{1,3}$",
    re.IGNORECASE,
)

# How much text either side of the token the adjacency tests may look at.
_CUE_WINDOW = 24

TIER_CASHTAG = 3
TIER_BARE = 2
TIER_CUED = 1


@dataclass(frozen=True)
class Mention:
    symbol: str
    tier: int
    in_title: bool
    count: int


def _has_cue(text: str, start: int, end: int) -> bool:
    before = text[max(0, start - _CUE_WINDOW):start]
    after = text[end:end + _CUE_WINDOW]
    return bool(_RIGHT_CUE.match(after) or _LEFT_CUE.search(before))


def _scan(text: str, universe: Universe) -> dict[str, tuple[int, int]]:
    """Return ``{symbol: (best_tier, count)}`` for one blob of text."""
    found: dict[str, tuple[int, int]] = {}
    if not text:
        return found

    for m in _CANDIDATE.finditer(text):
        dollar, sym = m.group(1), m.group(2)
        if sym not in universe:
            continue

        level = universe.level(sym)
        if dollar:
            tier = TIER_CASHTAG
        elif level == LEVEL_PLAIN:
            tier = TIER_BARE
        elif level != LEVEL_HARD and _has_cue(text, m.start(2), m.end(2)):
            tier = TIER_CUED
        else:
            continue

        prev_tier, prev_count = found.get(sym, (0, 0))
        found[sym] = (max(prev_tier, tier), prev_count + 1)

    return found


def extract(title: str, body: str, universe: Universe) -> list[Mention]:
    """Extract mentions from a post, preferring evidence found in the title."""
    title_hits = _scan(title or "", universe)
    body_hits = _scan(body or "", universe)

    symbols = set(title_hits) | set(body_hits)
    mentions: list[Mention] = []
    for sym in symbols:
        t_tier, t_count = title_hits.get(sym, (0, 0))
        b_tier, b_count = body_hits.get(sym, (0, 0))
        mentions.append(
            Mention(
                symbol=sym,
                tier=max(t_tier, b_tier),
                in_title=t_count > 0,
                count=t_count + b_count,
            )
        )

    # Title mentions first, then stronger evidence, then chattier mentions --
    # this is the order `max_tickers_per_post` truncates against.
    mentions.sort(key=lambda m: (m.in_title, m.tier, m.count), reverse=True)
    return mentions


def primary_symbol(mentions: list[Mention]) -> str | None:
    return mentions[0].symbol if mentions else None
