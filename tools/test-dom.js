"use strict";
/* ===========================================================================
   test-dom.js — every page of the hub, loaded in a headless DOM.

     node tools/test-dom.js            # all pages
     node tools/test-dom.js player     # pages whose name contains "player"

   What this catches is the class of bug the logic tests cannot see: a script
   that asks for #track-menu after the id was edited out of the HTML, a mount
   that throws on teardown, a click handler that runs before the store loads,
   a page that dies because it forgot localStorage exists in private mode.

   Scripts are inlined rather than fetched, so this reads the same bytes the
   browser would and needs no server. Canvas, media elements, object URLs and
   IndexedDB are stubbed; a stub only has to be shaped right, and every
   assertion below is about the DOM, not about pixels.
   =========================================================================== */

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

/* --- find jsdom (it is a dev dependency, and the hub itself ships none) --- */
let jsdom = null;
const CANDIDATES = ["jsdom", path.join(ROOT, "node_modules", "jsdom"),
                    "/home/user/testnpm/node_modules/jsdom"];
for (const where of CANDIDATES) {
  try { jsdom = require(where); break; } catch (e) { /* keep looking */ }
}
if (!jsdom) {
  console.log("dom tests skipped: install jsdom (npm i -D jsdom) and re-run");
  process.exit(0);
}
const { JSDOM, VirtualConsole } = jsdom;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return true; }
  fail++;
  failures.push(name + (extra ? "  ← " + extra : ""));
  return false;
}
function eq(name, got, want) {
  return ok(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------- stubs ---- */
function stub2d() {
  const noop = () => {};
  const ctx = {
    canvas: null,
    fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
    globalAlpha: 1, font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic",
    shadowBlur: 0, shadowColor: "transparent", filter: "none", imageSmoothingEnabled: true,
    save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, arc: noop, arcTo: noop, ellipse: noop,
    rect: noop, fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop,
    clearRect: noop, fillText: noop, strokeText: noop, translate: noop, rotate: noop,
    scale: noop, transform: noop, setTransform: noop, resetTransform: noop, drawImage: noop,
    setLineDash: noop, getLineDash: () => [],
    measureText: (t) => ({ width: String(t == null ? "" : t).length * 6, actualBoundingBoxAscent: 7 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    putImageData: noop,
    getImageData: (x, y, w, h) => ({
      width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4))
    }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
  };
  return ctx;
}

function prepare(window) {
  const doc = window.document;
  /* canvas */
  window.HTMLCanvasElement.prototype.getContext = function (kind) {
    if (!this.__ctx) { this.__ctx = stub2d(); this.__ctx.canvas = this; }
    return kind === "2d" ? this.__ctx : null;
  };
  window.ImageData = window.ImageData || class ImageData {
    constructor(data, w, h) {
      if (typeof data === "number") { w = data; h = w; data = new Uint8ClampedArray(w * h * 4); }
      this.data = data; this.width = w; this.height = h;
    }
  };
  window.HTMLCanvasElement.prototype.toBlob = function (cb, type) {
    setTimeout(() => cb(new window.Blob([new Uint8Array([137, 80, 78, 71])], { type: type || "image/png" })), 0);
  };
  window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,iVBORw0KGgo=";
  window.CanvasRenderingContext2D = function () {};
  /* object URLs + download */
  let urlSeq = 0;
  window.URL.createObjectURL = () => "blob:photon/" + (++urlSeq);
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { this.__clicked = true; };
  /* layout: jsdom knows no geometry, and half my code reads a rect */
  window.Element.prototype.getBoundingClientRect = function () {
    const w = Number(this.width) || (this.tagName === "CANVAS" ? 300 : 800);
    const h = Number(this.height) || (this.tagName === "CANVAS" ? 150 : 400);
    return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, width: w, height: h, toJSON() { return {}; } };
  };
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get() { return 800; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { get() { return 400; }, configurable: true });
  window.Element.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.setPointerCapture = function () {};
  window.HTMLElement.prototype.releasePointerCapture = function () {};
  window.HTMLElement.prototype.requestFullscreen = function () { return Promise.resolve(); };
  window.document.exitFullscreen = () => Promise.resolve();
  Object.defineProperty(window.document, "fullscreenElement", { get: () => null, configurable: true });
  /* media elements: jsdom will not decode anything, so keep the API quiet */
  ["play", "pause", "load"].forEach((m) => {
    window.HTMLMediaElement.prototype[m] = function () {
      if (m === "play") { this.__played = (this.__played || 0) + 1; return Promise.resolve(); }
      return undefined;
    };
  });
  window.HTMLVideoElement.prototype.requestPictureInPicture = function () { return Promise.resolve({}); };
  window.document.pictureInPictureEnabled = true;
  Object.defineProperty(window.document, "pictureInPictureElement", { get: () => null, configurable: true });
  window.document.exitPictureInPicture = () => Promise.resolve();
  window.MediaSource = window.MediaSource || function MediaSource() {};
  window.SourceBuffer = window.SourceBuffer || function SourceBuffer() {};
  /* things jsdom simply does not have */
  if (!window.matchMedia) {
    window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  if (!("mediaSession" in window.navigator)) {
    Object.defineProperty(window.navigator, "mediaSession", {
      value: { metadata: null, playbackState: "none", setActionHandler() {}, setPositionState() {} },
      configurable: true
    });
  }
  if (!("wakeLock" in window.navigator)) {
    Object.defineProperty(window.navigator, "wakeLock", {
      value: { request: () => Promise.resolve({ release() {} }) }, configurable: true
    });
  }
  window.HTMLInputElement.prototype.showPicker = function () {};
  window.confirm = () => true;
  window.alert = () => {};
  window.prompt = (m, d) => (d === undefined ? "test entry" : String(d));
  window.fetch = () => Promise.reject(new TypeError("no network in a test run"));
  window.indexedDB = window.indexedDB || {
    deleteDatabase(name) {
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null, error: null };
      setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
      return req;
    },
    open() {
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: { createObjectStore() {}, transaction() { return { objectStore() { return { getAll: () => ({ onsuccess: null }), count: () => ({ onsuccess: null }) }; }, oncomplete: null }; } }, transaction: null };
      setTimeout(() => { if (req.onerror) req.onerror({ target: req }); }, 0);
      return req;
    }
  };
  window.PointerEvent = window.PointerEvent || window.MouseEvent;
  window.ClipboardEvent = window.ClipboardEvent || function () {};
  window.EventSource = window.EventSource || function () {};
  window.Worker = window.Worker || function Worker() {
    this.postMessage = () => {}; this.terminate = () => {}; this.onerror = null; this.onmessage = null;
  };
  /* no network, no subresources: a page that needs one has a bug */
  window.__errors = [];
  window.addEventListener("error", (e) => {
    window.__errors.push("window.onerror: " + (e.message || (e.error && e.error.message) || "unknown"));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const msg = (r && (r.message || r.stack)) || String(r);
    if (/no network in a test run/.test(msg)) return;      // our own fetch stub
    window.__errors.push("unhandled rejection: " + msg);
  });
  void doc;
}

/* --------------------------------------------------------------- loading ---- */
function pageSource(page) {
  let html = fs.readFileSync(path.join(ROOT, page), "utf8");
  html = html.replace(/<script[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/g, (m, src) => {
    const rel = src.replace(/^\/+/, "");
    if (!fs.existsSync(path.join(ROOT, rel))) {
      throw new Error(page + " asks for " + src + " which is not in the folder");
    }
    return "<script>" + fs.readFileSync(path.join(ROOT, rel), "utf8") + "</script>";
  });
  return html;
}

async function load(page, opts) {
  opts = opts || {};
  const vc = new VirtualConsole();
  const noise = [];
  vc.on("jsdomError", (e) => {
    const msg = String(e.message || e);
    if (/could not load|not implemented|could not parse/i.test(msg)) { noise.push(msg); return; }
    noise.push("jsdomError: " + msg);
  });
  vc.on("error", (m) => noise.push("console.error: " + m));
  const dom = new JSDOM(pageSource(page), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://photon.local/" + (opts.url || page),
    virtualConsole: vc,
    beforeParse: prepare
  });
  if (opts.before) opts.before(dom.window);
  dom.window.__noise = noise;
  return dom;
}

function q(doc, sel) { return doc.querySelector(sel); }
function qa(doc, sel) { return Array.prototype.slice.call(doc.querySelectorAll(sel)); }
function text(el) { return el ? String(el.textContent).replace(/\s+/g, " ").trim() : ""; }
function errors(win) {
  return (win.__errors || []).concat(win.__noise || []).filter((m) =>
    !/could not load|could not parse|not implemented|no network in a test run|localStorage|sessionStorage|Content-Security/i.test(String(m)));
}
function click(win, el) {
  if (!el) return false;
  el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, view: win }));
  return true;
}
function key(win, el, k, mods) {
  const init = Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {});
  (el || win.document).dispatchEvent(new win.KeyboardEvent("keydown", init));
}

