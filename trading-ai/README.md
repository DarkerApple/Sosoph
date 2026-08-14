# WSB Trading AI

A research pipeline that turns the r/wallstreetbets post dump into a daily
cross-sectional trading signal, fits a model on it walk-forward, and simulates
a top-K portfolio against honest baselines.

```
reddit_wsb.csv ──► ticker extraction ──► sentiment ──► daily (session, symbol) panel
                                                              │
                              daily OHLCV ────────────────────┤
                                                              ▼
                                          labels + causal price features
                                                              │
                                     walk-forward fit ────────┤
                                                              ▼
                                     top-K portfolio, costed, vs baselines
```

## Quick start

```bash
pip install -r requirements.txt

# 1. Reddit CSV -> feature panel (cached to data/build/panel.csv)
python -m sosoph_trader features

# 2. Daily bars for every mentioned symbol (cached to data/prices/*.csv)
python -m sosoph_trader prices --prices stooq

# 3. Walk-forward fit + portfolio simulation
python -m sosoph_trader backtest --model gbm --top-k 5

# 4. Model vs every baseline, side by side
python -m sosoph_trader compare

# 5. Rank the newest session -- the one you could actually trade
python -m sosoph_trader signal --model gbm
```

Put the Reddit export at `data/raw/reddit_wsb.csv`, or pass `--reddit-csv`.
A 2,533-post sample spanning the full window ships in `samples/` for smoke
tests (bodies truncated to 1,200 characters to keep the repo small), along with
`samples/panel_full_2021.csv` — the feature panel built from the complete
53,187-post dump, so you can inspect real output without the 42 MB input.

Global flags work on either side of the subcommand.

## What the pipeline actually does

### 1. Ticker extraction (`tickers.py`, `universe.py`)

This is the part that decides whether anything downstream means anything.
Naive "all-caps token" extraction on this corpus returns `THE`, `TO`, `A`,
`DD`, `HOLD` and `WE` in the top 15 "tickers" — every one of them a real
listing, none of them the stock. So symbols are matched against a whitelist
split into three tiers:

| tier | example | accepted when |
|---|---|---|
| plain | `PLTR` | bare token is enough |
| soft-ambiguous | `WISH`, `RIDE`, `OPEN` | inside tight ticker grammar (`WISH calls`, `shares of RIDE`) |
| hard-ambiguous | `THE`, `TO`, `A`, `DD`, `RH` | only with an explicit `$` prefix |

A window-based "is there finance vocabulary nearby" test does *not* work here,
because every post is about finance. Only tight adjacency separates a symbol
from a pronoun. WSB jargon that collides with real listings (`SI`, `ATH`,
`YOLO`, `FD`, `TA`) is blocked outright.

On the full dump this yields 44% of posts naming a known ticker, and a top-30
that is entirely real 2021 retail names: GME, AMC, BB, NOK, PLTR, RKT, UWMC,
TSLA, SNDL, SPCE, NAKD, WISH, CLOV, MVIS, CLNE, SOFI...

### 2. Sentiment (`sentiment.py`)

Stock VADER scores "to the moon 🚀🚀🚀" as exactly neutral and reads "fuck" as
strongly negative — backwards on this subreddit. The lexicon is extended with
~120 WSB terms (tendies, bagholding, drilling, diamond hands, rocket/bear
emoji) and board profanity is neutralised.

*Tone* and *stance* are scored separately, because a post can be furious in
tone and still be a bullish position. Stance counts directional cues (calls vs
puts, long vs short, buying vs dumping) and normalises to −1..+1.

### 3. Feature panel (`features.py`)

One row per (trading session, symbol), with two families:

- **attention** — mentions, share of the day's board, engagement-weighted
  mentions, z-score against the symbol's own trailing baseline, acceleration,
  5-day totals, freshness
- **opinion** — tone, stance, bull/bear share, rocket and diamond rates,
  cashtag share, title share, and each of those relative to the symbol's own
  trailing average and to the board that day

Every rolling statistic is `shift(1)`-ed, so a Tuesday z-score never contains
Tuesday. Symbols are densified onto every session first — a name nobody
mentioned has *zero* mentions, which is data, not a gap.

### 4. Sessions and timing (`sessions.py`)

Everything is indexed by the session whose bar a post is allowed to influence.
A post before the afternoon cutoff (default 15:45 ET) informs that session;
anything later — after the cutoff, overnight, weekend, holiday — rolls to the
next one. The NYSE calendar (including Good Friday and observed-day rules) is
computed locally, so the pipeline runs offline.

### 5. Labels and execution (`dataset.py`)

| `--execution` | decide with | enter at | label |
|---|---|---|---|
| `close` (default) | text before the cutoff | that session's close | close → next close |
| `open` | text before the cutoff | next open | next open → following open |

