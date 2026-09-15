/* ===========================================================================
   sketch.js — the pad the drawings get made in.

   The hub owes seven hand drawings and the brief says they will be drawn on
   paper and scanned. This is the other option: draw it here, export a PNG at
   the exact pixels the slot asked for, drop it in img/, and the dashed box on
   that page turns into the drawing with no HTML edit.

   The maths (fit, colour mixing, nearest-neighbour resample, bounds) is at the
   bottom and exported, because a scan at the wrong size is the usual failure.
   =========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SKETCH = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  /* the slots on the site, in the sizes the brief asks for */
  var SLOTS = [
    { name: "drawer", file: "img/drawer.png", w: 800, h: 420, page: "index.html", note: "the card drawer of the hub" },
    { name: "room", file: "img/room.png", w: 360, h: 520, page: "index.html", note: "the room, one lamp, a CRT" },
    { name: "cabinet", file: "img/cabinet.png", w: 360, h: 520, page: "games.html", note: "the cabinet as a piece of furniture" },
    { name: "player", file: "img/player.png", w: 560, h: 300, page: "player.html", note: "the player window as an object" },
    { name: "eagler", file: "img/eagler.png", w: 360, h: 360, page: "eagler.html", note: "one block, 1.8 under it" },
    { name: "notepad", file: "img/notepad.png", w: 360, h: 520, page: "notepad.html", note: "a pad with a red pin" },
    { name: "sketch", file: "img/sketch.png", w: 420, h: 420, page: "sketch.html", note: "a hand, a pen, one line still being drawn" },
    { name: "mark", file: "img/mark.png", w: 200, h: 200, page: "brief.html", note: "logo mark: one wave across a rectangle" }
  ];
  var INKS = [
    { name: "black", hex: "#16181f" },
    { name: "blue", hex: "#2f5fa8" },
    { name: "red", hex: "#7d1220" },
    { name: "yellow", hex: "#f2c14e" },
    { name: "white", hex: "#e8e3d9" }
  ];
  var PAPERS = [{ name: "paper", hex: "#e8e3d9" }, { name: "night", hex: "#0c1120" }];
  var WIDTHS = [1, 2, 4, 8, 16];

  function fit(w, h, maxW, maxH) {
    w = Math.max(1, Number(w) || 1); h = Math.max(1, Number(h) || 1);
    var s = Math.min(maxW / w, maxH / h, 1);
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }
  function parseHex(str) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(str || "").trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function toHex(c) {
    var h = function (v) { v = Math.max(0, Math.min(255, Math.round(v))).toString(16); return v.length < 2 ? "0" + v : v; };
    return "#" + h(c.r) + h(c.g) + h(c.b);
  }
  function mix(a, b, t) {
    var ca = parseHex(a) || { r: 0, g: 0, b: 0 }, cb = parseHex(b) || { r: 255, g: 255, b: 255 };
    t = Math.max(0, Math.min(1, Number(t)));
    return toHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t });
  }
  /* what a light pen should look like on dark paper, and the other way round */
  function autoInk(ink, paper) {
    var i = parseHex(ink), p = parseHex(paper);
    if (!i || !p) return ink;
    var lum = function (c) { return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; };
    if (Math.abs(lum(i) - lum(p)) < 60) return lum(p) > 128 ? "#16181f" : "#e8e3d9";
    return ink;
  }
  function strokeBounds(strokes, pad) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    (strokes || []).forEach(function (s) {
      (s.pts || []).forEach(function (p) {
        var r = (s.w || 1) / 2 + (pad || 0);
        if (p.x - r < x0) x0 = p.x - r;
        if (p.y - r < y0) y0 = p.y - r;
        if (p.x + r > x1) x1 = p.x + r;
        if (p.y + r > y1) y1 = p.y + r;
      });
    });
    if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0, empty: true };
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0, empty: false };
  }
  function snapAngle(x0, y0, x1, y1, step) {
    /* shift-drag is a ruler: 8 directions, which is all a straight edge is */
    var dx = x1 - x0, dy = y1 - y0;
    var a = Math.atan2(dy, dx);
    var seg = Math.PI / (step || 8);
    var snapped = Math.round(a / seg) * seg;
    var len = Math.sqrt(dx * dx + dy * dy);
    return { x: x0 + Math.cos(snapped) * len, y: y0 + Math.sin(snapped) * len };
  }
  function resample(src, inW, inH, outW, outH) {
    /* nearest neighbour on purpose: when a hand scan needs to grow, soft
       interpolation turns pencil into fog */
    inW = Math.max(1, inW | 0); inH = Math.max(1, inH | 0);
    outW = Math.max(1, outW | 0); outH = Math.max(1, outH | 0);
    var out = new Uint8ClampedArray(outW * outH * 4);
    for (var y = 0; y < outH; y++) {
      var sy = Math.min(inH - 1, Math.floor(y * inH / outH));
      for (var x = 0; x < outW; x++) {
        var sx = Math.min(inW - 1, Math.floor(x * inW / outW));
        var si = (sy * inW + sx) * 4, di = (y * outW + x) * 4;
        out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
      }
    }
    return out;
  }
  function exportName(slot) {
    var s = typeof slot === "string" ? byName(slot) : slot;
    return s ? (s.file.split("/").pop()) : "drawing.png";
  }
  function byName(n) {
    for (var i = 0; i < SLOTS.length; i++) if (SLOTS[i].name === n) return SLOTS[i];
    return null;
  }
  function pending(list, have) {
    /* which slots are still dashed boxes — the checker uses this too */
    return (list || SLOTS).filter(function (s) { return !have || !have[s.name]; })
      .map(function (s) { return s.name; });
  }

  return {
    SLOTS: SLOTS, INKS: INKS, PAPERS: PAPERS, WIDTHS: WIDTHS,
    fit: fit, parseHex: parseHex, toHex: toHex, mix: mix, autoInk: autoInk,
    strokeBounds: strokeBounds, snapAngle: snapAngle, resample: resample,
    exportName: exportName, byName: byName, pending: pending
  };
});