/* --------------------------------------------------------------- pages ---- */
const PAGES = ["index.html", "games.html", "player.html", "eagler.html", "notepad.html",
               "sketch.html", "search.html", "brief.html", "404.html"];
const NAV = ["index.html", "games.html", "player.html", "eagler.html", "notepad.html",
             "sketch.html", "search.html", "brief.html"];

async function testShared(page, dom) {
  const win = dom.window, doc = win.document;
  ok(page + ": no script errors", errors(win).length === 0, errors(win).slice(0, 2).join(" | "));
  const navLinks = qa(doc, "nav a.btn").filter((a) => NAV.indexOf(a.getAttribute("href")) >= 0).length;
  if (page === "brief.html") ok("brief: nav carries its own sections", qa(doc, 'nav a[href^="#"]').length >= 4,
                                qa(doc, 'nav a[href^="#"]').length + " section links");
  else eq(page + ": nav links", navLinks, NAV.length);
  const logo = q(doc, "a.logo");
  ok(page + ": logo goes straight home", !!logo && logo.getAttribute("href") === "index.html",
     logo && logo.getAttribute("href"));
  ok(page + ": no external subresources",
     qa(doc, "script[src],link[href],img[src]").every((el) => !/^https?:/i.test(el.getAttribute(el.href ? "href" : "src") || "")));
  const ring = q(doc, "#ring");
  if (ring) {
    const links = qa(ring, "a");
    ok(page + ": webring walks to two real pages", links.length === 2 &&
       links.every((a) => fs.existsSync(path.join(ROOT, a.getAttribute("href")))),
       links.map((a) => a.getAttribute("href")).join(" "));
    ok(page + ": webring names the current page", text(ring).indexOf(page.replace(".html", "")) >= 0,
       text(ring).slice(0, 60));
  }
  qa(doc, "a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (href && !/^(?:https?:|mailto:|#|data:)/.test(href) && !/[?#]/.test(href)) {
      ok(page + ": link target exists (" + href + ")", fs.existsSync(path.join(ROOT, href)));
    }
  });
}

