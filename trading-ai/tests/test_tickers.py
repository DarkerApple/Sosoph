from sosoph_trader.tickers import TIER_BARE, TIER_CASHTAG, TIER_CUED, extract
from sosoph_trader.universe import default_universe, universe_from_symbols

U = default_universe()


def syms(title="", body=""):
    return {m.symbol for m in extract(title, body, U)}


def test_cashtag_and_bare_symbols_are_found():
    assert syms("$GME to the moon") == {"GME"}
    assert syms("GME and AMC squeeze") == {"GME", "AMC"}


def test_english_function_words_are_not_tickers():
    # THE, TO, A, IT, ON, US, WE and ALL are all real listings. In this corpus
    # they are English, and a naive extractor drags them into the panel.
    noise = "THE only way IT works is if WE ALL hold ON TO A position IN US"
    assert syms(noise) == set()


def test_wsb_jargon_never_resolves():
    assert syms("DD on the SI and the ATH, IMO YOLO FD") == set()


def test_hard_ambiguous_needs_a_cashtag():
    assert syms("I will HOLD forever") == set()
    assert syms("bought $HOLD yesterday") == {"HOLD"}


def test_soft_ambiguous_needs_ticker_grammar():
    # Bare and bare-with-distant-context are both rejected...
    assert syms("I really WISH this worked out for everyone here") == set()
    # ...but tight ticker grammar accepts it.
    assert syms("WISH calls printing") == {"WISH"}
    assert syms("bought RIDE shares") == {"RIDE"}


def test_tiers_are_reported():
    by_symbol = {m.symbol: m.tier for m in extract("$GME and PLTR and WISH calls", "", U)}
    assert by_symbol["GME"] == TIER_CASHTAG
    assert by_symbol["PLTR"] == TIER_BARE
    assert by_symbol["WISH"] == TIER_CUED


def test_title_flag_and_counts():
    mentions = {m.symbol: m for m in extract("GME update", "GME GME again", U)}
    assert mentions["GME"].in_title is True
    assert mentions["GME"].count == 3


def test_lowercase_is_ignored():
    assert syms("gme amc pltr") == set()


def test_symbols_glued_to_words_are_ignored():
    assert syms("GMEs GME_ xGME") == set()


def test_custom_universe_defaults_short_symbols_to_strict():
    u = universe_from_symbols(["ZZZZ", "QQ"])
    assert {m.symbol for m in extract("ZZZZ is up and QQ is down", "", u)} == {"ZZZZ"}
    assert {m.symbol for m in extract("$QQ is down", "", u)} == {"QQ"}
