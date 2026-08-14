"""The set of symbols we are willing to recognise in free text.

Ticker extraction on Reddit is mostly a precision problem. `$GME` is
unambiguous, but a bare `A`, `ON`, `IT`, `DD` or `RH` is English (or WSB
jargon) far more often than it is a symbol. So the extractor works against a
whitelist, and the whitelist is split into two tiers:

* plain symbols  -- accepted as a bare all-caps token
* soft-ambiguous -- word-like, but plausible as a retail trade (WISH, RIDE,
                    OPEN). Accepted bare only inside tight ticker grammar.
* hard-ambiguous -- English function words, single letters and broker slang
                    that happen to be listed (THE, TO, A, DD, RH, HOLD).
                    Accepted only with an explicit `$` prefix.

The default universe covers the names that actually traded in r/wallstreetbets
during the dataset window plus the usual large caps. Swap it out with
`--universe path.csv` (one symbol per line, or a CSV with a `symbol` column)
when you point the pipeline at a different period.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

_CORE = """
AAL AAPL ABBV ABNB ABT ACB ADBE AEO AFRM AG AGC AHT AI AJAX AKAM AMAT AMC AMD
AMRS AMZN ANY APHA APPS APRN ARKK ARKG ARVL ASO ASTS ATOS AUY AVGO AXP AZN
BA BABA BAC BB BBBY BBIG BBY BCRX BFT BGS BIDU BILI BIOL BLDP BLNK BLIAQ BMY
BNGO BNTX BP BRK.B BTBT BYND BZUN
CAT CCIV CCL CCXI CDEV CEI CGC CHPT CIDM CLF CLNE CLOV CLSK CMG CMPS CODX COIN
COST CPE CRBP CRIS CRM CRSR CRSP CSCO CTRM CVNA CVS CVX CZR
DAL DASH DDD DDOG DFEN DIS DKNG DKS DM DNN DPW DRIP DVN
EA EBAY EBON EH ENPH EOSE ETSY EXPR
FB FCEL FCX FDX FIZZ FSLR FSR FTCH FUBO FUV
GDX GDXJ GE GEVO GILD GLD GM GME GOEV GOGO GOLD GOOG GOOGL GPRO GRWG GSAT GTT
GUSH GVSI
HD HEAR HGEN HIMS HMHC HOOD HTZ HUYA HYLN
IBIO IBM IDEX INO INTC IPOB IPOC IPOD IPOE IPOF IQ IRBT IRNT ITRM IVR
JAGX JBLU JD JMIA JNJ JNUG JPM JWN
KMI KO KODK KOSS KTOS
LAC LAZR LCID LI LKNCY LMND LMT LOW LRCX LULU LUMN LUV LYFT
MA MARA MCD MDLZ META MGM MMAT MRK MRNA MRO MRVL MSFT MSTR MT MU MVIS
NAK NAKD NBEV NCLH NEE NET NFLX NIO NKE NKLA NNDM NOK NOVA NRZ NTES NUE NVAX
NVDA NXTD
OCGN OEG OGI OPEN OPK ORCL OSTK OZSC
PAAS PACB PDD PENN PEP PFE PG PINS PLBY PLL PLTR PLUG PPSI PRPL PSTH PTON PYPL
QCOM QQQ QS
RCL RDBX RDS.A RIDE RIG RIOT RKT RMO ROKU ROOT RTX RYCEY
SAVA SAVE SBUX SDC SENS SESN SHIP SHOP SI SIRI SKLZ SKT SLB SLV SNAP SNDL SNOW
SOFI SOLO SOS SPCE SPI SPWR SPY SQ SRAC SRNE STPK SUNW SVS SXTC
TAN TDOC TELL TGT TIGR TLRY TMUS TQQQ TRCH TRVG TSLA TSM TTCF TTD TTWO TWTR
TXMD TXN
UAL UAVS UBER UCO UEC UNG UPS UPST URA USO UUUU UVXY UWMC UXIN
VALE VERB VIAC VIR VIX VIXY VLDR VOO VRM VS VTI VUZI VXX VXRT VYGVF
WEN WFC WISH WKHS WMT WPG WWE WYNN
XELA XL XLE XLF XOM XPEV XSPA
YALA YOLO YY
ZM ZNGA ZOM ZS ZSAN
"""

# Word-like tickers that retail actually traded in this era. A bare mention is
# believable, but only when it sits inside ticker grammar.
_SOFT_AMBIGUOUS = """
AMP APE CAR CASH CAT CD DIP EAT EYE FAST FREE FUN GAIN GOOD GRAB HEAR HIGH HIT
HOME HOPE HUGE HUT ICE INFO JOB KEY LAND LIFE LINE LIVE LOVE LOW MAN MAX MOVE
NEW NEXT NICE OPEN PAY PLAN PLAY PLUS PRO PUSH REAL RIDE RISE ROOT RUN SAFE
SAVE SEE STAY STOP SUN TEAM TELL TOP TRUE TV WELL WISH WORK
"""

# English function words, single letters and broker/board shorthand that also
# happen to be listed symbols. In this corpus they are almost never the stock,
# so they are only ever accepted as an explicit cashtag.
_HARD_AMBIGUOUS = """
A AA AI ALL AM AN ANY ARE AT B BE BIG BIT BJ BUY C CAN CEO D DD DM DR E EA EDIT
EOD ET EV EVER F FOR G GO HAS HD HE HI HOLD IF II IN IPO IQ IT ITM IV LIKE LONG
M ME MO MOON MX NO NOW OFF OK ON ONE ONLY OR OTM OUT P PM R RH S SELL SO T THE
TO TWO U UK UP US USA VS W WE WHAT X Y YES YOU
"""

# WSB jargon and internet noise that must never resolve to a symbol even when a
# real listing shares the letters.
HARD_BLOCK = {
    "ATH", "ATM", "AWS", "BTC", "CAD", "CDN", "CFO", "CNBC", "COVID", "DFV",
    "DTC", "EDGAR", "EOW", "EPS", "ETF", "ETH", "EU", "FAQ", "FBI", "FD", "FDA",
    "FINRA", "FOMO", "FUD", "GDP", "GG", "GMT", "HF", "HODL", "IANAL", "IMO",
    "IMHO", "IRA", "IRS", "ISO", "LEAP", "LFG", "LMAO", "LOL", "MM", "NFA",
    "NYSE", "OMG", "OP", "OTC", "PDT", "PE", "PR", "PS", "PST", "RIP", "ROI",
    "RSI", "SEC", "SI", "SMH", "SSR", "TA", "TD", "TIL", "TLDR", "TOS", "TTYL",
    "USD", "UTC", "WSB", "WTF", "YOLO", "YTD",
}

# Cue words that make a bare ambiguous token believable as a symbol.
FINANCE_CUES = (
    "share", "shares", "stock", "stocks", "call", "calls", "put", "puts",
    "option", "options", "strike", "expiry", "expiration", "ticker", "position",
    "long", "short", "squeeze", "float", "earnings", "dividend", "buy", "bought",
    "sell", "sold", "hold", "holding", "bag", "bags", "moon", "yolo", "dd",
    "premarket", "aftermarket", "close", "open", "gap", "volume", "market cap",
    "price target", "pt", "leaps", "warrant", "spac", "merger", "shorts",
)


def _split(blob: str) -> set[str]:
    return {tok for tok in blob.split() if tok}


LEVEL_PLAIN = 0
LEVEL_SOFT = 1
LEVEL_HARD = 2


@dataclass(frozen=True)
class Universe:
    symbols: frozenset[str]
    soft: frozenset[str]
    hard: frozenset[str]

    def __contains__(self, sym: str) -> bool:
        return sym in self.symbols

    def level(self, sym: str) -> int:
        if sym in self.hard:
            return LEVEL_HARD
        if sym in self.soft:
            return LEVEL_SOFT
        return LEVEL_PLAIN

    def __len__(self) -> int:
        return len(self.symbols)


def _assemble(core: Iterable[str], soft: Iterable[str], hard: Iterable[str]) -> Universe:
    hard_set = set(hard) - HARD_BLOCK
    soft_set = (set(soft) - HARD_BLOCK) - hard_set
    symbols = ((set(core) | soft_set | hard_set) - HARD_BLOCK)
    return Universe(frozenset(symbols), frozenset(soft_set), frozenset(hard_set))


def default_universe() -> Universe:
    return _assemble(_split(_CORE), _split(_SOFT_AMBIGUOUS), _split(_HARD_AMBIGUOUS))


def universe_from_symbols(symbols: Iterable[str]) -> Universe:
    """Classify an arbitrary symbol list against the built-in ambiguity sets."""
    syms = {s.strip().upper() for s in symbols if s and s.strip()} - HARD_BLOCK
    builtin_soft = _split(_SOFT_AMBIGUOUS)
    builtin_hard = _split(_HARD_AMBIGUOUS)
    # Unknown one- and two-letter symbols default to the strictest tier.
    hard = {s for s in syms if s in builtin_hard or len(s.rstrip(".")) <= 2}
    soft = {s for s in syms if s in builtin_soft} - hard
    return _assemble(syms, soft, hard)


def load_universe(path: str | Path | None) -> Universe:
    """Read a custom universe, falling back to the built-in one."""
    if path is None:
        return default_universe()

    p = Path(path)
    raw: list[str] = []
    with p.open(newline="", encoding="utf-8") as fh:
        sniff = fh.readline()
        fh.seek(0)
        if "," in sniff and "symbol" in sniff.lower():
            for row in csv.DictReader(fh):
                key = next((k for k in row if k and k.lower() == "symbol"), None)
                if key and row[key]:
                    raw.append(row[key])
        else:
            raw = [line.strip() for line in fh]

    if not raw:
        raise ValueError(f"{p} contained no symbols")
    return universe_from_symbols(raw)