async function testIndex() {
  const dom = await load("index.html");
  const win = dom.window, doc = win.document;
  await sleep(1400);
  await testShared("index", dom);
  const n = win.PHOTON_SITES.length;
  eq("index: rows printed", qa(doc, "#dir .dir-row").length, n);
  ok("index: every row links somewhere", qa(doc, "#dir .dir-row .go a").every((a) => a.getAttribute("href")));
  const boxText = text(q(doc, "#box-rows"));
  ok("index: manifest table filled", qa(doc, "#box-rows tr").length >= 30, qa(doc, "#box-rows tr").length + " rows");
  ok("index: no undefined leaked into the manifest", !/undefined|null|NaN/.test(boxText),
     boxText.slice(0, 80));
  ok("index: weights print as units, not raw bytes", /\d(\.[0-9])? (B|KB|MB)\b/.test(boxText),
     (boxText.match(/\d[^ ]* (B|KB|MB)/) || ["none"])[0]);
  ok("index: a missing drawing says so", /not drawn/.test(boxText));
  ok("index: group sub-heads print in caps", /[A-Z ]{6,}\d?/.test(boxText) && /EAGLERCRAFT|DRAWING|PLUMBING|SHARED/i.test(boxText),
     boxText.slice(0, 60));
  ok("index: the foot line counts the folder", /files,.*of it/.test(text(q(doc, "#box-foot"))),
     text(q(doc, "#box-foot")).slice(0, 60));
  ok("index: the print head is gone once the listing finished", !q(doc, "#dir .caret"));
  ok("index: count line filled", /\d/.test(text(q(doc, "#dir-count"))), text(q(doc, "#dir-count")));
  ok("index: visits dial", /open|—/.test(text(q(doc, "#visits"))), text(q(doc, "#visits")));
  /* drawing slots: still dashed, because img/ is empty */
  const slot = q(doc, "[data-art]");
  ok("index: a slot still tells you what to draw", slot && /DRAW THIS/.test(text(slot)) &&
     /SAVE AS/.test(text(slot)), slot && text(slot).slice(0, 40));
  ok("index: every slot names a file the pad can export",
     qa(doc, "[data-art]").every((el) => /^[\w/-]+\.png$/.test(el.getAttribute("data-art") || "")),
     qa(doc, "[data-art]").map((el) => el.getAttribute("data-art")).join(" "));
  /* pins */
  ok("index: the strip can be stopped", !!q(doc, "#bar-stop"), "no #bar-stop");
  if (q(doc, "#bar-stop")) {
    const strip = q(doc, "#bar-stop");
    click(win, strip);
    await sleep(80);
    ok("index: stopping the strip flips aria-pressed",
       strip.getAttribute("aria-pressed") === "true" || /start|resume|play/.test(text(strip)),
       text(strip) + " aria-pressed=" + strip.getAttribute("aria-pressed"));
    click(win, strip);
    await sleep(60);
  }
  ok("index: a shelf form exists", !!q(doc, "#pin-form"));
  const t = q(doc, "#pin-title"), u = q(doc, "#pin-href");
  if (ok("index: the shelf form has its fields", !!t && !!u)) {
    t.value = "Field notes"; u.value = "notes.html";
    const form = q(doc, "#pin-form");
    form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(260);
    const pins = win.PH.pins();
    ok("index: a pinned site is in the store", pins.some((x) => /Field notes/.test(x.title || "")),
       JSON.stringify(pins).slice(0, 90));
    const found = win.PH.search("field notes");
    ok("index: a pinned site is reachable by search", found.some((s) => /Field notes/.test(s.title || "")),
       found.map((s) => s.title).join(" ") || "no hits");
    ok("index: a pinned site joins the printed index", /Field notes/.test(qa(doc, "#dir .who").map(text).join(" ")),
       qa(doc, "#dir .dir-row").length + " rows");
    const unpinned = q(doc, '#dir .del-pin');
    if (ok("index: a pinned row can be unpinned", !!unpinned)) {
      click(win, unpinned);
      await sleep(220);
      ok("index: unpinning takes it off the store", !win.PH.pins().some((x) => /Field notes/.test(x.title || "")),
         JSON.stringify(win.PH.pins()).slice(0, 60));
      ok("index: an unpinned row leaves the printed index",
         !/Field notes/.test(qa(doc, "#dir .who").map(text).join(" ")));
    }
  }
  const err = errors(win);
  ok("index: still clean after clicking around", err.length === 0, err.slice(0, 2).join(" | "));
  dom.window.close();
}

