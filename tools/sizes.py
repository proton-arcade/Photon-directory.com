#!/usr/bin/env python3
"""sizes.py — rewrite the byte counts in js/index-data.js from the real folder.

    python3 tools/sizes.py

The manifest table on the front page prints a size per file and each site row
prints a weight. Those are the only numbers on the hub that go stale every time
anybody edits a line, and a directory that lies about its own file sizes has no
business being trusted about anything else. So they are generated here, and
check.py fails the run if they were not regenerated before the push.

Run order:  python3 tools/sizes.py && python3 tools/check.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "js", "index-data.js")


def size(rel):
    p = os.path.join(ROOT, rel)
    return os.path.getsize(p) if os.path.isfile(p) else 0


def human(b):
    if b >= 1024 * 1024:
        return "%.1f MB" % (b / 1048576.0)
    return "%d KB" % max(1, round(b / 1024.0))


def pass_once(text):
    """One rewrite. Returns (text, counts)."""
    def row(m):
        return '{ path: "%s", size: %d,' % (m.group(1), size(m.group(1)))

    text, rows = re.subn(r'\{ path: "([^"]+)", size: \d+,', row, text)

    # a site's weight is its page plus every script that page loads
    weights = 0
    for sid, page in re.findall(r'id:\s*"([a-z-]+)",\s*file:\s*"([^"]+)",', text):
        if not os.path.isfile(os.path.join(ROOT, page)):
            continue
        total = size(page) + sum(size(src) for src in
                                 re.findall(r'<script src="(js/[\w.-]+\.js)"', read(page))
                                 if os.path.isfile(os.path.join(ROOT, src)))
        if "eagler" in page.lower():
            total += size("Eaglercraft.html")
        text, n = re.subn(r'(id:\s*"%s",.*?weight:\s*)"[^"]*"' % re.escape(sid),
                          lambda m: m.group(1) + '"%s"' % human(total), text,
                          count=1, flags=re.S)
        weights += n

    listed = re.findall(r'\{ path: "([^"]+)", size: (\d+)', text)
    total = sum(int(sz) for _, sz in listed)
    text, tot = re.subn(r"var PHOTON_TOTAL = \d+;", "var PHOTON_TOTAL = %d;" % total, text, count=1)
    return text, {"rows": rows, "weights": weights, "total": total, "totals": tot}


def read(rel):
    with open(os.path.join(ROOT, rel), "r", encoding="utf-8") as fh:
        return fh.read()


def main():
    current = read("js/index-data.js")
    text = current
    stats = {}
    # The data file lists its own size, so writing the number can change the
    # number of digits. Iterate until it stops moving, which takes two passes.
    for _ in range(6):
        text, stats = pass_once(text)
        if text == current:
            break
        current = text
    if text == read("js/index-data.js"):
        print("nothing to change — %d rows, %d weights, total %s bytes" %
              (stats.get("rows", 0), stats.get("weights", 0), stats.get("total", 0)))
        return 0
    with open(DATA, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("rewrote %d sizes, %d weights, PHOTON_TOTAL = %s bytes (%s)" %
          (stats["rows"], stats["weights"], stats["total"], human(stats["total"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
