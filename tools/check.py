#!/usr/bin/env python3
"""check.py — does the folder agree with itself?

Run before pushing:

    python3 tools/check.py          # everything, exits 1 on any failure
    python3 tools/check.py --quick  # skip the node syntax pass

The hub has no build step, so nothing catches a renamed file, a stale byte
count, a nav link to a page that was never written, or a script looking for an
id that was edited out of the HTML. This does. Every check prints the file and
the line, because a report that says "something is wrong" is a new chore and
not a fix.
"""
import glob
import html
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUICK = "--quick" in sys.argv

MY_PAGES = ["index.html", "games.html", "player.html", "eagler.html", "notepad.html",
            "sketch.html", "search.html", "brief.html", "404.html"]
NAV = ["index.html", "games.html", "player.html", "eagler.html", "notepad.html",
       "sketch.html", "search.html", "brief.html"]
NEED = MY_PAGES + ["style.css", "Eaglercraft.html", "README.md", "img/README.md",
                  "js/index-data.js", "js/directory.js", "js/games.js",
                  "js/player-logic.js", "js/player.js", "js/notepad.js", "js/sketch.js",
                  "tools/test-logic.js", "tools/bytes.js", "tools/serve.py",
                  "tools/test-dom.js", "tools/check.py", ".nojekyll"]
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
        "param", "source", "track", "wbr"}
# outbound <a> links are fine; a subresource is not
OK_EXTERNAL = ("eaglercraft.com", "github.com", "w3.org", "developer.mozilla.org",
               "en.wikipedia.org", "i.imgur.com")
FORBIDDEN = [
    (r"lorem", "lorem ipsum survived"),
    (r"DIT\.EDIT", "the placeholder masthead edit control survived"),
    (r"temp\.temp", "placeholder person's name survived"),
    (r"\bTODO\b", "TODO left in a shipped page"),
    (r"\bFIXME\b", "FIXME left in a shipped page"),
    (r"Your Company|Acme|Example Co", "template company name survived"),
    (r"\bplaceholder image\b|\bcoming soon\b", "placeholder-image talk survived"),
    (r"href=\"#\"\s*>", "a link that goes nowhere"),
]

fails, warns = [], []


def fail(check, where, msg):
    fails.append((check, where, msg))


def warn(check, where, msg):
    warns.append((check, where, msg))


