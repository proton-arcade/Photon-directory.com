/* ===========================================================================
   notepad.js — notes that live in one browser.

   Deliberately not a "notes app": no accounts, no sync, no folders. The logic
   worth testing (counting, naming, sorting, the shape of an export) is at the
   bottom and exported, so node can check it without a dom.
   =========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.NOTEPAD = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var KEY = "photon.notes.v1";
  var MAX_NOTES = 200;

  function count(text) {
    var t = String(text == null ? "" : text);
    var words = (t.match(/[^\s]+/g) || []).length;
    var lines = t ? t.split("\n").length : 0;
    var paras = t.split(/\n\s*\n/).filter(function (p) { return p.trim(); }).length;
    return {
      words: words,
      chars: t.length,
      charsNoSpace: t.replace(/\s/g, "").length,
      lines: lines,
      paras: paras,
      readMin: Math.max(1, Math.round(words / 220))
    };
  }

  function titleOf(text) {
    var first = String(text == null ? "" : text).split("\n").filter(function (l) { return l.trim(); })[0] || "";
    first = first.replace(/^\s*#+\s*/, "").trim();
    if (!first) return "untitled";
    return first.slice(0, 60);
  }

  function slug(text) {
    var t = titleOf(text).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42);
    return t || "note";
  }

  function fileName(text, stamp) {
    var d = new Date(stamp || Date.now());
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return "photon-" + slug(text) + "-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".txt";
  }

  /* pinned first, then most recently touched, so a note you are typing in is
     always at the top of the pile without the list jumping around while you type */
  function sortNotes(list) {
    return Array.prototype.slice.call(list).sort(function (a, b) {
      if (!!b.pin !== !!a.pin) return b.pin ? 1 : -1;
      return (b.updated || 0) - (a.updated || 0);
    });
  }

  function blank(id) {
    var now = Date.now();
    return { id: id || ("n" + now.toString(36) + Math.floor(Math.random() * 1e4).toString(36)),
      text: "", created: now, updated: now, pin: false };
  }

  function normalize(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (n) {
      if (!n || typeof n !== "object") return;
      out.push({
        id: String(n.id || blank().id).slice(0, 40),
        text: String(n.text == null ? "" : n.text).slice(0, 200000),
        created: Number(n.created) || Date.now(),
        updated: Number(n.updated) || Number(n.created) || Date.now(),
        pin: !!n.pin
      });
    });
    return out;
  }

  function put(list, note) {
    var out = list.filter(function (n) { return n.id !== note.id; }).concat([note]);
    if (out.length > MAX_NOTES) {
      out = sortNotes(out).slice(0, MAX_NOTES);
    }
    return out;
  }
  function remove(list, id) { return list.filter(function (n) { return n.id !== id; }); }

  function matches(note, q) {
    var needle = String(q || "").toLowerCase().trim();
    if (!needle) return { hit: true, count: 0, where: [] };
    var t = String(note.text || "").toLowerCase();
    var words = needle.split(/\s+/).filter(Boolean);
    var count = 0, where = [];
    words.forEach(function (w) {
      var from = 0, i;
      while ((i = t.indexOf(w, from)) !== -1) { count++; where.push(i); from = i + w.length; if (count > 400) break; }
    });
    return { hit: count > 0, count: count, where: where };
  }

  function exportAll(list) {
    return sortNotes(list).map(function (n, i) {
      return "=== " + (i + 1) + ". " + titleOf(n.text) + " ===\n" +
        "written " + new Date(n.created).toISOString().slice(0, 10) +
        " · touched " + new Date(n.updated).toISOString().slice(0, 10) +
        (n.pin ? " · pinned" : "") + "\n" +
        (n.text || "").trim() + "\n";
    }).join("\n");
  }

  /* reads back its own export: the "=== 1. Title ===" headers split the notes.
     A plain .txt with no headers comes in as one note, which is the common case. */
  function importText(text) {
    var src = String(text || "").replace(/\r/g, "");
    var re = /^===\s*\d+\.\s*(.*)$/gm, marks = [], m;
    while ((m = re.exec(src))) {
      marks.push({ end: re.lastIndex, start: m.index, title: m[1].trim().replace(/\s*===$/, "").trim() });
    }
    var out = [];
    if (!marks.length) {
      var only = src.trim();
      if (only) out.push(Object.assign(blank(), { text: only }));
      return out;
    }
    marks.forEach(function (mk, i) {
      var stop = (i + 1 < marks.length) ? marks[i + 1].start : src.length;
      var lines = src.slice(mk.end, stop).split("\n");
      while (lines.length && !lines[0].trim()) lines.shift();
      if (lines.length && /^written /.test(lines[0].trim())) lines.shift();
      var body = lines.join("\n").trim();
      var full = (mk.title && body.indexOf(mk.title) !== 0) ? (mk.title + "\n" + body) : body;
      if (full.trim()) out.push(Object.assign(blank(), { text: full }));
    });
    return out;
  }

  function stamp(ts) {
    var d = new Date(ts), now = Date.now(), diff = (now - ts) / 1000;
    if (!isFinite(ts) || diff < 0) return "—";
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + " min ago";
    if (diff < 86400) return Math.floor(diff / 3600) + " h ago";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + " d ago";
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  return {
    KEY: KEY, MAX_NOTES: MAX_NOTES,
    count: count, titleOf: titleOf, slug: slug, fileName: fileName, sortNotes: sortNotes,
    blank: blank, normalize: normalize, put: put, remove: remove, matches: matches,
    exportAll: exportAll, importText: importText, stamp: stamp
  };
});
