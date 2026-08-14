"""Sentiment scoring tuned for r/wallstreetbets.

Off-the-shelf VADER reads "to the moon 🚀🚀🚀" as perfectly neutral and treats
"fuck" as strongly negative, which is backwards on this subreddit. So we do two
things:

* extend the VADER lexicon with WSB vocabulary (rockets, tendies, bagholder,
  drilling, ...) so the tone score means something here, and
* score *stance* separately -- calls vs puts, long vs short -- because a post
  can be furious in tone and still be a bullish position.

Tone and stance end up as separate features; the model decides how to use them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

# VADER valences run -4..+4.
WSB_LEXICON: dict[str, float] = {
    # bullish slang
    "moon": 2.6, "mooning": 2.8, "moonshot": 2.5, "tendies": 2.6,
    "tendie": 2.4, "squeeze": 1.6, "gamma": 0.6, "gamma squeeze": 2.6,
    "short squeeze": 2.6, "diamond hands": 2.9, "diamondhands": 2.9,
    "hodl": 2.2, "hold the line": 2.4, "holding the line": 2.4,
    "buy the dip": 2.0, "btfd": 2.2, "bullish": 2.6, "bull": 1.6,
    "calls": 1.6, "yolo": 1.4, "printing": 1.8, "printer": 1.2,
    "stonks": 1.2, "stonk": 1.0, "undervalued": 2.0, "oversold": 1.2,
    "breakout": 1.8, "ripping": 2.0, "ripped": 1.4, "green": 1.2,
    "gains": 2.2, "gain porn": 2.4, "ath": 1.6, "all time high": 1.8,
    "apes": 1.4, "ape": 1.0, "retard strength": 1.6, "to the moon": 3.0,
    "buy": 1.2, "buying": 1.2, "accumulate": 1.2, "load up": 1.6,
    "rocket": 2.4, "rockets": 2.4, "lambo": 2.0, "infinity pool": 1.8,
    "hold": 1.0, "holding": 0.8, "long": 0.9, "leaps": 0.8,

    # bearish slang
    "bagholder": -2.4, "bagholding": -2.4, "bagholders": -2.4,
    "bags": -1.4, "holding bags": -2.2, "drilling": -2.2, "drill": -1.6,
    "dumping": -2.2, "dump": -1.8, "dumped": -1.8, "tanking": -2.4,
    "tanked": -2.2, "crater": -2.4, "cratering": -2.6, "bearish": -2.6,
    "bear": -1.4, "bears": -1.2, "puts": -1.6, "shorting": -1.6,
    "overvalued": -1.8, "overbought": -1.0, "pump and dump": -2.6,
    "bull trap": -2.2, "dead cat": -2.0, "dead cat bounce": -2.2,
    "loss porn": -2.0, "rug pull": -2.8, "rugpull": -2.8, "rugged": -2.4,
    "delisted": -2.6, "dilution": -2.0, "diluted": -1.6, "halted": -1.2,
    "red": -1.0, "bleeding": -2.0, "capitulation": -2.0, "guh": -2.4,
    "wiped out": -2.6, "margin call": -2.6, "assigned": -0.8,
    "sell": -1.2, "selling": -1.2, "sold": -0.8, "paper hands": -1.8,
    "paperhands": -1.8, "bust": -1.8, "scam": -2.6,

    # WSB profanity is punctuation, not sentiment -- neutralise it
    "fuck": 0.0, "fucking": 0.0, "shit": 0.0, "damn": 0.0, "hell": 0.0,
    "retard": 0.0, "retarded": 0.0, "autist": 0.0, "autists": 0.0,
    "gay": 0.0, "idiot": -0.4, "stupid": -0.4,

    # emoji
    "🚀": 2.8, "🌙": 1.8, "💎": 2.0, "🙌": 1.4, "🦍": 1.2, "🤑": 2.0,
    "📈": 2.0, "💰": 1.8, "🔥": 1.4, "🌈": -0.6, "🐻": -1.8, "📉": -2.2,
    "💩": -1.8, "😭": -1.6, "🤡": -1.4, "⚰️": -2.2, "🧻": -1.6,
}

_BULL_PATTERNS = (
    r"\bcalls?\b", r"\bbuy(?:ing)?\b", r"\bbought\b", r"\blong(?:ing)?\b",
    r"\bhold(?:ing)?\b", r"\bhodl\b", r"\badd(?:ing|ed)?\s+more\b",
    r"\bloaded\b", r"\bload(?:ing)?\s+up\b", r"\bdiamond\s*hands?\b",
    r"\bmoon\b", r"\bsqueeze\b", r"🚀", r"💎", r"\bbullish\b", r"\bleaps?\b",
    r"\bshares\s+of\b", r"\bposition\s+in\b", r"\baccumulat",
)
_BEAR_PATTERNS = (
    r"\bputs?\b", r"\bshort(?:ing)?\b", r"\bsell(?:ing)?\b", r"\bsold\b",
    r"\bdump(?:ing|ed)?\b", r"\bbearish\b", r"\bcrash", r"\bexit(?:ing|ed)?\b",
    r"\btrim(?:ming|med)?\b", r"\btake\s+profits?\b", r"\bpaper\s*hands?\b",
    r"\bbag\s*hold", r"📉", r"🐻", r"\boverval",
)

_BULL_RE = re.compile("|".join(_BULL_PATTERNS), re.IGNORECASE)
_BEAR_RE = re.compile("|".join(_BEAR_PATTERNS), re.IGNORECASE)

_ROCKET_RE = re.compile("[🚀]")
_DIAMOND_RE = re.compile("💎")
_BEARISH_EMOJI_RE = re.compile("[📉🐻🧻]")
_URL_RE = re.compile(r"https?://\S+")
_QUOTE_RE = re.compile(r"^&gt;.*$", re.MULTILINE)

# Long posts blow past VADER's usefulness; the opening is where the thesis is.
_MAX_CHARS = 4000


@dataclass(frozen=True)
class Score:
    tone: float          # VADER compound, -1..1
    stance: float        # -1 (puts/short) .. +1 (calls/long)
    stance_evidence: int  # how many directional cues fired
    rockets: int
    diamonds: int
    bear_emoji: int
    n_chars: int


@lru_cache(maxsize=1)
def _analyzer() -> SentimentIntensityAnalyzer:
    an = SentimentIntensityAnalyzer()
    an.lexicon.update(WSB_LEXICON)
    return an


def clean(text: str) -> str:
    if not text:
        return ""
    text = _URL_RE.sub(" ", text)
    text = _QUOTE_RE.sub(" ", text)
    return text.strip()


def score_text(title: str, body: str) -> Score:
    """Score a post. The title is weighted double -- it carries the thesis."""
    t = clean(title)
    b = clean(body)[:_MAX_CHARS]
    joined = f"{t}\n{b}"

    an = _analyzer()
    tone_t = an.polarity_scores(t)["compound"] if t else 0.0
    tone_b = an.polarity_scores(b)["compound"] if b else 0.0
    if t and b:
        tone = (2.0 * tone_t + tone_b) / 3.0
    else:
        tone = tone_t or tone_b

    bull = len(_BULL_RE.findall(joined))
    bear = len(_BEAR_RE.findall(joined))
    evidence = bull + bear
    stance = (bull - bear) / evidence if evidence else 0.0

    return Score(
        tone=tone,
        stance=stance,
        stance_evidence=evidence,
        rockets=len(_ROCKET_RE.findall(joined)),
        diamonds=len(_DIAMOND_RE.findall(joined)),
        bear_emoji=len(_BEARISH_EMOJI_RE.findall(joined)),
        n_chars=len(joined),
    )