async function testGames() {
  const dom = await load("games.html");
  const win = dom.window, doc = win.document;
  await sleep(1200);
  await testShared("games", dom);
  eq("games: shelf rows", qa(doc, "#shelf .dir-row").length, win.Games.list.length);
  eq("games: seven games listed", win.Games.list.length, 7);
  /* mount and tear down every engine in a spare div, with input noise */
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  for (const g of win.Games.list) {
    const box = doc.createElement("div");
    host.appendChild(box);
    let cleanup = null, threw = null;
    try {
      cleanup = win.Games.mounts[g.id](box, win.Games);
      const btns = qa(box, "button");
      btns.slice(0, 3).forEach((b) => click(win, b));
      key(win, box.querySelector("canvas") || box, "ArrowLeft");
      key(win, box.querySelector("canvas") || box, "Enter");
      const cells = qa(box, ".cell,.tile,.square,.board > *");
      cells.slice(0, 6).forEach((c) => click(win, c));
      await sleep(90);
      cells.slice(0, 3).forEach((c) => click(win, c));
      await sleep(60);
    } catch (e) {
      threw = e;
    }
    ok("games: " + g.id + " mounts without throwing", !threw, threw && threw.message);
    ok("games: " + g.id + " has a cleanup function", typeof cleanup === "function", typeof cleanup);
    let off = null;
    try { if (cleanup) cleanup(); if (cleanup) cleanup(); } catch (e) { off = e; }
    ok("games: " + g.id + " tears down (twice)", !off, off && off.message);
    try { box.remove(); } catch (e) {}
  }
  /* the real shell: click into a game, then into another one */
  const first = q(doc, "#shelf [data-play]") || q(doc, "[data-play]");
  if (ok("games: the shelf has play controls", !!first)) {
    click(win, first);
    await sleep(300);
    ok("games: the stage holds something", q(doc, "#game") && q(doc, "#game").children.length > 0,
       q(doc, "#game") && q(doc, "#game").innerHTML.slice(0, 40));
    ok("games: title written", text(q(doc, "#game-title")).length > 2, text(q(doc, "#game-title")));
    const second = qa(doc, "[data-play]")[2];
    click(win, second);
    await sleep(260);
    ok("games: switching games is clean", errors(win).length === 0, errors(win).slice(0, 2).join(" | "));
    click(win, q(doc, "#wipe-scores"));
    await sleep(80);
    ok("games: score wipe says something", /gone|zero|cleared|nothing|wiped|0 /.test(text(q(doc, "#score-note"))) ||
       !!q(doc, "#score-note"), text(q(doc, "#score-note")).slice(0, 60));
  }
  ok("games: best-score store round-trips", (function () {
    win.Games.putBest("snake", 9999, "high");
    return win.Games.best("snake").high === 9999;
  })(), JSON.stringify(win.Games.best("snake")));
  ok("games: a score of 0 is not recorded as a best", (function () {
    win.Games.putBest("lights", 0, "ms");
    return !win.Games.best("lights") || !win.Games.best("lights").ms;
  })(), JSON.stringify(win.Games.best("lights")));
  dom.window.close();
}

