/* ===========================================================================
   directory.js — the shared plumbing of the hub.

   Four jobs, all of them small:
     1. print the index onto a page, line by line, the way a directory does
     2. keep the webring and the nav honest about where you are standing
     3. turn a dashed drawing slot into the drawing as soon as it is dropped in
     4. hold the pins you add yourself, in this browser only

   No framework, no build step, no network. Everything hangs off one global,
   PH, so a page can use as much or as little of it as it wants.
   =========================================================================== */

(function (root) {
  "use strict";

  var PH = {};

  /* ---------- tiny dom helpers ---------- */
  PH.qs = function (sel, at) { return (at || document).querySelector(sel); };
  PH.qsa = function (sel, at) {
    return Array.prototype.slice.call((at || document).querySelectorAll(sel));
  };
  PH.on = function (el, ev, fn) { if (el) el.addEventListener(ev, fn); };

  PH.esc = function (str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };

  PH.fmtBytes = function (n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) return "—";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
    return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + " MB";
  };

  /* ---------- storage that never throws ----------
     localStorage explodes on file:// in some browsers and in private windows in
     others, so every access goes through here and a failure just means the page
     is forgetful for this visit instead of broken. */
  PH.store = (function () {
    var ok = false, mem = {};
    try {
      var k = "__ph_probe__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      ok = true;
    } catch (e) { ok = false; }

    return {
      available: ok,
      get: function (key, fallback) {
        try {
          var raw = ok ? window.localStorage.getItem(key) : mem[key];
          return raw == null ? fallback : JSON.parse(raw);
        } catch (e) { return fallback; }
      },
      set: function (key, value) {
        var raw;
        try { raw = JSON.stringify(value); } catch (e) { return false; }
        try {
          if (ok) window.localStorage.setItem(key, raw); else mem[key] = raw;
          return true;
        } catch (e) { mem[key] = raw; return false; }
      },
      del: function (key) {
        try { if (ok) window.localStorage.removeItem(key); } catch (e) {}
        delete mem[key];
      }
    };
  })();

  /* ---------- the index ---------- */
  PH.sites = function () {
    return (typeof PHOTON_SITES !== "undefined") ? PHOTON_SITES : [];
  };
  PH.byId = function (id) {
    var list = PH.sites();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };
  PH.ordered = function () {
    var order = (typeof PHOTON_ORDER !== "undefined") ? PHOTON_ORDER : [];
    var out = [], seen = {};
    for (var i = 0; i < order.length; i++) {
      var s = PH.byId(order[i]);
      if (s) { out.push(s); seen[s.id] = true; }
    }
    PH.sites().forEach(function (s) { if (!seen[s.id]) out.push(s); });
    return out;
  };

  /* ---------- links ----------
     A pin can point at a sibling file or at the wider web. Anything that is not
     one of these is refused, which also quietly refuses javascript: URLs. */
  PH.safeHref = function (href) {
    var v = String(href || "").trim();
    if (!v) return null;
    if (/^(javascript|data|vbscript):/i.test(v)) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
      return /^(https?|mailto):/i.test(v) ? v : null;
    }
    if (/^\/\//.test(v)) return null;          /* protocol-relative: refuse */
    if (/[<>"'\s`]/.test(v)) return null;
    return v;
  };
  PH.isExternal = function (href) { return /^([a-z][a-z0-9+.-]*:)?\/\//i.test(href); };

  PH.relPath = function (href) {
    /* used for the "does this sibling file actually exist" checks */
    return PH.isExternal(href) ? null : href.replace(/^\.\/+/, "");
  };

  /* ---------- pins: your own entries, kept in this browser ---------- */
  var PINS_KEY = "photon.pins.v1";
  PH.pins = function () {
    var list = PH.store.get(PINS_KEY, []);
    return Array.isArray(list) ? list.filter(function (p) { return p && p.title; }) : [];
  };
  PH.savePins = function (list) {
    var clean = (list || []).map(function (p) {
      return {
        id: "pin-" + String(p.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 28) + "-" + (p.stamp || 0),
        title: String(p.title).slice(0, 80),
        href: p.href,
        cat: "pinned",
        kicker: "pinned by you",
        blurb: String(p.blurb || "").slice(0, 400),
        weight: "—",
        status: "pinned",
        keys: String(p.keys || "").slice(0, 200),
        stamp: p.stamp || Date.now(),
        external: PH.isExternal(p.href)
      };
    });
    PH.store.set(PINS_KEY, clean);
    return clean;
  };
  PH.addPin = function (pin) {
    var list = PH.pins();
    var stamp = Date.now();
    var href = PH.safeHref(pin.href);
    if (!pin.title || !pin.title.trim()) return { error: "A pin needs a name." };
    if (!href) return { error: "That address is not something the hub will link to. Use a file in this folder, http:// or https://." };
    list.push({ title: pin.title.trim(), href: href, blurb: (pin.blurb || "").trim(), keys: (pin.keys || "").trim(), stamp: stamp });
    PH.savePins(list);
    return { ok: true, href: href };
  };
  PH.dropPin = function (id) {
    PH.savePins(PH.pins().filter(function (p) { return p.id !== id; }));
  };

  /* ---------- scoring for the search page ---------- */
  PH.score = function (site, q) {
    var needle = String(q || "").toLowerCase().trim();
    if (!needle) return 1;
    var words = needle.split(/\s+/);
    var total = 0, missed = 0;
    var hay = {
      title: (site.title || "").toLowerCase(),
      blurb: (site.blurb || "").toLowerCase() + " " + (site.kicker || "").toLowerCase(),
      keys: (" " + (site.keys || "") + " " + (site.id || "")).toLowerCase(),
      file: (site.file || "").toLowerCase()
    };
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w) continue;
      var hit = 0;
      if (hay.title.indexOf(w) !== -1) hit += hay.title.indexOf(w) === 0 ? 12 : 8;
      if (hay.file.indexOf(w) !== -1) hit += 5;
      if (hay.keys.indexOf(" " + w) !== -1 || hay.keys.indexOf(" " + w + " ") !== -1) hit += 7;
      else if (hay.keys.indexOf(w) !== -1) hit += 4;
      if (hay.blurb.indexOf(w) !== -1) hit += 3;
      if (!hit) missed++;
      total += hit;
    }
    if (missed) total -= missed * 2;
    return total > 0 ? total : 0;
  };

  PH.search = function (q, cat) {
    var pool = PH.ordered().concat(PH.pins());
    var out = [];
    pool.forEach(function (s) {
      if (cat && cat !== "all" && s.cat !== cat) return;
      var sc = PH.score(s, q);
      if (sc > 0) out.push({ site: s, score: sc });
    });
    out.sort(function (a, b) { return b.score - a.score || a.site.title.localeCompare(b.site.title); });
    return out.map(function (o) { return o.site; });
  };

  /* ---------- rendering one directory row ---------- */
  PH.rowHTML = function (site, n, opts) {
    opts = opts || {};
    var dot = site.status === "pinned" ? "hold" : (site.status === "open" ? "ok" : "off");
    var ext = site.external ? " <span class=\"xs faint\">OFF-SITE</span>" : "";
    var kill = opts.deletable
      ? '<button type="button" class="btn del-pin" data-del="' + PH.esc(site.id) + '" title="Take this pin off the index">unpin</button>'
      : "";
    var sub = site.blurb ? '<span class="sub">' + PH.esc(site.blurb) + "</span>" : "";
    return '<div class="dir-row" data-id="' + PH.esc(site.id) + '">' +
      '<span class="n">' + n + ".</span>" +
      '<span class="who">' +
        '<a href="' + PH.esc(site.file || site.href) + '">' + PH.esc(site.title) + "</a>" + ext +
        "<br>" + sub +
        (site.kicker ? '<br><span class="xs dim">' + '<span class="dot ' + dot + '"></span>' + PH.esc(site.kicker) + "</span>" : "") +
      "</span>" +
      '<span class="meta">' + PH.esc(site.weight || "—") + "</span>" +
      '<span class="go row">' + kill +
        '<a class="btn" href="' + PH.esc(site.file || site.href) + '">open &rarr;</a>' +
      "</span>" +
      "</div>";
  };

  /* stagger already-built rows in. Split out from PH.print so a page can print
     something that is not a site listing — the game shelf, search results —
     with the same timing rather than a second, slightly different animation. */
  PH.reveal = function (rows, speed) {
    var reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    var ms = reduce ? 0 : (speed == null ? 55 : speed);
    if (ms <= 0) {
      rows.forEach(function (r) { r.classList.add("shown"); });
      return Promise.resolve(rows.length);
    }
    var host = rows[0] && rows[0].parentNode;
    if (host) host.classList.add("printing");
    /* the print head: a block caret that rides at the bottom of the list while it
       comes out, and is gone when the listing is finished. Nothing else blinks. */
    var caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "\u2588";
    caret.setAttribute("aria-hidden", "true");
    return new Promise(function (resolve) {
      var i = 0;
      (function tick() {
        if (i >= rows.length) {
          if (host) {
            host.classList.remove("printing");
            if (caret.parentNode) caret.parentNode.removeChild(caret);
          }
          resolve(rows.length);
          return;
        }
        rows[i].classList.add("shown");
        if (host) host.appendChild(caret);
        i++;
        setTimeout(tick, ms);
      })();
    });
  };

  /* ---------- printing a directory ----------
     This is the one piece of motion the hub is allowed. It only runs where a
     listing is actually being put on the screen, it is never replayed on
     scroll, and it goes straight to the finished state when the visitor has
     asked for less motion. */
  PH.print = function (host, sites, opts) {
    opts = opts || {};
    var reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    var speed = reduce ? 0 : (opts.speed == null ? 55 : opts.speed);

    host.classList.add("dir");
    if (!sites.length) {
      host.classList.remove("printing");
      host.innerHTML = '<div class="dir-row"><span class="who"><span class="sub">' +
        PH.esc(opts.empty || "Nothing in the index matches that. The hub holds " +
        PH.ordered().length + " sites; try a shorter word.") + "</span></span></div>";
      return Promise.resolve(sites.length);
    }

    var html = sites.map(function (s, i) {
      return PH.rowHTML(s, i + 1, { deletable: s.cat === "pinned" && !!opts.allowDelete });
    }).join("");
    host.innerHTML = html;
    var rows = PH.qsa(".dir-row", host);
    if (opts.done) opts.done(sites);

    if (speed <= 0) {
      rows.forEach(function (r) { r.classList.add("shown"); });
      return Promise.resolve(sites.length);
    }

    return PH.reveal(rows, speed);
  };

  /* ---------- drawing slots ----------
     A .draw slot with data-art="img/x.png" is swapped for the real image the
     moment that file exists, and stays a dashed brief while it does not. */
  /* Does a file exist next to us? Over http a cache-buster is polite; over
     file:// it is fatal, because "?probe=173…" becomes part of the name the
     disk is asked for, so a drawing that is already there would read as missing. */
  PH.probeSrc = function (path) {
    if (!path) return path;
    if (location.protocol === "file:") return path;
    return path + (path.indexOf("?") === -1 ? "?" : "&") + "probe=" + Date.now();
  };

  PH.hydrateArt = function (at) {
    var slots = PH.qsa('[data-art]', at || document);
    var filled = 0, missing = [];
    slots.forEach(function (slot) {
      var src = slot.getAttribute("data-art");
      var alt = slot.getAttribute("data-alt") || "";
      var probe = new Image();
      probe.onload = function () {
        if (!probe.naturalWidth) { slot.setAttribute("data-pending", "1"); return; }
        var fig = document.createElement("figure");
        fig.style.margin = "0";
        var img = document.createElement("img");
        img.src = src;
        img.alt = alt;
        img.setAttribute("width", slot.getAttribute("data-w") || "");
        img.style.display = "block";
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        img.style.border = "1px solid #223050";
        img.style.borderRadius = "2px";
        img.style.background = "#e8e3d9";
        fig.appendChild(img);
        var cap = document.createElement("figcaption");
        cap.className = "xs faint";
        cap.textContent = src;
        fig.appendChild(cap);
        slot.parentNode.replaceChild(fig, slot);
        filled++;
      };
      probe.onerror = function () { slot.setAttribute("data-pending", "1"); missing.push(src); };
      probe.src = PH.probeSrc(src);
    });
    return { total: slots.length, missing: missing, filled: function () { return filled; } };
  };

  /* ---------- the visit counter, honest about what it counts ---------- */
  var VISITS_KEY = "photon.visits.v1";
  PH.visits = function () {
    var v = PH.store.get(VISITS_KEY, null);
    if (!v || typeof v !== "object") v = { count: 0, first: null, last: null };
    v.count += 1;
    if (!v.first) v.first = Date.now();
    v.last = Date.now();
    PH.store.set(VISITS_KEY, v);
    return v;
  };
  PH.odometer = function (host, number, pad) {
    var s = String(Math.max(0, Math.floor(number)));
    while (s.length < (pad || 5)) s = "0" + s;
    host.innerHTML = s.split("").map(function (d) { return "<span>" + d + "</span>"; }).join("");
  };

  /* ---------- nav + webring, both derived from the filename ---------- */
  PH.pageName = function () {
    var p = location.pathname.split("/").pop() || "index.html";
    return p === "" ? "index.html" : p;
  };
  PH.markNav = function (at) {
    var here = PH.pageName();
    PH.qsa("nav a.btn", at || document).forEach(function (a) {
      var href = (a.getAttribute("href") || "").split("#")[0];
      if (href === here) a.classList.add("on");
    });
  };
  PH.ringHTML = function () {
    var ring = (typeof PHOTON_RING !== "undefined") ? PHOTON_RING : [];
    var here = PH.pageName();
    var i = ring.indexOf(here);
    if (i < 0) i = 0;
    var prev = ring[(i - 1 + ring.length) % ring.length];
    var next = ring[(i + 1) % ring.length];
    var nameOf = function (f) { return f.replace(/\.html$/, ""); };
    return '<span>PHOTON RING · <span class="mid">' + PH.esc(nameOf(here)) + "</span> · page " +
      (i + 1) + " of " + ring.length + "</span>" +
      '<span class="row"><a class="btn" href="' + prev + '">&larr; ' + PH.esc(nameOf(prev)) + "</a>" +
      '<a class="btn" href="' + next + '">' + PH.esc(nameOf(next)) + " &rarr;</a></span>";
  };
  PH.mountRing = function (host) {
    if (!host) return;
    host.innerHTML = PH.ringHTML();
  };

  /* ---------- status: does every link in the box still resolve ---------- */
  PH.checkLinks = function (files) {
    var list = files || PH.sites().map(function (s) { return s.file; });
    return Promise.all(list.map(function (f) {
      return new Promise(function (resolve) {
        var x = new XMLHttpRequest();
        x.open("HEAD", f, true);
        x.timeout = 4000;
        x.onreadystatechange = function () {
          if (x.readyState === 4) resolve({ file: f, ok: x.status >= 200 && x.status < 400 });
        };
        x.ontimeout = function () { resolve({ file: f, ok: false }); };
        x.onerror = function () { resolve({ file: f, ok: false }); };
        try { x.send(); } catch (e) { resolve({ file: f, ok: false }); }
      });
    }));
  };

  PH.stamp = function (ts) {
    try {
      return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (e) { return "—"; }
  };

  window.PH = PH;
})(typeof window !== "undefined" ? window : this);