Under `close`, price features are lagged a full session — you do not know
today's close before you trade it. Under `open`, tonight's close is fair game
because it prints before the entry.

`--label cross_sectional` (default) asks "will this name beat the median name
being discussed today", which strips out market beta. `excess` compares to SPY;
`absolute` just asks for a positive return.

### 6. Walk-forward fitting (`model.py`)

No random train/test split — it is a time series. Fit on the past, score the
next block of sessions, roll forward. An embargo of 2 sessions sits between
train and test, because a training row labelled at session *t* already contains
the outcome of *t+1*.

Baselines are first-class, and the comparison is the point:

- `buzz` — rank by mention z-score
- `buzz_accel` — rank by day-over-day mention acceleration
- `share` — rank by share of the day's board
- `tone` / `stance` — rank by sentiment
- `contrarian_buzz` — the inverse of `buzz`
- plus the equal-weight "buy everything WSB is talking about" portfolio and SPY

A gradient-boosted model that cannot beat "rank by mention z-score" is not
worth deploying.

### 7. Backtest (`backtest.py`)

Top-K by score, equal weight, one-session hold, costs charged on realised L1
turnover (`--cost-bps`, default 10). Reports total/annualised return, vol,
Sharpe, max drawdown, hit rate, turnover, plus rank IC per session and a
bootstrap p-value on the mean daily return — because with ~100 sessions a
good-looking Sharpe is routine noise.

## Price data

| provider | notes |
|---|---|
| `local` | reads `data/prices/<SYMBOL>.csv`. Always available |
| `stooq` | free daily CSV, no key |
| `yahoo` | Yahoo chart JSON, no key |
| `synthetic` | **generated random walks, not market data** |

Downloads are cached as CSV, so the second run is offline. Any CSV with
`Date,Open,High,Low,Close,Volume` (and optionally `Adj Close`) drops straight
into `data/prices/`.

`synthetic` exists so the training and backtest code can be exercised where
market-data egress is blocked. Every number it produces is a plumbing check and
is labelled as such in the output. **Do not read performance off a synthetic
run.**

## Honest limitations

Read these before believing any number this thing prints.

1. **No real backtest has been run in this repo.** The environment it was built
   in blocks egress to every market-data host, so the training and portfolio
   code has only been exercised against synthetic random-walk prices. The
   pipeline is verified to *run*; its edge is unmeasured. Run
   `python -m sosoph_trader compare --prices stooq` somewhere with network
   access to find out whether there is anything there.
2. **The dataset is one regime, and a strange one.** 2021-01-28 → 2021-08-16,
   dominated by the GME squeeze. 15,694 of the 53,187 posts are from a single
   day. Whatever the model learns is a fact about that regime.
3. **The cross-section is thin.** A median of ~8 names clear the mention
   threshold per session, and GME alone is ~55% of all mentions. Top-K
   selection has little to choose from, and the portfolio inherits most of its
   variance from one or two names.
4. **~120 sessions is not enough to estimate a Sharpe.** The bootstrap p-value
   in the report exists to make that concrete.
5. **The scrape is incomplete and non-uniform.** Post volume falls from ~15k on
   Jan 29 to ~50/day by August. Mention *counts* are therefore confounded with
   collection intensity, which is why the panel leans on share-of-board and
   per-symbol z-scores rather than raw counts.
6. **Survivorship and corporate actions.** The universe is a hand-curated list
   of names that were being discussed; symbols that delisted or were renamed
   are handled only as well as the price provider handles them.
7. **The simulation is optimistic about execution.** Equal-weight fills at the
   close with a flat 10 bps assumes away slippage, borrow, halts and gaps — on
   exactly the kind of names that gapped 100% and halted repeatedly in 2021.
8. **A backtest is not a track record**, and this is a research tool, not
   investment advice.

## Layout

```
sosoph_trader/
  config.py     paths, tunable defaults
  universe.py   symbol whitelist + ambiguity tiers
  tickers.py    three-tier extraction
  sentiment.py  VADER + WSB lexicon, tone and stance
  ingest.py     streaming CSV reader
  sessions.py   NYSE calendar, post -> session assignment
  features.py   causal (session, symbol) panel
  prices.py     OHLCV providers with on-disk cache
  dataset.py    join, labels, causal price features
  model.py      walk-forward fitting, baselines, live scoring
  backtest.py   portfolio simulation and metrics
  report.py     text reports
  cli.py        command line
tests/          32 tests, including a no-lookahead property test
samples/        small Reddit sample + the full-dump feature panel
```

## Tests

```bash
python -m pytest tests -q
```

The one worth knowing about is
`test_features_do_not_change_when_the_future_is_deleted`: the panel is rebuilt
with the last 15 sessions of posts deleted, and every earlier feature value
must come out identical. That is the property that makes the backtest mean
anything.