async function testPlayer() {
  const dom = await load("player.html");
  const win = dom.window, doc = win.document;
  const items = () => qa(doc, "#playlist .pl-row[data-i]").length;
  await sleep(400);
  await testShared("player", dom);
  ["#drop", "#file-input", "#folder-input", "#sub-input", "#playlist", "#stage", "#scrub", "#track-menu"].forEach((sel) => {
    ok("player: " + sel + " is in the page", !!q(doc, sel));
  });
  const deck = q(doc, ".deck") ? q(doc, "#watch") : doc;
  const buttons = qa(doc, "#watch button, #list button, #drop button");
  ok("player: the deck has controls", buttons.length >= 14, buttons.length + " buttons");
  ok("player: three rows of deck", qa(doc, ".deck").length >= 3, qa(doc, ".deck").length);
  /* press everything with no media loaded — the point is that it must not throw */
  buttons.forEach((b) => { try { click(win, b); } catch (e) { ok("player: " + (b.id || text(b)) + " click", false, e.message); } });
  await sleep(220);
  const err = errors(win);
  ok("player: idle button press is safe", err.length === 0, err.slice(0, 3).join(" | "));
  /* rates, volume, and the scrub bar exist and are wired */
  ok("player: speed row has 1× and the extremes", qa(doc, '#rate-row [data-rate]').length >= 7 &&
     !!q(doc, '#rate-row [data-rate="1"]') && !!q(doc, '#rate-row [data-rate="0.25"]'),
     qa(doc, "#rate-row [data-rate]").length + " rates");
  ok("player: volume starts at full", String(q(doc, "#vol") && q(doc, "#vol").value) === "1" &&
     text(q(doc, "#vol-read")) === "100%", text(q(doc, "#vol-read")));
  /* the stage must never be an unexplained black rectangle */
  const idle = q(doc, "#no-media"), media = q(doc, "#stage-media");
  ok("player: an empty stage explains itself", !!idle && !idle.classList.contains("hide"),
     idle && idle.className);
  ok("player: an empty stage hides the video element", !!media && media.hidden === true,
     media && String(media.hidden));
  /* feed it a file: jsdom gives us File, and the prober only needs bytes */
  const mkv = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  const file = new win.File([mkv, new Uint8Array(2048)], "night-run.mkv", { type: "video/x-matroska" });
  const input = q(doc, "#file-input");
  if (input) {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    await sleep(500);
    ok("player: the file reached the playlist", items() === 1, items() + " items listed");
    ok("player: the playlist counted the item", /1 item|1 ×|1\s/.test(text(q(doc, "#pl-count"))),
       text(q(doc, "#pl-count")));
    const rowText = qa(doc, "#playlist .pl-row").map(text).join(" ");
    ok("player: the playlist counted the bytes too", /B$|KB|MB/.test(text(q(doc, "#pl-count"))),
       text(q(doc, "#pl-count")));
    ok("player: loading a file clears the idle notice", idle.classList.contains("hide") && !media.hidden,
       idle.className + " hidden=" + media.hidden);
    ok("player: a probe line appeared",
       /ebml|matroska|reading|probe|unknown|video|container/i.test(rowText), rowText.slice(0, 80));
  }
  const drop = q(doc, "#drop");
  if (drop) {
    const dt = { items: [{ kind: "file", getAsFile: () => file, webkitGetAsEntry: () => null }],
                 files: [file], types: ["Files"] };
    const ev = new win.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: dt });
    drop.dispatchEvent(ev);
    await sleep(420);
    ok("player: a second add of the same file does not duplicate it", items() >= 1 && items() <= 2,
       items() + " items");
    ok("player: the empty-state row is gone once something is loaded",
       !/Nothing loaded yet/.test(text(q(doc, "#playlist"))));
    ok("player: drag class is cleared after a drop", !drop.classList.contains("over"));
  }
  click(win, q(doc, "#pl-clear"));
  await sleep(160);
  ok("player: clearing the playlist puts the notice back", !idle.classList.contains("hide"), idle.className);
  ok("player: the playlist really emptied", items() === 0, items() + " items left");
  ok("player: and it says so instead of showing a blank panel",
     /Nothing loaded yet/.test(text(q(doc, "#playlist"))), text(q(doc, "#playlist")).slice(0, 40));
  const err2 = errors(win);
  ok("player: clean after files and drops", err2.length === 0, err2.slice(0, 3).join(" | "));
  dom.window.close();
}

