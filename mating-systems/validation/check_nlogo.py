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
    secs = sections(path)
    if len(secs) < 11:
        problems.append(f"expected 11+ sections, found {len(secs)}")
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
    for m in re.finditer(r"^SLIDER\n(?:.*\n){4}([\w?-]+)\n", iface, re.M):
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
sys.exit(0 if ok else 1)