def read(path):
    with open(os.path.join(ROOT, path), "r", encoding="utf-8") as fh:
        return fh.read()


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def stripped(text, css=True):
    """Comments out, newlines kept so line numbers stay honest.

    css=False is what markup gets: an input carrying accept="image/*" opens
    something that looks exactly like the start of a block comment, and
    everything after it vanishes from the pass. That trap ate a drawing box.
    """
    text = re.sub(r"<!--.*?-->", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    if css:
        text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return text


def visible(text):
    """HTML minus script and style bodies.

    Inline JS is full of strings like '<div class="dir-row">'. Counting those as
    markup makes every nesting check cry wolf, so they come out here.
    """
    text = re.sub(r"<script\b[^>]*>.*?</script>", "", text, flags=re.S | re.I)
    text = re.sub(r"<style\b[^>]*>.*?</style>", "", text, flags=re.S | re.I)
    return text


def get_data(text, name):
    """Read a `var NAME = [...]` literal out of a data file without a JS engine."""
    m = re.search(r"var %s = (\[.*?\]|\{.*?\})\s*;" % name, text, flags=re.S)
    if not m:
        return None
    src = m.group(1)
    src = src.replace("\\'", "'")
    src = re.sub(r"([\{\,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:", r'\1"\2":', src)
    src = re.sub(r",(\s*[\]\}])", r"\1", src)
    try:
        return json.loads(src)
    except Exception as exc:  # noqa: BLE001
        fail("data", "js/index-data.js", "%s could not be read as data (%s)" % (name, exc))
        return None


# ---------------------------------------------------------------- presence
def check_presence():
    for rel in NEED:
        p = os.path.join(ROOT, rel)
        if not os.path.isfile(p):
            fail("presence", rel, "expected file is missing")
        elif os.path.getsize(p) == 0 and not rel.endswith(".nojekyll"):
            fail("presence", rel, "file is empty")
    lower = os.path.join(ROOT, "eaglercraft.html")
    if os.path.exists(lower) and not on_case_fs():
        fail("presence", "eaglercraft.html",
             "a lowercase copy sits next to Eaglercraft.html — on a case-insensitive checkout "
             "(Windows, macOS) one overwrote the other")
    for stray in glob.glob(os.path.join(ROOT, "*.png")) + glob.glob(os.path.join(ROOT, "*.jpg")):
        warn("presence", os.path.basename(stray),
             "an image in the root: the hub keeps drawings in img/ so the manifest stays honest")


def on_case_fs():
    probe = os.path.join(ROOT, "Eaglercraft.html")
    return os.path.isfile(probe.replace("Eaglercraft", "eaglercraft"))


# ---------------------------------------------------------------- html
def check_html():
    for page in MY_PAGES:
        try:
            raw = read(page)
        except OSError:
            continue
        text = visible(stripped(raw, css=False))
        where = lambda pos: "%s:%d" % (page, line_of(text, pos))  # noqa: E731

        if not text.lower().startswith("<!doctype html>") and "<!doctype html>" not in raw[:80].lower():
            fail("html", page, "no doctype on the first line")

        stack, ids = [], {}
        for m in re.finditer(r"<(/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>", text):
            close, tag, attrs = m.group(1), m.group(2).lower(), m.group(3)
            if tag in VOID or attrs.rstrip().endswith("/"):
                continue
            if close:
                if not stack:
                    fail("html", where(m.start()), "stray </%s>" % tag)
                    continue
                open_tag, open_pos = stack.pop()
                if open_tag != tag:
                    fail("html", where(m.start()), "</%s> closes <%s> opened on line %d" %
                         (tag, open_tag, line_of(text, open_pos)))
            else:
                stack.append((tag, m.start()))
                idm = re.search(r'\bid="([^"]+)"', attrs)
                if idm:
                    if idm.group(1) in ids:
                        fail("html", where(m.start()), "duplicate id '%s' (first at line %d)" %
                             (idm.group(1), ids[idm.group(1)]))
                    ids[idm.group(1)] = line_of(text, m.start())
        for tag, pos in stack:
            if tag not in ("p", "li", "td", "tr", "th", "option", "html", "body"):
                fail("html", where(pos), "<%s> is never closed" % tag)

        if page != "404.html":
            m = re.search(r"<title>([^<]+)</title>", text)
            if not m:
                fail("html", page, "no <title>")
            else:
                if len(m.group(1)) > 72:
                    warn("html", page, "title is %d chars, long for a tab" % len(m.group(1)))
                if "Photon" not in m.group(1):
                    warn("html", page, "title does not name the hub")
            m = re.search(r'<meta name="description" content="([^"]*)"', text)
            if not m:
                fail("html", page, "no meta description")
            elif not 40 <= len(m.group(1)) <= 190:
                fail("html", page, "meta description is %d chars (want 40–190)" % len(m.group(1)))
            elif re.search(r"^(welcome|discover|explore|unleash|elevate)", m.group(1), re.I):
                fail("html", page, "meta description opens with a marketing verb")
            if '<link rel="icon"' not in text:
                fail("html", page, "no favicon")
            if '<meta name="viewport"' not in text:
                fail("html", page, "no viewport meta")

        nav = re.search(r"<nav>(.*?)</nav>", text, flags=re.S)
        if not nav:
            fail("html", page, "no <nav> block")
        else:
            hrefs = re.findall(r'href="([^"]+)"', nav.group(1))
            pages = [h for h in hrefs if h.endswith(".html")]
            if page == "brief.html":
                if not re.search(r'href="index\.html"', nav.group(1)):
                    fail("html", page, "the brief's nav must still carry a way home")
            elif pages != NAV:
                fail("html", page, "nav is %s, expected the shared eight in order" % pages)
        logo = re.search(r'<a class="logo"([^>]*)>', text)
        if not logo:
            fail("html", page, "no a.logo — every page opens with the wordmark")
        elif 'href="index.html"' not in logo.group(1):
            fail("html", page, "the logo must link straight to index.html and nothing else")
        if "<footer>" not in text:
            fail("html", page, "no footer")
        if 'class="ring"' in text and "mountRing" not in raw:
            fail("html", page, "a webring div with nothing in it (no PH.mountRing call)")

        for m in re.finditer(r"<img\b[^>]*>", text):
            if 'alt="' not in m.group(0):
                fail("html", where(m.start()), "<img> without alt text")
            elif re.search(r'alt="(image|photo|graphic|picture)\b', m.group(0), re.I):
                warn("html", where(m.start()), "alt text announces itself instead of describing")

        for m in re.finditer(r'<(?:a|link|script|img|source|iframe)\b[^>]*?\b(href|src)="([^"]*)"', text):
            attr, target = m.group(1), html.unescape(m.group(2))
            ln = where(m.start())
            if re.match(r"^(?:[a-z]+:)?//", target):
                host = re.match(r"^(?:https?:)?//([^/?#]+)", target).group(1)
                if attr == "href" and any(host.endswith(a) for a in OK_EXTERNAL):
                    continue
                fail("external", ln, "a %s to %s — the hub must load with no network" % (attr, target))
                continue
            if target.startswith(("mailto:", "tel:", "data:", "blob:")):
                continue
            if target.startswith("javascript:"):
                fail("html", ln, "javascript: href")
                continue
            if target.startswith("#"):
                if len(target) > 1 and target[1:] not in ids:
                    fail("links", ln, "in-page link to #%s, which has no such id" % target[1:])
                continue
            path_part = target.split("?")[0].split("#")[0]
            if not path_part or path_part.startswith("{{"):
                continue
            if not os.path.isfile(os.path.join(ROOT, path_part)):
                fail("links", ln, "dead link → %s" % target)
        # the marquee is the one piece of motion the hub owns: keep it switchable
        if "<marquee" in text and page == "index.html" and 'id="bar-stop"' not in text:
            fail("html", page, "the notice strip has no stop button (brief.html promises one)")
        for m in re.finditer(r"<marquee[^>]*>", text):
            if 'loop="0"' not in m.group(0):
                warn("html", where(m.start()), "the strip should loop forever: loop=\"0\"")


# ---------------------------------------------------------------- ids the js asks for
def check_ids():
    for page in MY_PAGES:
        try:
            raw = read(page)
        except OSError:
            continue
        body = stripped(raw, css=False)
        inline = [m.group(1) for m in
                  re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", body, flags=re.S)]
        js_refs = re.findall(r'<script src="([^"]+)"', body)
        js_refs += re.findall(r'<link[^>]*href="(style\.css)"', body)
        pool = body + "\n" + "\n".join(
            read(r) for r in js_refs if os.path.isfile(os.path.join(ROOT, r)))
        used = set()
        for src in inline + [read(r) for r in js_refs if r.endswith(".js") and
                             os.path.isfile(os.path.join(ROOT, r))]:
            for m in re.finditer(r"""(?:querySelector|qs|getElementById)\(\s*['"]#([A-Za-z][\w-]*)['"]""", src):
                used.add(m.group(1))
        for id_name in sorted(used):
            if re.search(r'''id=["']?%s''' % re.escape(id_name), pool):
                continue
            fail("ids", page,
                 "script asks for #%s and neither the page nor its js builds it" % id_name)


# ---------------------------------------------------------------- the shared data
def check_data():
    text = read("js/index-data.js")
    sites = get_data(text, "PHOTON_SITES") or []
    order = get_data(text, "PHOTON_ORDER") or []
    ring = get_data(text, "PHOTON_RING") or []
    box = get_data(text, "PHOTON_BOX") or []
    if not sites:
        fail("data", "js/index-data.js", "PHOTON_SITES could not be read")
        return
    seen = set()
    for s in sites:
        sid = s.get("id", "?")
        if sid in seen:
            fail("data", "site %s" % sid, "duplicate id")
        seen.add(sid)
        for key in ("id", "file", "title", "cat", "blurb", "status", "keys", "art"):
            if key not in s:
                fail("data", "site %s" % sid, "missing key '%s'" % key)
        if s.get("status") not in ("open", "pinned", "closed", "heavy", "beta", "held"):
            warn("data", "site %s" % sid, "status '%s' is not one the dot classes know" % s.get("status"))
        if len(s.get("title", "")) > 34:
            warn("data", "site %s" % sid, "title is %d chars, long for a row" % len(s["title"]))
        if len(s.get("blurb", "")) > 240:
            warn("data", "site %s" % sid, "blurb is %d chars, that is a paragraph in a row" % len(s["blurb"]))
        art = s.get("art")
        art = s.get("art")
        if art is None:
            pass                      # a page with no drawing of its own is a legitimate choice
        elif not isinstance(art, dict) or not art.get("file"):
            fail("data", "site %s" % sid, "art must be null, or carry a file name")
        else:
            for key in ("file", "box", "px"):
                if not art.get(key):
                    fail("data", "site %s" % sid, "art.%s is required: the box on the page is the record" % key)
            if not re.match(r"^img/[\w.-]+\.png$", art.get("file", "")):
                fail("data", "site %s" % sid, "art.file must be an img/*.png name")
            if not re.match(r"IMAGE \d$", art.get("box", "")):
                fail("data", "site %s" % sid, "art.box should read IMAGE n")
            if not re.match(r"^\d{3,4} × \d{3,4}$", art.get("px", "")):
                fail("data", "site %s" % sid, 'art.px should read "WIDTH × HEIGHT" as the slot does')
        f = s.get("file", "")
        if f and not f.startswith(("http:", "https:")) and not os.path.isfile(os.path.join(ROOT, f)):
            fail("data", "site %s" % sid, "file %s does not exist" % f)
        art = (s.get("art") or {}).get("file", "")
        if art and os.path.isfile(os.path.join(ROOT, art)) and \
                os.path.getsize(os.path.join(ROOT, art)) == 0:
            warn("data", "site %s" % sid, "%s is an empty file, which the slot treats as missing" % art)
    if set(seen) - set(order):
        fail("data", "PHOTON_ORDER", "sites missing from the order: %s" % sorted(seen - set(order)))
    for oid in order:
        if oid not in seen:
            fail("data", "PHOTON_ORDER", "%s is not a site id" % oid)
    for page in ring:
        if not os.path.isfile(os.path.join(ROOT, page)):
            fail("data", "PHOTON_RING", "%s does not exist" % page)
    if len(ring) < 3:
        fail("data", "PHOTON_RING", "a ring of %d pages is not a ring" % len(ring))
    total = 0
    for row in box:
        rel = row.get("path")
        if not rel:
            if not row.get("group"):
                fail("data", "PHOTON_BOX", "row has neither path nor group: %s" % row)
            continue
        p = os.path.join(ROOT, rel)
        if not os.path.isfile(p):
            if row.get("size"):
                fail("data", "PHOTON_BOX", "%s claims %s bytes and does not exist" % (rel, row["size"]))
            continue
        real = os.path.getsize(p)
        total += real
        if row.get("size") != real:
            fail("data", "PHOTON_BOX", "%s claims %s bytes, is %s — fix js/index-data.js" %
                 (rel, row.get("size"), real))
        if not row.get("what"):
            warn("data", "PHOTON_BOX", "%s has no 'what' line for the table" % rel)
    for s in sites:
        page = s.get("file", "")
        if not page or s.get("status") == "closed" or not os.path.isfile(os.path.join(ROOT, page)):
            continue
        real = os.path.getsize(os.path.join(ROOT, page))
        for src in re.findall(r'<script src="(js/[\w.-]+\.js)"', read(page)):
            if os.path.isfile(os.path.join(ROOT, src)):
                real += os.path.getsize(os.path.join(ROOT, src))
        if s.get("id") == "eagler" and os.path.isfile(os.path.join(ROOT, "Eaglercraft.html")):
            real += os.path.getsize(os.path.join(ROOT, "Eaglercraft.html"))
        m = re.match(r"^([\d.]+) (KB|MB)$", str(s.get("weight", "")).strip())
        if not m:
            warn("data", "site %s" % s["id"], "weight %r is not a plain number and a unit" % s.get("weight"))
            continue
        val = float(m.group(1)) * (1024 * 1024 if m.group(2) == "MB" else 1024)
        if abs(val - real) > (1600 if m.group(2) == "KB" else real * 0.02):
            fail("data", "site %s" % s["id"],
                 "weight says %s, the page and its scripts are %d bytes" % (m.group(0), real))
        # a site that declares a drawing must carry that exact box on that page
        art = s.get("art")
        if isinstance(art, dict) and art.get("file"):
            body = visible(stripped(read(page), css=False))
            box = re.search(r'data-art="%s"([^>]*)>' % re.escape(art["file"]), body)
            if not box:
                fail("data", page, "%s is this site's drawing and the page never asks for it" % art["file"])
                continue
            if art.get("box") and art["box"] not in body[max(0, box.end()):box.end() + 700]:
                fail("data", page, "the %s box is on the page but not labelled %s, as the data says" %
                     (art["file"], art["box"]))
            slot = next((x for x in sketch_slots() if x.get("file") == art.get("file")), None)
            if slot and art.get("px") != "%d × %d" % (slot["w"], slot["h"]):
                fail("data", "site %s" % s["id"], "art.px says %s, the pad's slot says %d × %d" %
                     (art["px"], slot["w"], slot["h"]))
    claim = re.search(r"var PHOTON_TOTAL = (\d+)", text)
    if claim and int(claim.group(1)) != total:
        fail("data", "PHOTON_TOTAL", "claims %s bytes, the listed files are %s" %
             (claim.group(1), total))
    # every page a visitor can reach should be listed somewhere
    for page in MY_PAGES:
        if page == "404.html":
            continue
        if page not in box_paths(text) and page not in NAV:
            warn("data", page, "not in PHOTON_BOX and not in the nav — nobody will find it")


def box_paths(text):
    return set(re.findall(r'path:\s*"([^"]+)"', text))


# ---------------------------------------------------------------- draw slots
def sketch_slots():
    sketch = read("js/sketch.js")
    return get_data(sketch.replace("var SLOTS = ", "var PHOTON_SLOTS = ", 1), "PHOTON_SLOTS") or []


def check_slots():
    sketch = read("js/sketch.js")
    slots = get_data(sketch.replace("var SLOTS = ", "var PHOTON_SLOTS = ", 1), "PHOTON_SLOTS") or []
    if not slots:
        fail("slots", "js/sketch.js", "SLOTS could not be read — the pad cannot name an export")
        return
    by_file = {}
    for s in slots:
        if not s.get("file", "").endswith(".png"):
            fail("slots", s.get("name", "?"), "file %r is not a png name" % s.get("file"))
        if s.get("w", 0) < 120 or s.get("h", 0) < 120:
            fail("slots", s.get("name", "?"), "size %sx%s is not a usable sheet" % (s.get("w"), s.get("h")))
        if s.get("file") in by_file:
            fail("slots", s.get("file"), "two slots export to the same file")
        by_file[s["file"]] = s
    asked = {}
    for page in MY_PAGES:
        text = visible(stripped(read(page), css=False))
        for m in re.finditer(r'data-art="([^"]+)"([^>]*)', text):
            rel = m.group(1)
            ln = "%s:%d" % (page, line_of(text, m.start()))
            if not re.match(r"^img/[\w.-]+\.png$", rel):
                fail("slots", ln, "%s is not an img/*.png name, so the pad can never fill it" % rel)
                continue
            if rel not in by_file:
                fail("slots", ln, "%s is a drawing box with no slot in js/sketch.js — "
                                  "the export name and size would not match" % rel)
                continue
            asked.setdefault(rel, []).append(page)
            want = by_file[rel]
            wm = re.search(r'data-w="(\d+)"', m.group(2))
            if wm and int(wm.group(1)) != want["w"]:
                fail("slots", ln, "box says %s px wide, slot says %s" % (wm.group(1), want["w"]))
            am = re.search(r'data-alt="([^"]*)"', m.group(2))
            if not am or len(am.group(1)) < 30:
                fail("slots", ln, "%s has no real alt description in the box" % rel)
            elif len(am.group(1)) > 160:
                warn("slots", ln, "alt text is %d chars; a screen reader runs out of patience" %
                     len(am.group(1)))
            elif re.match(r"^(image|photo|picture) of", am.group(1), re.I):
                warn("slots", ln, "alt should describe the thing, not announce itself")
            if "SAVE AS" not in text[max(0, m.start() - 200):m.start() + 3000]:
                warn("slots", ln, "the box does not print the file name under the drawing")
    for rel in by_file:
        if rel == "img/mark.png":
            continue          # the optional mark is offered, not demanded
        if rel not in asked:
            fail("slots", rel, "the pad offers this slot and no page asks for the drawing")
    # files in img/ that no slot claims are dead weight
    for found in glob.glob(os.path.join(ROOT, "img", "*.png")) + glob.glob(os.path.join(ROOT, "img", "*.jpg")):
        rel = os.path.relpath(found, ROOT).replace(os.sep, "/")
        if rel not in by_file:
            warn("slots", rel, "in img/ but no slot asks for it")


# ---------------------------------------------------------------- the style contract
def check_css():
    raw = read("style.css")
    text = stripped(raw)
    flat = re.sub(r"\s+", " ", text)
    if text.count("{") != text.count("}"):
        fail("css", "style.css", "unbalanced braces: %d { against %d }" % (text.count("{"), text.count("}")))
    for m in re.finditer(r"([{}])", text):
        pass
    defined = set(re.findall(r"(--[\w-]+)\s*:", text))
    for m in re.finditer(r"var\((--[\w-]+)", text):
        if m.group(1) not in defined:
            fail("css", "style.css:%d" % line_of(text, m.start()),
                 "uses %s which is never defined" % m.group(1))
    for m in re.finditer(r"border-radius\s*:\s*(\d+(?:\.\d+)?)px", text):
        if float(m.group(1)) > 4:
            fail("css", "style.css:%d" % line_of(text, m.start()),
                 "border-radius %spx — the brief says a few pixels at most" % m.group(1))
    for m in re.finditer(r"background\s*:\s*(?:linear|radial|conic)-gradient", text):
        ctx = text[max(0, m.start() - 260):m.start()]
        if re.search(r"\.top|hr\.rule|^body|\bbody\b", ctx):
            fail("css", "style.css:%d" % line_of(text, m.start()),
                 "a gradient on a page surface; buttons stay flat with a ring")
    for m in re.finditer(r"backdrop-filter|filter:\s*blur", text):
        fail("css", "style.css:%d" % line_of(text, m.start()), "blur is glass, glass is refused")
    for m in re.finditer(r"(?<![-\w])animation\s*:", text):
        ctx = text[max(0, m.start() - 320):m.start() + 200]
        if ".caret" not in ctx and "printin" not in ctx:
            fail("css", "style.css:%d" % line_of(text, m.start()),
                 "an animation that is neither the print caret nor the row reveal")
    for m in re.finditer(r"transition\s*:", text):
        ctx = text[max(0, m.start() - 320):m.start()]
        if "none" not in text[m.start():m.start() + 60] and \
           not re.search(r"\.btn|a:hover|\.cell|input|dir-row", ctx):
            warn("css", "style.css:%d" % line_of(text, m.start()),
                 "a transition on something that is not a hover state")
    for m in re.finditer(r"font-size\s*:\s*(\d+(?:\.\d+)?)px", text):
        if float(m.group(1)) < 11:
            fail("css", "style.css:%d" % line_of(text, m.start()),
                 "text at %spx is below the 11px floor" % m.group(1))
    if not re.search(r"\.btn\s*\{[^}]*border:\s*2px solid var\(--yellow\)", text, flags=re.S):
        fail("css", "style.css", ".btn lost its 2px yellow ring — everything clickable wears one")
    if not re.search(r":focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--yellow\)", flat):
        fail("css", "style.css", "the focus ring is gone")
    if "@media (prefers-reduced-motion" not in flat:
        fail("css", "style.css", "no reduced-motion block")
    for var, val in (("--bg", "#0a0d16"), ("--yellow", "#f2c14e"), ("--red", "#7d1220"),
                     ("--blue-deep", "#16233d")):
        if not re.search(r"%s\s*:\s*%s" % (re.escape(var), val), text, flags=re.I):
            fail("css", "style.css", "%s is no longer %s; brief.html documents that value" % (var, val))
    if not re.search(r"max-width\s*:\s*860px", text):
        fail("css", "style.css", "the 860px column is gone")
    for m in re.finditer(r"font-family\s*:\s*([^;}]+)", text):
        fam = m.group(1)
        for bad in ("Inter", "Roboto", "Poppins", "Montserrat", "Open Sans", "Lato"):
            if bad in fam:
                fail("css", "style.css:%d" % line_of(text, m.start()),
                     "%s is a default choice, and webfonts are refused" % bad)
    if "@media (max-width" not in flat:
        fail("css", "style.css", "no narrow-screen rules at all")


# ---------------------------------------------------------------- syntax
def check_js():
    for rel in sorted(glob.glob(os.path.join(ROOT, "js", "*.js"))) + \
              sorted(glob.glob(os.path.join(ROOT, "tools", "*.js"))):
        try:
            out = subprocess.run(["node", "--check", rel], capture_output=True, text=True, timeout=90)
        except FileNotFoundError:
            warn("js", os.path.relpath(rel, ROOT), "node not on PATH, skipped")
            continue
        except subprocess.TimeoutExpired:
            warn("js", os.path.relpath(rel, ROOT), "node --check timed out")
            continue
        if out.returncode:
            detail = (out.stderr or "syntax error").strip().splitlines()
            fail("js", os.path.relpath(rel, ROOT), detail[-1][:200])
    for page in MY_PAGES:
        body = stripped(read(page), css=False)
        for i, m in enumerate(re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", body, flags=re.S)):
            src = m.group(1)
            if len(src.strip()) < 40:
                continue
            tmp = os.path.join("/tmp", "photon-inline-%s-%d.js" % (page.replace(".", "_"), i))
            with open(tmp, "w", encoding="utf-8") as fh:
                fh.write("(function(){%s\n})\n" % src)
            try:
                out = subprocess.run(["node", "--check", tmp], capture_output=True, text=True, timeout=90)
            except (FileNotFoundError, subprocess.TimeoutExpired):
                return
            if out.returncode:
                detail = (out.stderr or "syntax error").strip().splitlines()
                line = re.search(r"photon-inline-%s-%d\.js:(\d+)" % (page.replace(".", "_"), i),
                                 out.stderr or "")
                where = "%s inline script #%d" % (page, i + 1)
                if line:
                    where += " (its line %d)" % (int(line.group(1)) - 1)
                fail("js", where, detail[-1][:200])
            # an unbalanced quote in a template the checker can see
            if src.count("`") % 2:
                fail("js", "%s inline script #%d" % (page, i + 1), "backticks do not balance")


# ---------------------------------------------------------------- leftovers
TRACKERS = [
    (r"document\.cookie", "writes a cookie, and the hub says it does not"),
    (r"googletagmanager|gtag\(|google-analytics|\bga\(", "an analytics snippet"),
    (r"fbevents|facebook\.com/tr|doubleclick|scorecardresearch", "an ad pixel"),
    (r"sendBeacon|navigator\.sendBeacon", "a beacon call"),
    (r"<script[^>]*\bsrc=[^>]*\bintegrity=", "a third-party script tag"),
]


def check_tracking():
    """The front page prints a badge reading 0 cookies, 0 trackers.

    Only executable code is scanned: brief.html quotes document.cookie while
    explaining that nothing sets one, and a checker that flags its own
    documentation is a checker people turn off.
    """
    corpus = []
    for rel in sorted(glob.glob(os.path.join(ROOT, "js", "*.js"))):
        corpus.append((os.path.relpath(rel, ROOT), read(os.path.join("js", os.path.basename(rel)))))
    for page in MY_PAGES:
        body = visible(stripped(read(page), css=False))
        for i, m in enumerate(re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", body, flags=re.S)):
            corpus.append(("%s inline script #%d" % (page, i + 1), m.group(1)))
    for where, src in corpus:
        for pat, why in TRACKERS:
            for m in re.finditer(pat, src, flags=re.I):
                fail("tracking", "%s:%d" % (where, line_of(src, m.start())), why)


def check_text():
    targets = MY_PAGES + ["style.css", "README.md", "img/README.md"] + \
              [os.path.join("js", f) for f in sorted(os.listdir(os.path.join(ROOT, "js")))]
    for rel in targets:
        try:
            raw = read(rel)
        except OSError:
            continue
        for pat, why in FORBIDDEN:
            for m in re.finditer(pat, raw, flags=re.I):
                # a page quoting the rule it enforces is not a violation
                ctx = raw[max(0, m.start() - 120):m.start() + 120]
                if "brief.html" in rel and "FORBIDDEN" in raw[:200]:
                    continue
                if 'id="bar-stop"' in ctx or "check.py" in ctx:
                    continue
                fail("text", "%s:%d" % (rel, line_of(raw, m.start())), why)
        if "\r\n" in raw:
            fail("text", rel, "CRLF line endings — only Eaglercraft.html may keep those")
        if "\t" in raw:
            warn("text", rel, "tabs in a file the rest of the hub indents with spaces")
        if raw and not raw.endswith("\n"):
            warn("text", rel, "no final newline")
        for m in re.finditer(r"[ \t]+$", raw, flags=re.M):
            fail("text", "%s:%d" % (rel, line_of(raw, m.start())), "trailing whitespace")
        if re.search(r'href="http://localhost', raw):
            warn("text", rel, "an http://localhost link will not work when the hub is opened off a disk")


# ---------------------------------------------------------------- games
def check_games():
    games = read("js/games.js")
    if "list:" not in games:
        fail("games", "js/games.js", "the game list could not be found")
        return
    ids = re.findall(r'id:\s*"([a-z0-9-]+)",\s*name:\s*"', games)
    mount_block = re.search(r"api\.mounts = \{(.*?)\};", games, flags=re.S)
    if not mount_block:
        fail("games", "js/games.js", "api.mounts could not be read")
        return
    mounts = re.findall(r"([a-z]+):\s*mount([A-Z]\w*)", mount_block.group(1))
    mounts = [m[0] for m in mounts]
    if len(ids) != 7:
        fail("games", "js/games.js", "%d games in the list; the cabinet is seven" % len(ids))
    for gid in ids:
        if gid not in mounts:
            fail("games", gid, "in Games.list with no entry in api.mounts — the shelf would throw")
    for m in mounts:
        if m not in ids:
            fail("games", m, "mounted but never listed — nobody can reach it")
    index = read("games.html")
    if "hashchange" not in index:
        fail("games", "games.html", "the shelf must be deep-linkable (#mines) and has no hashchange listener")
    for gid in ids:
        if 'data-play="%s"' % gid in index:
            fail("games", gid, "hard-coded in games.html while the shelf is printed from data")
    for gid in ids:
        if "scoreKey" not in games:
            fail("games", "js/games.js", "no per-game score key")
    if re.search(r"while\s*\(true\)", games):
        fail("games", "js/games.js", "an unbounded while(true) — a generation loop must be bounded")
    if "setInterval" in games and "clearInterval" not in games:
        fail("games", "js/games.js", "a timer is started and never cleared")
    if "addEventListener" in games and "removeEventListener" not in games:
        fail("games", "js/games.js", "a listener is added and never removed (games must clean up)")


# ---------------------------------------------------------------- eaglercraft
def check_eagler():
    p = os.path.join(ROOT, "Eaglercraft.html")
    if not os.path.isfile(p):
        return
    size = os.path.getsize(p)
    if size < 17_000_000:
        fail("eagler", "Eaglercraft.html", "only %d bytes — it arrived truncated, re-copy it" % size)
    with open(p, "r", encoding="utf-8", errors="replace") as fh:
        head = fh.read(4000)
    if "eaglercraft" not in head.lower():
        fail("eagler", "Eaglercraft.html", "the first 4 KB do not mention eaglercraft — wrong file?")
    with open(p, "rb") as fh:
        fh.seek(-400, os.SEEK_END)
        tail = fh.read()
    if b"</html>" not in tail:
        fail("eagler", "Eaglercraft.html", "no </html> in the last 400 bytes — truncated in transit")
    launcher = read("eagler.html")
    if re.search(r"<iframe[^>]*\bsrc=", launcher):
        fail("eagler", "eagler.html", "an <iframe> with a src in the markup pulls 18 MB before anybody asks")
    if "Eaglercraft.html" not in launcher:
        fail("eagler", "eagler.html", "never names the game file")
    if 'deleteDatabase("worlds")' not in launcher:
        fail("eagler", "eagler.html", "the wipe control needs indexedDB.deleteDatabase(\"worlds\")")
    if "own tab" not in launcher.lower():
        warn("eagler", "eagler.html", "cross-origin frames lose pointer lock and fullscreen; "
                                      "offer the file its own tab as well")
    for page in MY_PAGES:
        if page == "eagler.html":
            continue
        raw = read(page)
        if 'href="Eaglercraft.html"' in raw:
            fail("eagler", page, "links straight at the 18 MB file; go through eagler.html")


# ---------------------------------------------------------------- prose numbers
def check_prose():
    idx = read("index.html")
    data = read("js/index-data.js")
    sites = len(re.findall(r'\n\s*\{\s*id:\s*"', data))
    for m in re.finditer(r"(\d+) (?:sites|entries) (?:in|that)", idx):
        n = int(m.group(1))
        if n != sites:
            fail("prose", "index.html", "says %d sites; PHOTON_SITES has %d" % (n, sites))
    for page in MY_PAGES:
        raw = read(page)
        for m in re.finditer(r'"([\d.]+)\s*(KB|MB)"', raw):
            val = float(m.group(1))
            total = 0
            for rel in glob.glob(os.path.join(ROOT, "js", "*.js")) + \
                       [os.path.join(ROOT, "Eaglercraft.html")]:
                total += os.path.getsize(rel)
            if m.group(2) == "MB" and "Eaglercraft" in raw[max(0, m.start() - 200):m.start() + 60]:
                real = os.path.getsize(os.path.join(ROOT, "Eaglercraft.html"))
                if min(abs(val - real / 1e6), abs(val - real / 1048576.0)) > 0.15:
                    fail("prose", page, "%s MB is neither %.2f MB nor %.2f MiB" %
                         (val, real / 1e6, real / 1048576.0))
        for m in re.finditer(r"(\d+) games?\b", page if False else read(page)):
            n = int(m.group(1))
            if n not in (7, 8, 12, 60, 100, 200, 1000) and n < 40:
                warn("prose", page, "mentions %d games — the cabinet holds seven" % n)


# classes the pages build at runtime, so no file contains the literal
GENERATED = set(["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"] +
                ["t" + str(2 ** k) for k in range(1, 12)] +
                ["ok", "hold", "off", "shown", "printing", "mid", "size", "sub", "go"])


def check_dead_css():
    """A stylesheet nobody trims turns into folklore. Every class in it gets looked for."""
    css = re.sub(r"/\*.*?\*/", "", read("style.css"), flags=re.S)
    names = set(re.findall(r"\.([a-zA-Z][\w-]*)", css))
    corpus = ""
    for page in MY_PAGES:
        corpus += read(page)
    for f in sorted(os.listdir(os.path.join(ROOT, "js"))):
        corpus += read(os.path.join("js", f))
    for name in sorted(names):
        if name in GENERATED or len(name) < 3:
            continue
        if not re.search(r"\b%s\b" % re.escape(name), corpus):
            for m in re.finditer(r"\.%s\b" % re.escape(name), css):
                warn("css", "style.css:%d" % line_of(css, m.start()),
                     ".%s is not used by any page or script — trim it or wire it up" % name)
                break


def main():
    check_presence()
    check_html()
    check_ids()
    check_data()
    check_slots()
    check_css()
    if not QUICK:
        check_js()
    check_text()
    check_tracking()
    check_games()
    check_eagler()
    check_prose()
    check_dead_css()

    order = list(dict.fromkeys([f[0] for f in fails] + [w[0] for w in warns]))
    for group in order:
        for row in [f for f in fails if f[0] == group] + [w for w in warns if w[0] == group]:
            print("%-5s %-8s %-38s %s" % ("FAIL" if row in fails else "warn", row[0], row[1], row[2]))
    n = len(fails)
    print("— %d failure%s, %d warning%s" % (n, "" if n == 1 else "s", len(warns), "" if len(warns) == 1 else "s"))
    if not n:
        print("checked %d pages, %d scripts, %d manifest rows, %d drawing slots, %d games. "
              "The folder agrees with itself." %
              (len(MY_PAGES), len(glob.glob(os.path.join(ROOT, "js", "*.js"))),
               len(box_paths(read("js/index-data.js"))),
               len(sketch_slots()),
               len(re.findall(r'id:\s*"([a-z-]+)",\s*name:\s*"', read("js/games.js")))))
    return 1 if n else 0


if __name__ == "__main__":
    sys.exit(main())