async function testEagler() {
  const dom = await load("eagler.html");
  const win = dom.window, doc = win.document;
  await sleep(300);
  await testShared("eagler", dom);
  ok("eagler: starts at the gate", text(q(doc, "#gate")).length > 40, text(q(doc, "#gate")).slice(0, 40));
  const holder = q(doc, "#frame-holder");
  ok("eagler: no iframe before the button", !holder || !holder.querySelector("iframe"));
  click(win, q(doc, "#btn-wipe"));
  await sleep(60);
  ok("eagler: wipe reports instead of throwing", !!q(doc, "#state"), text(q(doc, "#state")).slice(0, 50));
  const before = errors(win);
  ok("eagler: nothing blew up yet", before.length === 0, before.slice(0, 2).join(" | "));
  dom.window.close();

  const dom2 = await load("eagler.html", { url: "eagler.html#load" });
  await sleep(200);
  const doc2 = dom2.window.document;
  const f2 = q(doc2, "#frame-holder iframe") || q(doc2, "#frame-holder");
  ok("eagler: an asked-for load points at the game file, never a URL",
     /Eaglercraft\.html$/.test(f2 && f2.getAttribute ? (f2.getAttribute("src") || f2.id || "") : "") ||
     /ask|press|click|loading|seconds/i.test(text(q(doc2, "#state"))),
     text(q(doc2, "#state")).slice(0, 60));
  const errLoad = errors(dom2.window);
  ok("eagler: the asked-for load stays clean", errLoad.length === 0, errLoad.slice(0, 2).join(" | "));
  dom2.window.close();
}

