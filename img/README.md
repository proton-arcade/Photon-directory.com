# img/

The hub ships with no bitmaps in it on purpose: every image slot is a dashed
`.draw` box that says what to draw, at what size, with the alt text already
written out. This folder is where they land.

Drop a file in with the exact name printed under the box and the box becomes the
drawing the next time the page loads — no HTML edit, no rebuild:

| file | px | slot it fills |
| --- | --- | --- |
| `drawer.png` | 800 × 420 | index — the card drawer |
| `room.png` | 360 × 520 | index — the room, one lamp, a CRT |
| `cabinet.png` | 360 × 520 | games — the cabinet as furniture |
| `player.png` | 560 × 300 | player — the window drawn as an object |
| `eagler.png` | 360 × 360 | eaglercraft — one block, 1.8 underneath |
| `notepad.png` | 360 × 520 | notepad — paper with a red pin |
| `sketch.png` | 420 × 420 | sketch pad — a hand, a pen, one unfinished line |
| `mark.png` | 200 × 200 | optional logo mark |

`sketch.html` exports at these sizes and already uses these names, and
`brief.html` describes each drawing in full. Anything else that appears in this
folder is ignored by the site.
