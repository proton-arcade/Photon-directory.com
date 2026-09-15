/* ===========================================================================
   index-data.js — the whole hub, written down once.

   This file is the only place a site is described. The homepage directory,
   the search page, the webring and the footer all read from it, so an entry
   can never disagree with itself. Plain data on purpose: it is a typed array,
   not a fetch, so the hub still lists itself correctly when you open it
   straight off a memory stick with no server underneath.
   =========================================================================== */

var PHOTON_REVISION = "rev. 6";
var PHOTON_INDEXED = "14 Sep 2025";

var PHOTON_SITES = [
  {
    id: "cabinet",
    file: "games.html",
    title: "Game Cabinet",
    cat: "games",
    kicker: "games · seven of them · no download",
    blurb: "Snake, Minesweeper, 2048, Pong against the machine, a maze that is different every time you ask, Lights Out and a typing drill. All hand-written, all on one canvas or grid, all playable with the keyboard or a thumb.",
    weight: "94 KB",
    status: "open",
    keys: "snake minesweeper 2048 pong maze lights out typing drill tetris arcade retro game games play offline keyboard",
    art: { file: "img/cabinet.png", box: "IMAGE 3", px: "360 × 520" },
    notes: "Scores are kept in this browser only, in localStorage. Clearing site data clears them; there is no server to phone home to."
  },
  {
    id: "player",
    file: "player.html",
    title: "Media Player",
    cat: "video",
    kicker: "video & audio · mp4, mkv, webm, mp3",
    blurb: "Point it at a folder of files and it builds a playlist. Loads .srt and .vtt subtitles, remembers where you stopped, steps one frame at a time, loops an A to B range, and reads the container header to tell you why something will not play.",
    weight: "110 KB",
    status: "open",
    keys: "video player mkv mp4 webm mov avi matroska mp3 flac wav ogg subtitle subtitles caption captions srt vtt playlist seek frame step loop volume pip picture in picture media player offline",
    art: { file: "img/player.png", box: "IMAGE 4", px: "560 × 300" },
    notes: "Nothing is uploaded. Files are read as object URLs inside the page and released when you remove them or close the tab."
  },
  {
    id: "eagler",
    file: "eagler.html",
    title: "EaglercraftX 1.8",
    cat: "games",
    kicker: "minecraft 1.8 · one file · 17.2 MB",
    blurb: "The whole game is in the Eaglercraft.html file at the root of this folder: client, assets and launcher, base64'd and gzipped. It decompresses itself in the browser and boots to its own menu. Singleplayer needs no network at all.",
    weight: "17.2 MB",
    status: "open",
    keys: "eaglercraft eaglercraftx minecraft 1.8 1.8.8 java wasm game launch offline block relay relays multiplayer server lobby ping",
    art: { file: "img/eagler.png", box: "IMAGE 5", px: "360 × 360" },
    notes: "Multiplayer is the one part that is not offline: the file is wired to three public relay servers and those need an internet connection."
  },
  {
    id: "notepad",
    file: "notepad.html",
    title: "Notepad",
    cat: "tools",
    kicker: "tools · autosaves while you type",
    blurb: "Plain notes with a word count, kept in this browser. Autosave is visible rather than promised, notes export as .txt, and a bundle of them can be moved to another machine as one file.",
    weight: "47 KB",
    status: "open",
    keys: "notepad notes text editor autosave export txt word count offline journal scratch",
    art: { file: "img/notepad.png", box: "IMAGE 6", px: "360 × 520" },
    notes: "Storage is per-browser and per-machine. It is a scratch pad, not a backup service."
  },
  {
    id: "sketch",
    file: "sketch.html",
    title: "Sketch Pad",
    cat: "tools",
    kicker: "tools · ink for the drawings still owed",
    blurb: "A drawing surface with five pen widths, paper and dark modes, a straight edge and an undo stack. Exports at the exact size each slot on this site is asking for, named the way the slot wants to be named.",
    weight: "54 KB",
    status: "open",
    keys: "sketch draw drawing ink pen canvas export png pixel art pad sketchpad offline",
    art: { file: "img/sketch.png", box: "IMAGE 7", px: "420 × 420" },
    notes: "Drop a finished export in img/ with the name the slot asks for and the dashed box turns into the drawing by itself, no HTML edit needed."
  },
  {
    id: "search",
    file: "search.html",
    title: "Search the Index",
    cat: "index",
    kicker: "index · one box, whole hub",
    blurb: "Type a word and the matching entries print out, same as they do on the front page. Searches titles, blurbs and keywords, so mkv and minecraft both land on the right thing.",
    weight: "36 KB",
    status: "open",
    keys: "search find index query filter directory listings lookup what is here",
    art: null,
    notes: "Search runs over the local index in this page. There is no crawler and nothing to rate-limit you."
  }
];