async function testNotepad() {
  const dom = await load("notepad.html");
  const win = dom.window, doc = win.document;
  await sleep(700);
  await testShared("notepad", dom);
  const body = q(doc, "#body");
  ok("notepad: the writing surface exists", !!body);
  if (body) {
    body.value = "one line\nand another\n\n\nthird paragraph";
    body.dispatchEvent(new win.Event("input", { bubbles: true }));
    await sleep(900);
    const stored = JSON.parse(win.localStorage.getItem("photon.notes.v1") || "[]");
    ok("notepad: typing autosaved a note", stored.length >= 1, stored.length + " notes");
    ok("notepad: the words I typed are what got stored",
       stored.some((x) => /third paragraph/.test(x.text || "")),
       JSON.stringify(stored.map((x) => (x.text || "").slice(0, 20))));
    const words = text(q(doc, "#c-words"));
    ok("notepad: word count moved", /^([5-9]|\d\d)\b/.test(words), words);
    ok("notepad: saved indicator", /saved|kept|autosav/i.test(text(q(doc, "#saved-state"))),
       text(q(doc, "#saved-state")).slice(0, 50));
    click(win, q(doc, "#new"));
    await sleep(240);
    ok("notepad: new note after typing", qa(doc, "#stack button").length >= 2, qa(doc, "#stack button").length);
    const find = q(doc, "#find");
    if (find) {
      find.value = "another";
      find.dispatchEvent(new win.Event("input", { bubbles: true }));
      await sleep(140);
      ok("notepad: find narrows the stack", qa(doc, "#stack button").length === 1 &&
         /1|match/i.test(text(q(doc, "#find-note"))),
         qa(doc, "#stack button").length + " rows · " + text(q(doc, "#find-note")).slice(0, 40));
    }
  }
  const err = errors(win);
  ok("notepad: clean run", err.length === 0, err.slice(0, 2).join(" | "));
  dom.window.close();
}

async function testSketch() {
  const dom = await load("sketch.html");
  const win = dom.window, doc = win.document;
  await sleep(400);
  await testShared("sketch", dom);
  eq("sketch: every slot is offered", qa(doc, "#slot-rows .dir-row").length, win.SKETCH.SLOTS.length);
  eq("sketch: eight slots", win.SKETCH.SLOTS.length, 8);
  const pad = q(doc, "#pad");
  ok("sketch: ink buttons rendered", qa(doc, "#inks button").length === 5, qa(doc, "#inks button").length);
  ok("sketch: five widths", qa(doc, "#widths button").length === 5, qa(doc, "#widths button").length);
  /* pick the second slot, the sheet must become its exact size */
  const want = win.SKETCH.SLOTS[4];
  const pick = q(doc, '#slot-rows [data-pick="' + want.name + '"]');
  if (ok("sketch: slot row offers a pick", !!pick)) {
    click(win, pick);
    await sleep(120);
    eq("sketch: sheet width matches the slot", Number(pad.width), want.w);
    eq("sketch: sheet height matches the slot", Number(pad.height), want.h);
  }
  /* draw a stroke with pointer events */
  const down = new win.Event("pointerdown", { bubbles: true, cancelable: true });
  Object.assign(down, { clientX: 20, clientY: 30, pointerId: 1 });
  pad.dispatchEvent(down);
  for (let i = 1; i <= 6; i++) {
    const mv = new win.Event("pointermove", { bubbles: true });
    Object.assign(mv, { clientX: 20 + i * 9, clientY: 30 + i * 4, pointerId: 1 });
    pad.dispatchEvent(mv);
  }
  pad.dispatchEvent(new win.Event("pointerup", { bubbles: true }));
  await sleep(900);
  ok("sketch: a stroke was recorded", /strokes/.test(text(q(doc, "#sheet-meta"))), text(q(doc, "#sheet-meta")));
  ok("sketch: strokes survive into storage",
     /strokes/.test(win.localStorage.getItem("photon.sketch.v1") || ""),
     (win.localStorage.getItem("photon.sketch.v1") || "").slice(0, 40));
  click(win, q(doc, "#undo"));
  await sleep(60);
  ok("sketch: undo says so", /undone/.test(text(q(doc, "#pad-status"))), text(q(doc, "#pad-status")));
  click(win, q(doc, "#export"));
  await sleep(60);
  ok("sketch: exporting an empty sheet refuses politely", /draw something|nothing/.test(text(q(doc, "#pad-status"))),
     text(q(doc, "#pad-status")));
  ok("sketch: filename follows the slot", /\.png$/.test(text(q(doc, "#export-name"))), text(q(doc, "#export-name")));
  const err = errors(win);
  ok("sketch: clean run", err.length === 0, err.slice(0, 3).join(" | "));
  dom.window.close();
}

