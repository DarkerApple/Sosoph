"""
Static sanity check for the generated .nlogo files.

No NetLogo installation is required (and none is available in every
environment), so this cannot prove the models run. It does catch the classes of
error that are easy to introduce when generating NetLogo source by hand:
unbalanced brackets, procedures that are never closed, identifiers used in code
that no slider or declaration defines, and a malformed section layout.

Run: python3 validation/check_nlogo.py
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent

# NetLogo primitives referenced by this model (not exhaustive for the language,
# just everything these two files actually use).
PRIMITIVES = set("""
ask asks let set report to to-report end if ifelse ifelse-value while repeat foreach
map filter sort sort-by sort-on reduce n-of one-of max-one-of min-one-of with
count any? all? not and or empty? length item first last but-first lput fput
list sentence range remove-duplicates replace-item member? position
sum mean median max min variance standard-deviation abs floor ceiling round
precision sqrt exp ln log sin cos tan random random-float random-normal
turtles patches links myself self other nobody who breed shape color size
neighbors4 standard-deviation
hidden? xcor ycor pxcor pycor pcolor label heading distance distancexy towards
in-radius neighbors patch-here patch-at move-to setxy face forward fd back
die hatch create-turtles clear-all reset-ticks tick ticks stop
scale-color true false nl print show word is-number? is-string?
turtle patch link both-ends other-end end1 end2 link-neighbors my-links
turtle-set patch-set link-set no-turtles no-patches
plot plotxy set-current-plot histogram
globals patches-own turtles-own breed-own extensions
directed-link-breed undirected-link-breed folk-own camps-own
mod random-xcor random-ycor min-pxcor max-pxcor min-pycor max-pycor
""".split())

# breed- and link-breed-derived primitives that NetLogo generates for us
GENERATED = set("""
folk person camps camp marriages marriage births birth
create-folk create-camps hatch-folk hatch-camps
create-marriage-with create-marriages-with my-marriages
create-birth-from create-birth-to create-births-from create-births-to
out-birth-neighbors in-birth-neighbors my-births my-in-births my-out-births
""".split())


def sections(path):
    return path.read_text().split("\n@#$#@#$#@\n")


def check(path):
    problems = []
    # NOTE: this split mis-handles adjacent separators (an empty section), so
    # it is used only to reach the code and interface text. check_structure()
    # below validates the section layout properly.
    secs = sections(path)
    code = secs[0]

    # --- bracket and paren balance
    for opener, closer in (("[", "]"), ("(", ")")):
        depth = 0
        for line_no, line in enumerate(code.splitlines(), 1):
            stripped = re.sub(r";.*$", "", line)
            for ch in stripped:
                if ch == opener:
                    depth += 1
                elif ch == closer:
                    depth -= 1
                    if depth < 0:
                        problems.append(f"line {line_no}: unmatched '{closer}'")
                        depth = 0
        if depth:
            problems.append(f"unbalanced '{opener}': {depth} left open")

    # --- procedures open and close
    opens = re.findall(r"^\s*(to|to-report)\s+([\w?<>=*!+/-]+)", code, re.M)
    ends = len(re.findall(r"^\s*end\s*$", code, re.M))
    if len(opens) != ends:
        problems.append(f"{len(opens)} procedures but {ends} 'end' lines")

    # --- collect every name the code defines
    defined = {name for _, name in opens}
    defined |= GENERATED
    for block in re.findall(r"^(globals|patches-own|turtles-own|folk-own|camps-own)\s*\[(.*?)\]",
                            code, re.M | re.S):
        defined |= set(block[1].split())
    # sliders and other interface widgets define globals too
    iface = secs[1]
    # sliders, switches and choosers all define a global
    for kind in ("SLIDER", "SWITCH", "CHOOSER", "INPUTBOX"):
        for m in re.finditer(rf"^{kind}\n(?:.*\n){{4}}([\w?-]+)\n", iface, re.M):
            defined.add(m.group(1))
    # local variables
    defined |= set(re.findall(r"\blet\s+([\w?-]+)", code))
    # anonymous-procedure arguments:  [ x -> ... ]  and  [ [a b] -> ... ]
    for grp in re.findall(r"\[([^\[\]]*)\]\s*->", code):
        defined |= set(grp.split())
    for grp in re.findall(r"\[\s*([\w?-]+)\s*->", code):
        defined.add(grp)
    # declared procedure parameters
    for grp in re.findall(r"^\s*(?:to|to-report)\s+[\w?-]+\s*\[([^\]]*)\]", code, re.M):
        defined |= set(grp.split())

    # --- every identifier used should be defined or a primitive
    body = re.sub(r";.*$", "", code, flags=re.M)
    body = re.sub(r'"[^"]*"', " ", body)
    used = set(re.findall(r"(?<![\w?-])([a-zA-Z][\w?-]*)", body))
    unknown = sorted(used - defined - PRIMITIVES)
    # NetLogo colour constants and a few keywords
    colours = {"black", "white", "gray", "grey", "red", "orange", "brown", "yellow",
               "green", "lime", "turquoise", "cyan", "sky", "blue", "violet",
               "magenta", "pink"}
    unknown = [u for u in unknown if u not in colours]
    if unknown:
        problems.append("identifiers not defined anywhere: " + ", ".join(unknown))

    # --- slider defaults must sit inside their range
    for m in re.finditer(
            r"^SLIDER\n\d+\n\d+\n\d+\n\d+\n([\w?-]+)\n[\w?-]+\n"
            r"([-\d.e]+)\n([-\d.e]+)\n([-\d.e]+)\n", iface, re.M):
        name, lo, hi, val = m.group(1), float(m.group(2)), float(m.group(3)), float(m.group(4))
        if not (lo <= val <= hi):
            problems.append(f"slider {name}: default {val} outside [{lo}, {hi}]")

    return problems


ok = True
for name in ("monogamy.nlogo", "polygyny.nlogo"):
    path = HERE / name
    problems = check(path)
    if problems:
        ok = False
        print(f"{name}: {len(problems)} problem(s)")
        for p in problems:
            print(f"   - {p}")
    else:
        print(f"{name}: OK")



# ---------------------------------------------------------------------------
# Structural comparison against a genuine NetLogo 6.4 model.
#
# The widget formats below were read out of NetLogo's own Sample Models rather
# than written from memory: each entry is the exact number of lines that widget
# type occupies. A wrong count, a blank line where a section should be empty,
# or scientific notation in a slider value all make NetLogo refuse the file
# with errors that do not name the real culprit.
# ---------------------------------------------------------------------------
WIDGET_LINES = {
    "GRAPHICS-WINDOW": 26,
    "BUTTON": 16,
    "SLIDER": 14,
    "MONITOR": 10,
    "SWITCH": 10,
    "CHOOSER": None,     # variable: depends on the number of choices
    "PLOT": None,        # variable: depends on the number of pens
    "TEXTBOX": 9,
}
PLOT_HEADER_LINES = 16   # up to and including the PENS line


def check_structure(path):
    problems = []
    raw = path.read_text()

    if not raw.endswith("@#$#@#$#@\n"):
        problems.append("file must end with a separator line")
    if "@#$#@#$#@\n\n@#$#@#$#@" in raw:
        problems.append("empty section written as a blank line; NetLogo needs "
                        "two adjacent separator lines")

    chunks = raw.split("@#$#@#$#@\n")
    # 11 sections plus the empty remainder after the final separator
    if len(chunks) != 12:
        problems.append(f"expected 11 sections, found {len(chunks) - 1}")

    for w in chunks[1].split("\n\n"):
        lines = [l for l in w.split("\n") if l != ""]
        if not lines:
            continue
        kind = lines[0]
        if kind not in WIDGET_LINES:
            problems.append(f"unknown widget type {kind!r}")
            continue
        want = WIDGET_LINES[kind]
        if kind == "PLOT":
            if len(lines) < PLOT_HEADER_LINES + 1:
                problems.append(f"PLOT block has {len(lines)} lines, "
                                f"needs at least {PLOT_HEADER_LINES + 1}")
            elif lines[PLOT_HEADER_LINES - 1] != "PENS":
                problems.append("PLOT block: line 16 must be 'PENS'")
        elif want is not None and len(lines) != want:
            problems.append(f"{kind} block has {len(lines)} lines, needs {want}")

        if kind == "SLIDER":
            for field in lines[7:11]:
                if "e" in field.lower():
                    problems.append(f"slider {lines[5]}: value {field!r} uses "
                                    f"scientific notation, which NetLogo "
                                    f"cannot parse")

    # the view's pixel extents must match patches x patch-size, plus the border
    gw = chunks[1].split("\n\n")[0].split("\n")
    if gw[0] == "GRAPHICS-WINDOW" and len(gw) == 26:
        left, top, right, bottom = (int(gw[i]) for i in (1, 2, 3, 4))
        psize = float(gw[7])
        minx, maxx, miny, maxy = (int(gw[i]) for i in (17, 18, 19, 20))
        wide = psize * (maxx - minx + 1)
        high = psize * (maxy - miny + 1)
        if abs((right - left) - wide) > 12 or abs((bottom - top) - high) > 12:
            problems.append(
                f"view is {right - left}x{bottom - top} px but "
                f"{maxx - minx + 1}x{maxy - miny + 1} patches at {psize} px "
                f"needs about {wide:.0f}x{high:.0f}")
    return problems


print()
for name in ("monogamy.nlogo", "polygyny.nlogo"):
    path = HERE / name
    problems = check_structure(path)
    if problems:
        ok = False
        print(f"{name} structure: {len(problems)} problem(s)")
        for p in problems:
            print(f"   - {p}")
    else:
        print(f"{name} structure: OK")
sys.exit(0 if ok else 1)