/* Order of the front-page directory. Kept separate from the array above so the
   hub can be reordered without moving code around. */
/* Sum of every byte listed in PHOTON_BOX. check.py fails if a row goes stale. */
var PHOTON_TOTAL = 18456407; /* Pages and files a visitor can open. The index, the search and the ring below all read this array. */

var PHOTON_ORDER = ["cabinet", "player", "eagler", "notepad", "sketch", "search"];

/* The webring is this hub's own pages, in the order you walk them. */
var PHOTON_RING = ["index.html", "games.html", "player.html", "eagler.html", "notepad.html", "sketch.html", "search.html", "brief.html"];

/* Everything in the folder, for the "what is in the box" table. Size strings are
   checked against the real files by tools/check.py so they cannot go stale. */
var PHOTON_BOX = [
  { path: "index.html", size: 19220, what: "the front page and the directory itself", note: "the listing, the pins, the box list" },
  { path: "style.css", size: 16433, what: "every colour, size and border on the hub", note: "16.7 KB, one file" },
  { path: "games.html", size: 12087, what: "game cabinet shell and score board", note: "hash-routed to each game" },
  { path: "js/games.js", size: 58543, what: "the seven games, logic and drawing", note: "no libraries" },
  { path: "player.html", size: 15370, what: "media player shell", note: "drop zone, playlist, deck" },
  { path: "js/player.js", size: 35252, what: "playlist, controls, container probe", note: "" },
  { path: "js/player-logic.js", size: 36489, what: "the deciding half of the player", note: "probed by unit tests" },
  { path: "eagler.html", size: 13625, what: "launcher page for the big file", note: "the frame never loads itself" },
  { path: "js/directory.js", size: 16475, what: "shared behaviour for every page", note: "pins, print, search, ring" },
  { path: "js/index-data.js", size: 9329, what: "the index as data", note: "11 rows and the box list" },
  { path: "js/notepad.js", size: 6158, what: "note store: counting, sorting, export", note: "" },
  { path: "js/sketch.js", size: 6176, what: "the pad: sizes, names, paper colours", note: "" },
  { path: "notepad.html", size: 16413, what: "notes and the autosave wiring", note: "" },
  { path: "sketch.html", size: 23812, what: "drawing pad", note: "exports at the slot size" },
  { path: "search.html", size: 10928, what: "index search", note: "" },
  { path: "brief.html", size: 19021, what: "this document", note: "" },
  { path: "404.html", size: 4649, what: "the dead-link page", note: "" },
  { path: "tools/bytes.js", size: 1196, what: "byte reader for the prober's tests", note: "" },
  { path: "tools/test-logic.js", size: 45528, what: "the assertions", note: "290 of them" },
  { path: "tools/check.py", size: 38841, what: "runs in CI, fails on a dead link", note: "" },
  { path: "tools/test-dom.js", size: 34026, what: "every page, headless", note: "" },
  { path: "tools/serve.py", size: 6132, what: "optional dev server with range requests", note: "" },
  { path: "tools/sizes.py", size: 3272, what: "rewrites the byte counts in this file", note: "run me first" },
  { path: "README.md", size: 3485, what: "what the folder is", note: "" },
  { path: "img/README.md", size: 1125, what: "the eight drawings, by name", note: "" },
  { group: "eaglercraft, as it arrived" },
  { path: "Eaglercraft.html", size: 18002822, what: "the game, base64 and gzipped, 17.2 MB", note: "unmodified" },
  { group: "waiting for a drawing" },
  { path: "img/drawer.png", size: 0, what: "the drawer, IMAGE 1", note: "the slot says what to draw" },
  { path: "img/room.png", size: 0, what: "the room, IMAGE 2", note: "the slot says what to draw" },
  { path: "img/cabinet.png", size: 0, what: "the cabinet, IMAGE 3", note: "the slot says what to draw" },
  { path: "img/player.png", size: 0, what: "the deck, IMAGE 4", note: "the slot says what to draw" },
  { path: "img/eagler.png", size: 0, what: "the block, IMAGE 5", note: "the slot says what to draw" },
  { path: "img/notepad.png", size: 0, what: "the pad, IMAGE 6", note: "the slot says what to draw" },
  { path: "img/sketch.png", size: 0, what: "the hand, IMAGE 7", note: "the slot says what to draw" },
  { path: "img/mark.png", size: 0, what: "the mark, optional", note: "the slot says what to draw" },
];