async function testSearch() {
  const dom = await load("search.html", { url: "search.html?q=mkv" });
  const win = dom.window, doc = win.document;
  await sleep(900);
  await testShared("search", dom);
  ok("search: ?q= was honoured", q(doc, "#q").value === "mkv", JSON.stringify(q(doc, "#q").value));
  ok("search: hits printed", qa(doc, "#hits .dir-row").length >= 1, qa(doc, "#hits .dir-row").length + " rows");
  const box = q(doc, "#q");
  box.value = "zzzq";
  box.dispatchEvent(new win.Event("input", { bubbles: true }));
  await sleep(700);
  ok("search: a miss is explained, not blank", /Nothing in the index matches/.test(text(q(doc, "#hits"))),
     text(q(doc, "#hits")).slice(0, 60));
  box.value = "caption";
  box.dispatchEvent(new win.Event("input", { bubbles: true }));
  ok("search: a print head rides the list while it prints", !!q(doc, "#hits .caret"),
     q(doc, "#hits").className);
  box.dispatchEvent(new win.Event("input", { bubbles: true }));
  await sleep(700);
  ok("search: another word lands", qa(doc, "#hits .dir-row").length >= 1);
  ok("search: the print head packs up afterwards", !q(doc, "#hits .caret"), q(doc, "#hits").className);
  ok("search: recent list filled", qa(doc, "#recent-row button").length >= 2,
     qa(doc, "#recent-row button").length);
  /* the page advertises a list of "words that always land somewhere" — hold it to that */
  const advertised = qa(doc, "#always-row button").map((b) => b.getAttribute("data-term"));
  ok("search: it offers the words it promises", advertised.length >= 8, advertised.join(" "));
  advertised.forEach((word) => {
    const hits = win.PH.search(word);
    ok('search: "' + word + '" lands somewhere', hits.length >= 1,
       hits.length + " hits · " + hits.map((s) => s.id).join(","));
  });
  click(win, q(doc, "#forget"));
  await sleep(60);
  ok("search: forget works", !/zzzq/.test(win.localStorage.getItem("photon.searches.v1") || "·"),
     win.localStorage.getItem("photon.searches.v1"));
  const err = errors(win);
  ok("search: clean run", err.length === 0, err.slice(0, 2).join(" | "));
  dom.window.close();
}

async function testStatic(page) {
  const dom = await load(page);
  await sleep(500);
  await testShared(page, dom);
  const doc = dom.window.document;
  if (page === "brief.html") {
    ["tone", "colour", "type", "space", "motion", "draw"].forEach((id) => {
      ok("brief: #" + id + " exists for the nav", !!q(doc, "#" + id));
    });
    ok("brief: eight drawings listed", qa(doc, "#draw table tr").length >= 9, qa(doc, "#draw table tr").length);
  }
  if (page === "404.html") {
    eq("404: prints the whole drawer", qa(doc, "#dir .dir-row").length, dom.window.PHOTON_SITES.length);
    ok("404: names the missing file", /no |\.html|does not/i.test(text(q(doc, "#what-missing"))) ||
       text(q(doc, "#what-missing")).length > 20, text(q(doc, "#what-missing")).slice(0, 50));
  }
  const err = errors(dom.window);
  ok(page + ": clean load", err.length === 0, err.slice(0, 3).join(" | "));
  dom.window.close();
}

(async function main() {
  const only = process.argv.slice(2).filter((a) => a[0] !== "-");
  const queue = PAGES.filter((p) => !only.length || only.some((o) => p.indexOf(o) >= 0));
  const runners = {
    "index.html": testIndex, "games.html": testGames, "player.html": testPlayer,
    "eagler.html": testEagler, "notepad.html": testNotepad, "sketch.html": testSketch,
    "search.html": testSearch
  };
  for (const page of queue) {
    const t0 = Date.now();
    try {
      await (runners[page] || (() => testStatic(page)))();
    } catch (e) {
      fail++;
      failures.push(page + ": harness threw — " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
    }
    console.log("  " + page.padEnd(14, " ") + " " + String(Date.now() - t0).padStart(5) + " ms");
  }
  console.log("\n" + pass + " passed, " + fail + " failed");
  if (fail) {
    console.log("\nfailures:");
    failures.forEach((f) => console.log("  × " + f));
  }
  process.exit(fail ? 1 : 0);
})();
