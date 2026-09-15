# Photon.Directory

A hand-kept directory of sites that run without a network. Dark ground, deep blue, deep red,
yellow rings around everything clickable. Georgia for headings, Courier New for the rest, an
860px column, 2px corners, and no build step.

It started as the cover sheet for a folder of downloaded sites and stayed that way.

## What is in here

| page | what it is |
| --- | --- |
| `index.html` | the index — six rows, printed, with a shelf for your own pins |
| `games.html` | seven games in one canvas/grid file: Snake, Minesweeper, 2048, Pong, Maze, Lights Out, Word Drill |
| `player.html` | local media player: `.mkv .mp4 .webm .mov .avi .mp3 .flac …`, subtitles, resume, A–B, frame step, container probe |
| `eagler.html` | launcher for `Eaglercraft.html` (Minecraft 1.8, one 17.2 MB file, unmodified) |
| `notepad.html` | plain notes, autosaved in the browser |
| `sketch.html` | ink pad for the eight drawings the hub is still owed |
| `search.html` | one box over the whole index |
| `brief.html` | the design brief: colour table, type scale, spacing, motion budget, what is refused |

## Running it

Any way you like, because there is no server:

```bash
python3 tools/serve.py         # http://localhost:8000 — recommended
# or double-click index.html    file:// works too, minus the links check
# or push to GitHub Pages        relative links, so /any/sub/path/ is fine
```

`tools/serve.py` is a 60-line static server that adds the two things a plain
`python3 -m http.server` does not: correct MIME types for `.mkv`/`.m4a`, and
`Accept-Ranges` so `<video>` can seek into a test file.

## Checking it

```bash
python3 tools/sizes.py     # rewrite the byte counts in js/index-data.js from the real folder
node tools/test-logic.js   # 293 assertions: game rules, EBML/MP4 probing, srt→vtt, resume keys
node tools/test-dom.js     # 348 assertions over every page in jsdom: nav, console errors, mounts, teardown
python3 tools/check.py     # the folder agrees with itself: links, sizes, alt text, leftovers
```

## Adding a site to the hub

1. Put the file next to `index.html`.
2. Add one entry to `PHOTON_SITES` in `js/index-data.js` and its id to `PHOTON_ORDER`.
3. Add its filename to `PHOTON_RING` if it should be in the webring walk, and to `PHOTON_BOX` for the manifest table.

The index, the search page, the 404 listing and the webring all read the same data file, so a new
site is in all of them at once. `python3 tools/sizes.py` regenerates those counts and `tools/check.py` refuses a table that has fallen behind.

## Notes

* No trackers, no cookies, no analytics, no webfonts, no CDN. Nothing on any page makes a request to
  another origin.
* Files opened in the media player are read as object URLs in the tab; there is no upload path in
  `js/player.js` — grep it for `fetch` and `XMLHttpRequest` if you would rather verify than believe.
* Scores, notes, pins, search history and playback positions live in `localStorage` and are per
  browser. Clear site data and they are gone; that is the design, not an oversight.
* `Eaglercraft.html` is redistributed exactly as it arrived (18,002,822 bytes). Its own boot screen
  carries the upstream notice and link; `check.py` verifies the file has not been truncated in git.
* Eight hand drawings are owed. Every one is a dashed `.draw` box that turns into a PNG the moment
  the file appears in `img/` with the name printed under it — see the brief for the size and the
  subject of each.
