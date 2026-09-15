/* ===========================================================================
   games.js — seven games, no libraries, no images.

   Everything that decides something (a step, a merge, a flood fill, a maze)
   is a pure function at the top of this file, so it can be run under node by
   tools/check.py without a browser. The dom layer underneath only draws what
   the logic said and forwards keys to it. That separation is the whole reason
   the games can be tested at all.
   =========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.Games = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  /* ======================= random, on purpose seedable ==================== */
  function rngFrom(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      /* xorshift32 */
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  var rand = rngFrom((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  function ri(n) { return Math.floor(rand() * n); }
  /* tests need a world they can reproduce; a player never sees this */
  function seed(n) { rand = rngFrom((n >>> 0) || 1); }

  /* ================================ SNAKE ================================= */
  var Snake = {
    size: function (diff) {
      var w = 22, h = 15;
      if (diff === "roomy") { w = 26; h = 17; }
      if (diff === "tight") { w = 15; h = 11; }
      return { w: w, h: h, ms: diff === "slow" ? 160 : diff === "fast" ? 70 : 110 };
    },
    fresh: function (w, h) {
      var mid = { x: Math.floor(w / 4), y: Math.floor(h / 2) };
      return {
        w: w, h: h,
        body: [{ x: mid.x, y: mid.y }, { x: mid.x - 1, y: mid.y }, { x: mid.x - 2, y: mid.y }],
        dir: { x: 1, y: 0 }, next: { x: 1, y: 0 },
        food: null, score: 0, dead: false, ate: 0
      };
    },
    placeFood: function (st) {
      var free = [], x, y;
      for (y = 0; y < st.h; y++) for (x = 0; x < st.w; x++) {
        if (!st.body.some(function (s) { return s.x === x && s.y === y; })) free.push({ x: x, y: y });
      }
      st.food = free.length ? free[ri(free.length)] : null;
      return st;
    },
    turn: function (st, dx, dy) {
      var d = st.dir;
      if (d.x === -dx && d.y === -dy) return st;         /* no 180 into your own neck */
      st.next = { x: dx, y: dy };
      return st;
    },
    /* one tick. Eating is decided inside, because growing means keeping the tail
       for this tick and that is exactly the mistake to make when you separate them. */
    step: function (st) {
      if (st.dead) return st;
      st.dir = st.next;
      var head = st.body[0];
      var x = head.x + st.dir.x, y = head.y + st.dir.y;
      if (x < 0 || y < 0 || x >= st.w || y >= st.h) { st.dead = "wall"; return st; }
      var eating = !!(st.food && st.food.x === x && st.food.y === y);
      /* the tail cell is about to move away, so it is a legal square to walk into */
      var checkLen = eating ? st.body.length : st.body.length - 1;
      for (var i = 0; i < checkLen; i++) {
        if (st.body[i].x === x && st.body[i].y === y) { st.dead = "self"; return st; }
      }
      st.body.unshift({ x: x, y: y });
      if (!eating) st.body.pop();
      else {
        st.score += 1 + Math.floor(st.body.length / 12);
        st.ate++;
        Snake.placeFood(st);
      }
      return st;
    }
  };

  /* ============================ MINESWEEPER =============================== */
  var Mines = {
    level: function (name) {
      if (name === "expert") return { w: 16, h: 16, mines: 40 };
      if (name === "inter") return { w: 14, h: 14, mines: 30 };
      return { w: 9, h: 9, mines: 10 };
    },
    fresh: function (w, h, mines, seed) {
      return {
        w: w, h: h, mines: mines, seed: seed == null ? (Date.now() & 0x7fffffff) : seed,
        cells: [], started: false, over: false, won: false, flags: 0, opened: 0
      };
    },
    idx: function (b, x, y) { return y * b.w + x; },
    neighbours: function (b, x, y) {
      var out = [], dx, dy;
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < b.w && ny < b.h) out.push({ x: nx, y: ny });
      }
      return out;
    },
    /* lay the mines only after the first click, and never on the click or its ring */
    plant: function (b, safeX, safeY) {
      var rnd = rngFrom(b.seed || 1);
      var banned = {}; banned[Mines.idx(b, safeX, safeY)] = 1;
      Mines.neighbours(b, safeX, safeY).forEach(function (n) { banned[Mines.idx(b, n.x, n.y)] = 1; });
      b.cells = [];
      for (var i = 0; i < b.w * b.h; i++) b.cells.push({ mine: false, adj: 0, state: "hide" });
      var placed = 0, guard = 0, pool = [];
      for (i = 0; i < b.cells.length; i++) if (!banned[i]) pool.push(i);
      while (placed < b.mines && pool.length && guard++ < b.mines * 400) {
        var k = Math.floor(rnd() * pool.length);
        var j = pool.splice(k, 1)[0];
        b.cells[j].mine = true; placed++;
      }
      /* if the board is too crowded to keep the ring safe, drop the ring */
      if (placed < b.mines) {
        pool = [];
        for (i = 0; i < b.cells.length; i++) if (!b.cells[i].mine && i !== Mines.idx(b, safeX, safeY)) pool.push(i);
        while (placed < b.mines && pool.length) {
          j = Math.floor(rnd() * pool.length);
          b.cells[pool.splice(j, 1)[0]].mine = true; placed++;
        }
      }
      for (var y = 0; y < b.h; y++) for (var x = 0; x < b.w; x++) {
        var c = b.cells[Mines.idx(b, x, y)];
        c.adj = Mines.neighbours(b, x, y).filter(function (n) {
          return b.cells[Mines.idx(b, n.x, n.y)].mine;
        }).length;
      }
      b.started = true;
      return b;
    },
    reveal: function (b, x, y) {
      if (b.over) return { opened: 0, boom: false };
      var c = b.cells[Mines.idx(b, x, y)];
      if (c.state !== "hide") return { opened: 0, boom: false };
      if (c.mine) { c.state = "open"; b.over = true; return { opened: 1, boom: true }; }
      var stack = [{ x: x, y: y }], opened = 0;
      while (stack.length) {
        var n = stack.pop();
        var cc = b.cells[Mines.idx(b, n.x, n.y)];
        if (cc.state !== "hide" || cc.mine) continue;
        cc.state = "open"; opened++; b.opened++;
        if (cc.adj === 0) Mines.neighbours(b, n.x, n.y).forEach(function (m) {
          var mc = b.cells[Mines.idx(b, m.x, m.y)];
          if (mc.state === "hide" && !mc.mine) stack.push(m);
        });
      }
      if (Mines.won(b)) b.won = true;
      return { opened: opened, boom: false };
    },
    flag: function (b, x, y) {
      if (b.over) return false;
      var c = b.cells[Mines.idx(b, x, y)];
      if (c.state === "open") return false;
      c.state = c.state === "flag" ? "hide" : "flag";
      b.flags += c.state === "flag" ? 1 : -1;
      return true;
    },
    /* clicking a satisfied number pops its neighbours — the reason to play with a mouse */
    chord: function (b, x, y) {
      if (b.over) return { opened: 0, boom: false, wrong: 0 };
      var c = b.cells[Mines.idx(b, x, y)];
      if (c.state !== "open" || !c.adj) return { opened: 0, boom: false, wrong: 0 };
      var near = Mines.neighbours(b, x, y);
      var flags = near.filter(function (n) { return b.cells[Mines.idx(b, n.x, n.y)].state === "flag"; });
      if (flags.length !== c.adj) return { opened: 0, boom: false, wrong: 0 };
      var opened = 0, boom = false, wrong = 0;
      near.forEach(function (n) {
        var nc = b.cells[Mines.idx(b, n.x, n.y)];
        if (nc.state === "flag") return;
        var r = Mines.reveal(b, n.x, n.y);
        opened += r.opened;
        if (r.boom) { boom = true; }
      });
      /* a number that was satisfied by wrong flags: show what was wrong */
      b.cells.forEach(function (cc) { if (cc.state === "flag" && cc.mine === false) wrong++; });
      if (Mines.won(b)) b.won = true;
      return { opened: opened, boom: boom, wrong: wrong };
    },
    won: function (b) {
      if (!b.started) return false;
      for (var i = 0; i < b.cells.length; i++) {
        var c = b.cells[i];
        if (c.mine && c.state !== "flag") return false;
        if (!c.mine && c.state === "open") continue;
        if (!c.mine && c.state !== "open") return false;
      }
      b.over = true;
      return true;
    },
    revealMines: function (b) {
      var out = [];
      b.cells.forEach(function (c, i) {
        if (c.mine && c.state !== "flag") { out.push(i); }
      });
      return out;
    },
    wrongFlags: function (b) {
      var out = [];
      b.cells.forEach(function (c, i) { if (c.state === "flag" && !c.mine) out.push(i); });
      return out;
    }
  };

  /* ================================= 2048 ================================= */
  var Merge = {
    size: 4,
    fresh: function () {
      var g = [];
      for (var i = 0; i < 16; i++) g.push(0);
      g = Merge.add(g); g = Merge.add(g);
      return { grid: g, score: 0, over: false, won: false, merged: [] };
    },
    add: function (g) {
      var free = [], i;
      for (i = 0; i < g.length; i++) if (!g[i]) free.push(i);
      if (!free.length) return g;
      g[free[ri(free.length)]] = rand() < 0.9 ? 2 : 4;
      return g;
    },
    rows: function (g) {
      var out = [];
      for (var r = 0; r < 4; r++) out.push([g[r * 4], g[r * 4 + 1], g[r * 4 + 2], g[r * 4 + 3]]);
      return out;
    },
    fromRows: function (rows) {
      var g = [];
      rows.forEach(function (r) { g = g.concat(r); });
      return g;
    },
    cols: function (g) {
      var out = [];
      for (var c = 0; c < 4; c++) out.push([g[c], g[c + 4], g[c + 8], g[c + 12]]);
      return out;
    },
    fromCols: function (cols) {
      var g = [];
      for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) g.push(cols[c][r]);
      return g;
    },
    /* one row pushed left: collapse, merge each pair once, collapse again */
    slideRow: function (row) {
      var vals = row.filter(function (v) { return v; });
      var out = [], gained = 0, mergedAt = {};
      for (var i = 0; i < vals.length; i++) {
        if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
          var nv = vals[i] * 2;
          out.push(nv); gained += nv; mergedAt[out.length - 1] = nv;
          i++;
        } else out.push(vals[i]);
      }
      while (out.length < 4) out.push(0);
      return { row: out, gained: gained, mergedAt: mergedAt };
    },
    move: function (st, dir) {
      /* dir: 0 left, 1 up, 2 right, 3 down */
      var moved = false, gained = 0, marks = [];
      var lines;
      if (dir === 0 || dir === 2) lines = Merge.rows(st.grid);
      else lines = Merge.cols(st.grid);
      if (dir === 2 || dir === 3) lines = lines.map(function (l) { return l.slice().reverse(); });
      var slid = lines.map(function (l) { return Merge.slideRow(l); });
      if (dir === 2 || dir === 3) slid = slid.map(function (s) {
        return { row: s.row.slice().reverse(), gained: s.gained, mergedAt: s.mergedAt };
      });
      var grid;
      if (dir === 0 || dir === 2) grid = Merge.fromRows(slid.map(function (s) { return s.row; }));
      else grid = Merge.fromCols(slid.map(function (s) { return s.row; }));
      slid.forEach(function (s) { gained += s.gained; });
      for (var i = 0; i < 16; i++) {
        if (grid[i] !== st.grid[i]) { moved = true; break; }
      }
      if (!moved) return { moved: false, gained: 0, marks: marks };
      st.grid = grid;
      st.score += gained;
      if (st.grid.some(function (v) { return v >= 2048; })) st.won = true;
      Merge.add(st.grid);
      if (Merge.dead(st.grid)) st.over = true;
      return { moved: true, gained: gained, marks: marks };
    },
    dead: function (g) {
      for (var i = 0; i < 16; i++) {
        if (!g[i]) return false;
        var r = Math.floor(i / 4), c = i % 4;
        if (c < 3 && g[i] === g[i + 1]) return false;
        if (r < 3 && g[i] === g[i + 4]) return false;
      }
      return true;
    }
  };

  /* ================================= MAZE ================================= */
  var Maze = {
    /* cells with four wall bits: 1 N, 2 E, 4 S, 8 W */
    opp: { 1: 4, 4: 1, 2: 8, 8: 2 },
    dirs: [{ d: 1, dx: 0, dy: -1 }, { d: 2, dx: 1, dy: 0 }, { d: 4, dx: 0, dy: 1 }, { d: 8, dx: -1, dy: 0 }],
    fresh: function (cols, rows) {
      var g = [];
      for (var i = 0; i < cols * rows; i++) g.push(15);
      return { cols: cols, rows: rows, walls: g, seen: {}, px: 0, py: 0, done: false, steps: 0 };
    },
    /* iterative backtracker — recursion on a 31-wide maze would be fine too, but
       an explicit stack is easier to read and cannot blow the stack on a phone */
    carve: function (m, seed) {
      var rnd = rngFrom(seed == null ? (((Date.now() & 0x7fffffff) || 7) >>> 0) : seed);
      var visit = [], v;
      for (v = 0; v < m.cols * m.rows; v++) visit.push(false);
      var stack = [0];
      visit[0] = true;
      while (stack.length) {
        var cur = stack[stack.length - 1];
        var x = cur % m.cols, y = Math.floor(cur / m.cols);
        var options = [];
        Maze.dirs.forEach(function (o) {
          var nx = x + o.dx, ny = y + o.dy;
          if (nx < 0 || ny < 0 || nx >= m.cols || ny >= m.rows) return;
          if (visit[ny * m.cols + nx]) return;
          options.push({ o: o, nx: nx, ny: ny });
        });
        if (!options.length) { stack.pop(); continue; }
        var pick = options[Math.floor(rnd() * options.length)];
        var ni = pick.ny * m.cols + pick.nx;
        m.walls[cur] &= ~pick.o.d;
        m.walls[ni] &= ~Maze.opp[pick.o.d];
        visit[ni] = true;
        stack.push(ni);
      }
      /* knock out a few extra walls so there are choices, not one long corridor */
      var extra = Math.max(1, Math.floor(m.cols * m.rows / 22));
      for (var k = 0; k < extra; k++) {
        var cx = Math.floor(rnd() * m.cols), cy = Math.floor(rnd() * m.rows);
        var od = Maze.dirs[Math.floor(rnd() * 4)];
        var ax = cx + od.dx, ay = cy + od.dy;
        if (ax < 0 || ay < 0 || ax >= m.cols || ay >= m.rows) continue;
        var ci = cy * m.cols + cx, ai = ay * m.cols + ax;
        m.walls[ci] &= ~od.d;
        m.walls[ai] &= ~Maze.opp[od.d];
      }
      return m;
    },
    open: function (m, x, y, dir) { return (m.walls[y * m.cols + x] & dir) === 0; },
    move: function (m, dir) {
      /* dir: 1 N, 2 E, 4 S, 8 W */
      if (m.done) return false;
      var d = { 1: [0, -1], 2: [1, 0], 4: [0, 1], 8: [-1, 0] }[dir];
      if (!d) return false;
      if (!Maze.open(m, m.px, m.py, dir)) return false;
      m.px += d[0]; m.py += d[1];
      m.seen[m.py * m.cols + m.px] = true;
      m.steps++;
      if (m.px === m.cols - 1 && m.py === m.rows - 1) m.done = true;
      return true;
    },
    /* the maze must be walkable from door to exit — checked by the test suite */
    reachable: function (m) {
      var want = m.rows * m.cols - 1, seen = {}, q = [0], hit = 0;
      seen[0] = true;
      while (q.length) {
        var cur = q.shift(), x = cur % m.cols, y = Math.floor(cur / m.cols);
        if (cur === want) hit++;
        [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]].forEach(function (o) {
          if (!Maze.open(m, x, y, o[0])) return;
          var nx = x + o[1], ny = y + o[2];
          if (nx < 0 || ny < 0 || nx >= m.cols || ny >= m.rows) return;
          var ni = ny * m.cols + nx;
          if (seen[ni]) return;
          seen[ni] = true; q.push(ni);
        });
      }
      return hit === 1;
    }
  };

  /* ============================== LIGHTS OUT ============================== */
  var Lights = {
    size: 5,
    fresh: function (presses) {
      var g = new Array(25).fill(false);
      var n = presses == null ? 10 : presses;
      for (var i = 0; i < n; i++) Lights.toggle(g, ri(25));
      if (n > 0 && Lights.solved(g)) Lights.toggle(g, ri(25));
      return { grid: g, moves: 0, done: false };
    },
    toggle: function (g, i) {
      var x = i % Lights.size, y = Math.floor(i / Lights.size);
      [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
        var nx = x + o[0], ny = y + o[1];
        if (nx < 0 || ny < 0 || nx >= Lights.size || ny >= Lights.size) return;
        var j = ny * Lights.size + nx;
        g[j] = !g[j];
      });
      return g;
    },
    solved: function (g) { return g.every(function (v) { return !v; }); }
  };

  /* ============================== WORD DRILL ============================== */
  var Words = {
    /* real words, chosen because a typing drill should teach fingers, not vocabulary */
    list: ("about above across after again along among angle answer area arrow aside at away back badge band bar base basin bath because been before begin being below bench beside best better between beyond bird bite black blank block blood board boat body book born both bottle bottom bought bound bread break bridge brief bring broad broke brother built burn bus business busy called cannot care carry case catch cause cent center chain chair chance change check child choose church circle city class clean clear close cold college color comes command common course cousin crowd cry dance danger dark date daughter day dead deal death degree desk did differ difficulty direct distance divide doctor does dog dollar door double down drive drive drop drug dry during each early earth ease east easy edge education effect effort egg eight either else end enemy enough enter equal escape even evening ever everyone exactly except exercise expect experience explain eye face fact fair fall family famous fan far farm fast fat father fear feed feel feet field fierce fifteen fill final find fine finger fire first fish floor flow fly follow font food foot force forest forget form found four free fresh friend front fruit full fun game garden gas gave general get girl give glad glass glove go goal good green grey ground group grow guess had half hand happen hard has hate have he head hear heart heavy held help her here high hill his hold hole home hope hour house how human hundred hunt hurry hurt husband idea if ill imagine important in inch include income increase indeed inside instead interest into iron island it job join jump just keep kept key kick kind king kitchen knew know known lack lady laid lake land last late laugh law lay lead learn least leave led left leg lend length less let letter level lie life lift light like line list listen little live load local long look lose loss lost loud love low machine made mail main major make man manner many map mark market marry match matter may maybe me mean meat meet member mind mine minute miss moment money month moon more morning most mother mouth move movie much music must my name nation nature near necessary neck need neighbor neither never news next nice night none north nose note nothing notice now number ocean off office often oil old on once one only open or order other our out outside over own page paint pair parent park part party pass past pay peace perfect perhaps person pick picture piece place plain plan plant play please point police poor position possible power practice prepare present president press pretty price print private probable problem produce program project public pull purpose push put quality question quick quiet quite race radio rain raise range rate read ready real reason receive recent record red reduce regard remain remember remove repeat report represent require rest result return rich ride right rise risk river road rock role roll roof room root rope rose round row rule run safe said sail salt same sand save saw say sea season seat second secret section see seem seen sell send sense sent serve service set seven several shake shape share sharp she shelf shell shift shine ship shoe shop shot should shoulder shout show sick side sight sign silent silver simple since sing single sister site sit six size skin sky sleep slow small smile smoke snow social soft soil soldier some son song soon sorry sort sound south space speak special speech speed spend spot spread spring square staff stage stair stand star start state station stay steal steam steel step stick still stock stone stop store storm story straight strange street strength strike strong structure student study stuff style such sudden sugar suggest summer sun support suppose sure surface surprise sweet swim table tail take talk tall task taste tea teach team tear tell ten term test than thank that the their them then there these they thick thin thing think third this those though thought thousand threat three throat through throw thus tie time tiny tire to today together told tone too took tool top toward town trade train tree trip trouble true try turn twelve twenty twice two type under understand unit until up upon use used useful using usual valley value various very victory village visit voice vote wait walk wall want war warm wash watch water wave way wear weather week weight welcome well went were west wet what wheel when where whether which while white who whole whom whose why wide wife wild will window wine wing winter wire wish with within without woman wonder wood word work world worry worth would write wrong yard yeah year yellow yes yesterday yet you young your youth"
      ).split(/\s+/).filter(function (w) { return w.length >= 3 && w.length <= 8; }),
    pick: function (n, taken) {
      var out = [], tries = 0;
      taken = taken || {};
      while (out.length < n && tries++ < n * 40) {
        var w = Words.list[Math.floor(rand() * Words.list.length)];
        if (taken[w]) continue;
        taken[w] = 1;
        out.push(w);
      }
      return out;
    },
    grade: function (typed, target) {
      typed = String(typed); target = String(target);
      var ok = 0, bad = 0, n = Math.min(typed.length, target.length), i;
      for (i = 0; i < n; i++) {
        if (typed[i] === target[i]) ok++;
        else bad++;
      }
      /* extra keystrokes past the end are a single penalty, not one per key — the
         player already lost the word */
      bad += Math.max(0, typed.length - target.length);
      return { ok: ok, bad: bad, complete: typed.length === target.length && ok === target.length };
    },
    wpm: (function () {
      return function (correctChars, ms) {
        if (!ms) return 0;
        return Math.round((correctChars / 5) / (ms / 60000) * 10) / 10;
      };
    })()
  };

  /* ============================== PONG ================================== */
  var Pong = {
    W: 420, H: 260, PAD: 62, BALL: 8, TO: 7,
    fresh: function () {
      return {
        x: 12, y: Pong.H / 2 - Pong.PAD / 2, cx: Pong.W - 24, cy: Pong.H / 2 - Pong.PAD / 2,
        bx: Pong.W / 2, by: Pong.H / 2, vx: 2.6, vy: 1.4, left: 0, right: 0,
        serve: 0.6, over: null, hits: 0
      };
    },
    /* one tick: walls, paddles, scoring. dt is in frames of 1 at 60fps */
    tick: function (st, dt, input) {
      if (st.over) return st;
      if (typeof input === "number") st.y = Math.max(0, Math.min(Pong.H - Pong.PAD, input));
      if (input === "up") st.y = Math.max(0, st.y - 6 * dt);
      if (input === "down") st.y = Math.min(Pong.H - Pong.PAD, st.y + 6 * dt);

      if (st.serve > 0) { st.serve -= 0.016 * dt; st.bx = Pong.W / 2; st.by = Pong.H / 2; return st; }

      st.bx += st.vx * dt; st.by += st.vy * dt;
      if (st.by < 0) { st.by = 0; st.vy = -st.vy; }
      if (st.by > Pong.H - Pong.BALL) { st.by = Pong.H - Pong.BALL; st.vy = -st.vy; }

      /* player paddle */
      if (st.bx < 12 + 12 && st.bx > 6 && st.by + Pong.BALL > st.y && st.by < st.y + Pong.PAD && st.vx < 0) {
        st.vx = Math.min(7.2, -st.vx * 1.04);
        st.vy += ((st.by + Pong.BALL / 2) - (st.y + Pong.PAD / 2)) * 0.05;
        st.bx = 24; st.hits++;
      }
      /* machine: chases with a flat foot so it is beatable */
      var mid = st.cy + Pong.PAD / 2;
      if (st.vx > 0) st.cy += Math.max(-3.4, Math.min(3.4, (st.by - mid) * 0.075)) * dt;
      else st.cy += ((Pong.H / 2 - Pong.PAD / 2) - st.cy) * 0.02 * dt;
      st.cy = Math.max(0, Math.min(Pong.H - Pong.PAD, st.cy));
      if (st.bx + Pong.BALL > Pong.W - 24 && st.bx < Pong.W - 12 && st.by + Pong.BALL > st.cy && st.by < st.cy + Pong.PAD && st.vx > 0) {
        st.vx = -Math.min(7.2, -st.vx * 1.03);
        st.vy += ((st.by + Pong.BALL / 2) - (st.cy + Pong.PAD / 2)) * 0.05;
        st.bx = Pong.W - 24 - Pong.BALL;
      }
      st.vy = Math.max(-5.2, Math.min(5.2, st.vy));

      if (st.bx < -12) { st.right++; st.serve = 0.8; st.bx = Pong.W / 2; st.by = Pong.H / 2; st.vx = 2.6; st.vy = rand() < 0.5 ? -1.4 : 1.4; st.hits = 0; }
      if (st.bx > Pong.W + 12) { st.left++; st.serve = 0.8; st.bx = Pong.W / 2; st.by = Pong.H / 2; st.vx = -2.6; st.vy = rand() < 0.5 ? -1.4 : 1.4; st.hits = 0; }
      if (st.left >= Pong.TO) st.over = "You take it " + st.left + " to " + st.right + ".";
      if (st.right >= Pong.TO) st.over = "The machine takes it " + st.right + " to " + st.left + ".";
      return st;
    }
  };

  var api = {
    logic: { rngFrom: rngFrom, Snake: Snake, Mines: Mines, Merge: Merge, Maze: Maze, Lights: Lights, Words: Words, Pong: Pong, ri: ri },
    store: null,
    list: [
      { id: "snake", name: "Snake", tag: "1 player", hint: "Arrows or WASD. Walls kill. The snake does not turn back on itself.", needs: "keys" },
      { id: "mines", name: "Minesweeper", tag: "1 player", hint: "Click to open. Right click to flag. Click a number that already has its flags to pop the rest.", needs: "mouse" },
      { id: "merge", name: "2048", tag: "1 player", hint: "Arrows or swipe. A tile can only merge once per move, so plan the corner you keep.", needs: "keys" },
      { id: "pong", name: "Pong, vs the machine", tag: "1 player", hint: "W and S, or drag on the left half. First to seven.", needs: "keys" },
      { id: "maze", name: "Maze", tag: "1 player", hint: "Arrows or WASD. It is cut fresh each time you ask, so the map is never the one you memorised.", needs: "keys" },
      { id: "lights", name: "Lights Out", tag: "puzzle", hint: "Every press flips the lamp it lands on and its four neighbours. Since the board was made by pressing, it can be un-pressed.", needs: "mouse" },
      { id: "words", name: "Word Drill", tag: "typing", hint: "Sixty seconds, real words, no punctuation traps. WPM counts correct characters divided by five.", needs: "keys" }
    ]
  };

  api.scoreKey = function (id) { return "photon.score." + id; };
  api.best = function (id) {
    var v = api.store && api.store.get ? api.store.get(api.scoreKey(id), null) : null;
    return v;
  };
  api.putBest = function (id, value, mode) {
    if (!api.store || !api.store.set) return;
    var cur = api.best(id) || { high: 0, low: 0, ms: 0, tries: 0, at: 0 };
    cur.tries = (cur.tries || 0) + 1;
    cur.at = Date.now();
    if (mode === "min") { if (!cur.low || value < cur.low) cur.low = value; }
    else if (mode === "time") { if (!cur.ms || value < cur.ms) cur.ms = value; }
    else if (value > (cur.high || 0)) cur.high = value;
    api.store.set(api.scoreKey(id), cur);
    return cur;
  };

  /* ======================================================================== *
   *  dom layer — every game is a mount() that returns a cleanup
   * ======================================================================== */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function canvasFor(w, h) {
    var c = document.createElement("canvas");
    var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = w + "px"; c.style.height = h + "px";
    var ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    return { c: c, ctx: ctx, w: w, h: h };
  }
  function hud(host, labels) {
    var box = el("div", "hud");
    labels.forEach(function (l) {
      var s = el("span", null, PH.esc(l.k) + ' <b data-hud="' + l.id + '">&mdash;</b>');
      box.appendChild(s);
    });
    host.appendChild(box);
    return function (id, value) {
      var t = box.querySelector('[data-hud="' + id + '"]');
      if (t) t.textContent = value;
    };
  }
  function dpad(host, onKey, keys) {
    var wrap = el("div", "pad");
    var layout = [[null, "up", null], ["left", null, "right"], [null, "down", null]];
    if (keys === "two") layout = [["up", "down"], ["left", "right"]];
    layout.forEach(function (row) {
      row.forEach(function (k) {
        if (!k) { var b = el("span", "blank"); wrap.appendChild(b); return; }
        var btn = el("button", null, { up: "&#9650;", down: "&#9660;", left: "&#9664;", right: "&#9654;" }[k]);
        btn.type = "button";
        btn.setAttribute("aria-label", k);
        btn.addEventListener("click", function (e) { e.preventDefault(); onKey(k); });
        wrap.appendChild(btn);
      });
    });
    wrap.style.display = "inline-grid";
    return wrap;
  }
  function paintButtons(host, list, onClick) {
    var row = el("div", "row");
    list.forEach(function (b) {
      var btn = el("button", "btn" + (b.on ? " on" : ""), b.label);
      btn.type = "button";
      if (b.title) btn.title = b.title;
      btn.addEventListener("click", function () { onClick(b.value, btn); });
      row.appendChild(btn);
    });
    host.appendChild(row);
    return row;
  }

  /* --------------------------------- SNAKE -------------------------------- */
  function mountSnake(root, ctx) {
    var diff = "normal", st, cv, timer, over = false;
    var set = hud(root, [{ id: "score", k: "score" }, { id: "best", k: "best" }, { id: "len", k: "length" }]);
    var controls = el("div", "row");
    root.appendChild(controls);
    var scr = el("div", "screen");
    root.insertBefore(scr, controls);

    function setBest() {
      var b = ctx.best("snake");
      set("best", b && b.high ? b.high : "—");
    }
    function start() {
      clearInterval(timer);
      var s = Snake.size(diff);
      st = Snake.placeFood(Snake.fresh(s.w, s.h));
      over = false;
      if (!cv) {
        var made = canvasFor(s.w * 18, s.h * 18);
        cv = made.c; scr.appendChild(cv);
        cv.tabIndex = 0;
        cv.addEventListener("keydown", key);
        cv.addEventListener("touchstart", touch, { passive: false });
        cv.addEventListener("click", function () { cv.focus(); });
        cv._cell = 18;
      }
      set("score", 0); set("len", st.body.length);
      setBest();
      draw();
      cv.focus({ preventScroll: true });
      timer = setInterval(tick, s.ms);
    }
    function tick() {
      if (over) return;
      Snake.step(st);
      if (st.dead) {
        over = true;
        clearInterval(timer);
        var b = ctx.putBest("snake", st.score);
        set("best", b && b.high ? b.high : "—");
        scr.appendChild(el("div", "outcome", "Dead against the " + st.dead + ". Score " + st.score +
          ". <button type=\"button\" class=\"btn\" data-again>again</button>"));
        var again = scr.querySelector("[data-again]");
        if (again) again.addEventListener("click", function () {
          if (again.parentNode) again.parentNode.remove();
          start();
        });
      } else {
        set("score", st.score); set("len", st.body.length);
      }
      draw();
    }
    function key(e) {
      var m = {
        ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1],
        ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0]
      }[e.key];
      if (!m) return;
      e.preventDefault();
      Snake.turn(st, m[0], m[1]);
    }
    function touch(e) {
      if (!e.touches[0] || !cv) return;
      var r = cv.getBoundingClientRect();
      var x = e.touches[0].clientX - (r.left + r.width / 2), y = e.touches[0].clientY - (r.top + r.height / 2);
      if (Math.abs(x) > Math.abs(y)) Snake.turn(st, x > 0 ? 1 : -1, 0);
      else Snake.turn(st, 0, y > 0 ? 1 : -1);
      e.preventDefault();
    }
    function draw() {
      var g = cv.getContext("2d"), cell = cv._cell;
      g.fillStyle = "#05070d";
      g.fillRect(0, 0, cv.width, cv.height);
      g.strokeStyle = "#16233d"; g.lineWidth = 1;
      for (var x = 0; x <= st.w; x++) { g.beginPath(); g.moveTo(x * cell + .5, 0); g.lineTo(x * cell + .5, st.h * cell); g.stroke(); }
      for (var y = 0; y <= st.h; y++) { g.beginPath(); g.moveTo(0, y * cell + .5); g.lineTo(st.w * cell, y * cell + .5); g.stroke(); }
      if (st.food) {
        g.fillStyle = "#c2303f";
        g.fillRect(st.food.x * cell + 2, st.food.y * cell + 2, cell - 4, cell - 4);
        g.fillStyle = "#f2c14e";
        g.fillRect(st.food.x * cell + 2, st.food.y * cell + 2, cell - 4, 3);
      }
      st.body.forEach(function (s, i) {
        g.fillStyle = i === 0 ? "#f2c14e" : (i < 4 ? "#e8e3d9" : "#8fb7f0");
        g.fillRect(s.x * cell + 1, s.y * cell + 1, cell - 2, cell - 2);
        if (i > 0) { g.fillStyle = "#05070d"; g.fillRect(s.x * cell + 5, s.y * cell + 5, cell - 10, cell - 10); }
      });
      g.strokeStyle = "#2f5fa8"; g.lineWidth = 2;
      g.strokeRect(1, 1, st.w * cell - 2, st.h * cell - 2);
    }
    paintButtons(controls, [
      { label: "slow", value: "slow", on: diff === "slow" },
      { label: "normal", value: "normal", on: diff === "normal" },
      { label: "fast", value: "fast", on: diff === "fast" }
    ], function (v, btn) {
      diff = v;
      PH.qsa("button", controls).forEach(function (b) { b.classList.remove("on"); });
      btn.classList.add("on");
      start();
    });
    var pd = el("div", "row");
    pd.appendChild(dpad(pd, function (k) {
      var m = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[k];
      if (st) Snake.turn(st, m[0], m[1]);
    }));
    pd.appendChild(el("button", "btn", "restart")).addEventListener("click", start);
    root.appendChild(pd);
    start();
    return function () { clearInterval(timer); };
  }

  /* ----------------------------- MINESWEEPER ------------------------------ */
  function mountMines(root, ctx) {
    var lvl = "beginner", b, boardEl, t0, timer, mode = "dig";
    var controls = el("div", "row");
    root.appendChild(controls);
    var scr = el("div", "screen");
    root.insertBefore(scr, controls);
    var out = el("div");
    root.appendChild(out);

    function start() {
      clearInterval(timer);
      var cfg = Mines.level(lvl);
      b = Mines.fresh(cfg.w, cfg.h, cfg.mines, (Date.now() ^ (Math.random() * 1e9)) >>> 0);
      t0 = 0;
      out.innerHTML = "";
      boardEl = el("div", "board");
      boardEl.style.gridTemplateColumns = "repeat(" + cfg.w + ",26px)";
      for (var i = 0; i < cfg.w * cfg.h; i++) {
        var cell = el("button", "cell covered");
        cell.type = "button";
        cell.dataset.i = i;
        cell.addEventListener("click", click);
        cell.addEventListener("contextmenu", function (e) { e.preventDefault(); flag(+e.currentTarget.dataset.i); });
        boardEl.appendChild(cell);
      }
      scr.innerHTML = "";
      scr.appendChild(boardEl);
      var h = el("div", "hud", 'mines left <b id="ms-left">' + b.mines + '</b> <span class="sep">|</span> flags placed <b id="ms-flags">0</b> <span class="sep">|</span> seconds <b id="ms-time">0</b>');
      scr.insertBefore(h, boardEl);
      if (mode === "flag") boardEl.style.cursor = "copy";
      timer = setInterval(function () {
        if (!b.started || b.over) return;
        document.getElementById("ms-time").textContent = Math.round((Date.now() - t0) / 1000);
      }, 250);
      ctx.putBest("mines", 0, "none");
    }
    function cellAt(i) { return boardEl.children[i]; }
    function paint() {
      for (var i = 0; i < b.cells.length; i++) {
        var c = b.cells[i], node = cellAt(i), x = i % b.w, y = Math.floor(i / b.w);
        node.className = "cell";
        node.textContent = "";
        if (c.state === "flag") { node.classList.add("flag", "covered"); node.textContent = "⚑"; continue; }
        if (c.state !== "open") { node.classList.add("covered"); continue; }
        if (c.mine) { node.classList.add("mine"); node.textContent = "✱"; continue; }
        if (c.adj) { node.classList.add("n" + c.adj); node.textContent = c.adj; }
      }
      document.getElementById("ms-left").textContent = Math.max(0, b.mines - b.flags);
      document.getElementById("ms-flags").textContent = b.flags;
    }
    function click(e) {
      var i = +e.currentTarget.dataset.i, x = i % b.w, y = Math.floor(i / b.w);
      if (mode === "flag" && b.cells[i].state !== "open") {
        if (!b.started) { t0 = Date.now(); Mines.plant(b, x, y); }
        Mines.flag(b, x, y);
        paint();
        return;
      }
      if (!b.started) { t0 = Date.now(); Mines.plant(b, x, y); }
      var c = b.cells[i];
      if (c.state === "open") { var ch = Mines.chord(b, x, y); if (ch.boom) return lose(i); paint(); return; }
      var r = Mines.reveal(b, x, y);
      if (r.boom) return lose(i);
      if (b.won) return win();
      paint();
    }
    function flag(i) {
      var x = i % b.w, y = Math.floor(i / b.w);
      if (!b.started) { t0 = Date.now(); Mines.plant(b, x, y); }
      Mines.flag(b, x, y);
      paint();
    }
    function lose(at) {
      b.over = true;
      clearInterval(timer);
      Mines.revealMines(b).forEach(function (i) {
        var n = cellAt(i);
        n.className = "cell mine"; n.textContent = "✱";
      });
      Mines.wrongFlags(b).forEach(function (i) { cellAt(i).classList.add("wrong"); });
      var col = (at == null ? 0 : at % b.w) + 1, row = (at == null ? 0 : Math.floor(at / b.w)) + 1;
      out.innerHTML = '<div class="outcome">Mine on column ' + col + ", row " + row +
        ". " + b.opened + " cells were open, " + Math.round((Date.now() - t0) / 1000) +
        " seconds in. <button type=\"button\" class=\"btn\" data-again>new board</button></div>";
      wireAgain(out);
      paint();
    }
    function win() {
      clearInterval(timer);
      var secs = Math.round((Date.now() - t0) / 1000);
      ctx.putBest("mines", secs, "time");
      b.flags = b.mines;
      b.cells.forEach(function (c) { if (c.mine && c.state !== "open") c.state = "flag"; });
      paint();
      out.innerHTML = '<div class="outcome">Cleared. ' + secs + " seconds on a " + b.w + "×" + b.h +
        " with " + b.mines + " mines. <button type=\"button\" class=\"btn\" data-again>new board</button></div>";
      wireAgain(out);
    }
    function wireAgain(host) {
      var btn = host.querySelector("[data-again]");
      if (btn) btn.addEventListener("click", start);
    }
    paintButtons(controls, [
      { label: "9×9 · 10 mines", value: "beginner", on: true },
      { label: "14×14 · 30", value: "inter" },
      { label: "16×16 · 40", value: "expert" }
    ], function (v, btn) {
      lvl = v;
      PH.qsa("button", controls).forEach(function (b2) { b2.classList.remove("on"); });
      btn.classList.add("on");
      start();
    });
    var modeRow = el("div", "row");
    var dig = el("button", "btn on", "dig");
    var flagBtn = el("button", "btn", "flag");
    dig.type = "button"; flagBtn.type = "button";
    dig.title = "Left click opens a square";
    flagBtn.title = "For anyone without a right button: switch to flagging, then tap";
    function setMode(m) {
      mode = m;
      dig.classList.toggle("on", m === "dig");
      flagBtn.classList.toggle("on", m === "flag");
      if (boardEl) boardEl.style.cursor = m === "flag" ? "copy" : "default";
    }
    dig.addEventListener("click", function () { setMode("dig"); });
    flagBtn.addEventListener("click", function () { setMode("flag"); });
    modeRow.appendChild(dig); modeRow.appendChild(flagBtn);
    modeRow.appendChild(el("span", "xs faint", "right click flags without switching modes"));
    var r2 = el("div", "row");
    r2.appendChild(el("button", "btn", "new board")).addEventListener("click", start);
    root.appendChild(modeRow);
    root.appendChild(r2);
    start();
    return function () { clearInterval(timer); };
  }

  /* -------------------------------- 2048 --------------------------------- */
  function mountMerge(root, ctx) {
    var st, gridEl, set, over = false;
    var scr = el("div", "screen");
    root.appendChild(scr);
    set = hud(scr, [{ id: "score", k: "score" }, { id: "best", k: "best" }]);
    gridEl = el("div", "tile-grid");
    scr.appendChild(gridEl);
    var msg = el("div"); scr.appendChild(msg);

    function sizeFor() {
      var w = Math.min(360, Math.max(220, (window.innerWidth || 800) - 120));
      var side = Math.floor(w / 4);
      gridEl.style.gridTemplateColumns = "repeat(4," + side + "px)";
      gridEl.style.gridAutoRows = side + "px";
      return side;
    }
    function paint() {
      var side = sizeFor();
      gridEl.innerHTML = "";
      st.grid.forEach(function (v, i) {
        var d = el("div", "tile" + (v ? " t" + Math.min(2048, v) : ""));
        d.style.fontSize = v >= 1024 ? Math.round(side * 0.24) + "px" : Math.round(side * 0.34) + "px";
        if (v) d.textContent = v;
        d.setAttribute("aria-label", v ? "tile " + v : "empty cell");
        gridEl.appendChild(d);
      });
      set("score", st.score);
      var b = ctx.best("merge");
      set("best", b && b.high ? b.high : "—");
    }
    function start() {
      st = Merge.fresh(); over = false; msg.innerHTML = "";
      gridEl.tabIndex = 0;
      gridEl.onkeydown = function (e) {
        /* 0 left, 1 up, 2 right, 3 down — same order Merge.move expects */
        var d = { ArrowLeft: 0, a: 0, ArrowUp: 1, w: 1, ArrowRight: 2, d: 2, ArrowDown: 3, s: 3 }[e.key];
        if (d == null) return;
        e.preventDefault(); push(d);
      };
      wireTouch(gridEl, push);
      paint();
      gridEl.focus({ preventScroll: true });
    }
    function push(dir) {
      if (over) return;
      var r = Merge.move(st, dir);
      paint();
      if (st.won && !st.welcomed) {
        st.welcomed = true;
        msg.innerHTML = '<div class="outcome">2048. Score ' + st.score +
          ' — <button type="button" class="btn" data-cont>keep going</button></div>';
        var c = msg.querySelector("[data-cont]");
        if (c) c.addEventListener("click", function () { msg.innerHTML = ""; });
      }
      if (st.over) {
        ctx.putBest("merge", st.score);
        msg.innerHTML = '<div class="outcome">No merges left. Score ' + st.score +
          ' · <button type="button" class="btn" data-again>new board</button></div>';
        over = true;
        var a = msg.querySelector("[data-again]");
        if (a) a.addEventListener("click", start);
      }
    }
    var pd = el("div", "row");
    pd.appendChild(dpad(pd, function (k) {
      push({ left: 0, up: 1, right: 2, down: 3 }[k]);
    }));
    pd.appendChild(el("button", "btn", "new board")).addEventListener("click", start);
    root.appendChild(pd);
    window.addEventListener("resize", paint);
    start();
    return function () { window.removeEventListener("resize", paint); };
  }
  function wireTouch(host, push) {
    var sx = 0, sy = 0, live = false;
    host.addEventListener("touchstart", function (e) {
      live = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    host.addEventListener("touchend", function (e) {
      if (!live) return;
      live = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) push(dx > 0 ? 2 : 0);
      else push(dy > 0 ? 3 : 1);
      e.preventDefault();
    }, { passive: false });
  }

  /* --------------------------------- PONG --------------------------------- */
  function mountPong(root, ctx) {
    var st, cv, raf, paused = false, input = null, keys = {};
    var scr = el("div", "screen");
    root.appendChild(scr);
    var made = canvasFor(Pong.W, Pong.H);
    cv = made.c;
    scr.appendChild(cv);
    var set = hud(scr, [{ id: "score", k: "you" }, { id: "cpu", k: "machine" }, { id: "rally", k: "longest rally" }]);
    var note = el("div", "small dim");
    scr.appendChild(note);
    st = Pong.fresh();
    var best = (ctx.best("pong") || {}).high || 0;

    cv.tabIndex = 0;
    cv.addEventListener("keydown", function (e) {
      if (e.key === "w" || e.key === "W" || e.key === "ArrowUp") { keys.up = 1; e.preventDefault(); }
      if (e.key === "s" || e.key === "S" || e.key === "ArrowDown") { keys.down = 1; e.preventDefault(); }
    });
    cv.addEventListener("keyup", function (e) {
      if (e.key === "w" || e.key === "W" || e.key === "ArrowUp") keys.up = 0;
      if (e.key === "s" || e.key === "S" || e.key === "ArrowDown") keys.down = 0;
    });
    cv.addEventListener("click", function () { cv.focus({ preventScroll: true }); });
    function pointer(e) {
      var r = cv.getBoundingClientRect();
      var cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      input = (cy / r.height) * Pong.H - Pong.PAD / 2;
    }
    cv.addEventListener("pointermove", function (e) { if (e.buttons || e.pointerType === "touch") pointer(e); });
    cv.addEventListener("pointerdown", function (e) { cv.focus({ preventScroll: true }); pointer(e); });
    cv.addEventListener("touchmove", function (e) { pointer(e); e.preventDefault(); }, { passive: false });
    document.addEventListener("visibilitychange", function () { paused = document.hidden; });

    function loop() {
      raf = requestAnimationFrame(loop);
      if (paused) return;
      if (keys.up) Pong.tick(st, 1, "up");
      else if (keys.down) Pong.tick(st, 1, "down");
      else if (input != null) Pong.tick(st, 1, input);
      else Pong.tick(st, 1, null);
      if ((st.hits || 0) > best) { best = st.hits; ctx.putBest("pong", best); }
      if (st.over) {
        note.textContent = st.over + " Reload this panel to play again, or press the button below.";
        st.serve = 9999;
      }
      draw();
      set("score", st.left); set("cpu", st.right); set("rally", best);
    }
    function draw() {
      var g = made.ctx;
      g.fillStyle = "#05070d"; g.fillRect(0, 0, Pong.W, Pong.H);
      g.fillStyle = "#16233d";
      for (var y = 0; y < Pong.H; y += 16) g.fillRect(Pong.W / 2 - 1, y, 2, 9);
      g.fillStyle = "#e8e3d9";
      g.fillRect(st.x, st.y, 12, Pong.PAD);
      g.fillStyle = "#c2303f";
      g.fillRect(st.cx, st.cy, 12, Pong.PAD);
      g.fillStyle = "#f2c14e";
      g.fillRect(st.bx, st.by, Pong.BALL, Pong.BALL);
      g.font = "24px Georgia, serif";
      g.fillStyle = "#8fb7f0";
      g.fillText(String(st.left), Pong.W / 2 - 44, 30);
      g.fillText(String(st.right), Pong.W / 2 + 26, 30);
    }
    var row = el("div", "row");
    row.appendChild(el("button", "btn", "reset match")).addEventListener("click", function () {
      st = Pong.fresh(); note.textContent = "";
    });
    row.appendChild(el("button", "btn", "serve")).addEventListener("click", function () {
      st.serve = 0; st.over = null; note.textContent = "";
    });
    root.appendChild(row);
    loop();
    return function () { cancelAnimationFrame(raf); };
  }

  /* --------------------------------- MAZE --------------------------------- */
  function mountMaze(root, ctx) {
    var m, cv, cell = 16, size = 21, set, t0 = 0;
    var scr = el("div", "screen");
    root.appendChild(scr);
    var info = el("div", "row");
    root.appendChild(info);
    function start(seed) {
      var cols = size, rows = Math.max(9, Math.floor(size * 0.7));
      m = Maze.carve(Maze.fresh(cols, rows), seed);
      m.seen[0] = true;
      t0 = Date.now();
      var w = cols * cell + 1, h = rows * cell + 1;
      if (!cv) {
        var made = canvasFor(w, h);
        cv = made.c; scr.appendChild(cv);
        cv.tabIndex = 0;
        cv.addEventListener("keydown", key);
        cv.addEventListener("click", function () { cv.focus({ preventScroll: true }); });
        cv._g = made.ctx; cv._w = w; cv._h = h;
      } else {
        var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        cv.style.width = w + "px"; cv.style.height = h + "px";
        cv._g.setTransform(dpr, 0, 0, dpr, 0, 0);
        cv._w = w; cv._h = h;
      }
      if (!set) set = hud(scr, [{ id: "steps", k: "steps" }, { id: "best", k: "fewest steps" }, { id: "size", k: "grid" }]);
      var b = ctx.best("maze");
      set("steps", 0); set("best", b && b.low ? b.low : "—"); set("size", cols + "×" + rows);
      scr.appendChild(info2);
      draw();
      cv.focus({ preventScroll: true });
    }
    var info2 = el("div", "small dim");
    function key(e) {
      var d = { ArrowUp: 1, w: 1, ArrowRight: 2, d: 2, ArrowDown: 4, s: 4, ArrowLeft: 8, a: 8 }[e.key];
      if (!d) return;
      e.preventDefault();
      var before = m.px + "," + m.py;
      if (Maze.move(m, d)) {
        draw();
        set("steps", m.steps);
        if (m.done) {
          ctx.putBest("maze", m.steps, "min");
          var secs = Math.round((Date.now() - t0) / 1000);
          info2.innerHTML = 'Out in ' + m.steps + " steps, " + secs + "s. <button type=\"button\" class=\"btn\" data-new>cut me a new one</button>";
          info2.querySelector("[data-new]").addEventListener("click", function () { start(null); info2.textContent = ""; });
          set("best", m.steps);
        }
      } else if (before !== m.px + "," + m.py) draw();
    }
    function draw() {
      var g = cv._g;
      g.fillStyle = "#05070d"; g.fillRect(0, 0, cv._w, cv._h);
      var x, y;
      for (y = 0; y < m.rows; y++) for (x = 0; x < m.cols; x++) {
        if (m.seen[y * m.cols + x]) { g.fillStyle = "#0f1a2e"; g.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2); }
      }
      g.strokeStyle = "#8fb7f0"; g.lineWidth = 2;
      for (y = 0; y < m.rows; y++) for (x = 0; x < m.cols; x++) {
        var w = m.walls[y * m.cols + x], px = x * cell, py = y * cell;
        if (w & 1) { g.beginPath(); g.moveTo(px, py + 1); g.lineTo(px + cell, py + 1); g.stroke(); }
        if (w & 8) { g.beginPath(); g.moveTo(px + 1, py); g.lineTo(px + 1, py + cell); g.stroke(); }
        if (x === m.cols - 1 && (w & 2)) { g.beginPath(); g.moveTo(px + cell - 1, py); g.lineTo(px + cell - 1, py + cell); g.stroke(); }
        if (y === m.rows - 1 && (w & 4)) { g.beginPath(); g.moveTo(px, py + cell - 1); g.lineTo(px + cell, py + cell - 1); g.stroke(); }
      }
      g.fillStyle = "#4c9a6a";
      g.fillRect((m.cols - 1) * cell + 3, (m.rows - 1) * cell + 3, cell - 6, cell - 6);
      g.fillStyle = m.done ? "#e8e3d9" : "#f2c14e";
      g.fillRect(m.px * cell + 3, m.py * cell + 3, cell - 6, cell - 6);
    }
    var pd = el("div", "row");
    var nameToKey = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
    pd.appendChild(dpad(pd, function (k) {
      key({ key: nameToKey[k], preventDefault: function () {} });
    }));
    pd.appendChild(el("button", "btn", "new maze")).addEventListener("click", function () { info2.textContent = ""; start(null); });
    root.appendChild(pd);
    paintButtons(info, [
      { label: "15×10", value: 15 }, { label: "21×14", value: 21, on: true }, { label: "31×21", value: 31 }
    ], function (v, btn) {
      size = v;
      PH.qsa("button", info).forEach(function (b) { b.classList.remove("on"); });
      btn.classList.add("on");
      start(null);
    });
    start(null);
    return function () {};
  }

  /* ------------------------------ LIGHTS OUT ------------------------------ */
  function mountLights(root, ctx) {
    var st, boardEl, set, moves;
    var controls = el("div", "row");
    var scr = el("div", "screen");
    root.appendChild(scr);
    root.appendChild(controls);
    var out = el("div"); root.appendChild(out);
    function start(n) {
      st = Lights.fresh(n);
      moves = 0;
      out.innerHTML = "";
      boardEl = el("div", "board");
      boardEl.style.gridTemplateColumns = "repeat(5,34px)";
      for (var i = 0; i < 25; i++) {
        (function (j) {
          var btn = el("button", "cell");
          btn.type = "button";
          btn.style.width = "34px"; btn.style.height = "34px";
          btn.setAttribute("aria-label", "lamp " + (Math.floor(j / 5) + 1) + "," + (j % 5 + 1));
          btn.addEventListener("click", function () { press(j); });
          boardEl.appendChild(btn);
        })(i);
      }
      scr.innerHTML = "";
      set = hud(scr, [{ id: "moves", k: "presses" }, { id: "lit", k: "lamps lit" }, { id: "best", k: "fewest" }]);
      scr.appendChild(el("div", "small dim", "A press flips that lamp and its four neighbours. The board was scrambled with " + n + " presses, so it can be solved in at most that many."));
      scr.appendChild(boardEl);
      var b = ctx.best("lights");
      set("best", b && b.low ? b.low : "—");
      paint();
    }
    function press(j) {
      if (st.done) return;
      Lights.toggle(st.grid, j);
      moves++;
      paint();
      if (Lights.solved(st.grid)) {
        st.done = true;
        ctx.putBest("lights", moves, "min");
        set("best", moves);
        out.innerHTML = '<div class="outcome">Dark in ' + moves + ' presses. <button type="button" class="btn" data-harder>harder scramble</button></div>';
        out.querySelector("[data-harder]").addEventListener("click", function () { start(18); });
      }
    }
    function paint() {
      var lit = 0;
      for (var i = 0; i < 25; i++) {
        var node = boardEl.children[i];
        if (st.grid[i]) { node.style.background = "#f2c14e"; node.style.borderColor = "#ffd77a"; lit++; }
        else { node.style.background = "#0c1120"; node.style.borderColor = "#223050"; }
      }
      set("moves", moves); set("lit", lit);
    }
    paintButtons(controls, [
      { label: "warm up · 6 presses", value: 6 },
      { label: "normal · 10", value: 10, on: true },
      { label: "mean · 18", value: 18 }
    ], function (v) { start(v); });
    start(10);
    return function () {};
  }

  /* ------------------------------- WORD DRILL ------------------------------ */
  function mountWords(root, ctx) {
    var words, i = 0, t0 = null, correct = 0, wrong = 0, timer, done = false;
    var scr = el("div", "screen");
    root.appendChild(scr);
    scr.appendChild(el("div", "small dim", "Sixty seconds. Type the word, then space or enter to bank it. A word only counts when it is exactly right."));
    var target = el("div", null);
    target.style.cssText = "font-family:Georgia,serif;font-size:38px;color:#fff;letter-spacing:1px;margin:6px 0 2px";
    scr.appendChild(target);
    var input = el("input");
    input.type = "text"; input.setAttribute("aria-label", "type the word");
    input.style.cssText = "width:100%;max-width:340px";
    scr.appendChild(input);
    var nextRow = el("div", "row mt8");
    scr.appendChild(nextRow);
    var set = hud(scr, [{ id: "left", k: "seconds" }, { id: "wpm", k: "wpm" }, { id: "acc", k: "accuracy" }, { id: "best", k: "best wpm" }]);
    var out = el("div"); root.appendChild(out);

    function start() {
      clearInterval(timer);
      words = Words.pick(6); i = 0; t0 = null; correct = 0; wrong = 0; done = false;
      out.innerHTML = "";
      set("best", ((ctx.best("words") || {}).high || "—"));
      set("left", 60); set("wpm", 0); set("acc", "—");
      input.value = ""; input.disabled = false;
      show();
      input.focus({ preventScroll: true });
    }
    function show() {
      target.innerHTML = "";
      var w = words[i];
      for (var k = 0; k < w.length; k++) {
        var s = document.createElement("span");
        s.textContent = w[k];
        s.style.color = k < input.value.length ? (input.value[k] === w[k] ? "#4c9a6a" : "#c2303f") : "#e8e3d9";
        target.appendChild(s);
      }
      nextRow.innerHTML = words.map(function (x, xi) {
        return '<span class="xs ' + (xi === i ? "warn" : "faint") + '">' + PH.esc(x) + "</span>";
      }).join('<span class="sep">·</span>');
    }
    input.addEventListener("input", function () {
      if (done) return;
      if (!t0) { t0 = Date.now(); timer = setInterval(tick, 200); }
      var v = input.value;
      var g = Words.grade(v, words[i]);
      if (g.complete) {
        correct += words[i].length;
        set("wpm", Words.wpm(correct, Date.now() - t0));
        advance();
        return;
      }
      show();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        var v = input.value;
        var g = Words.grade(v, words[i]);
        if (g.complete) { correct += words[i].length; advance(); }
        else if (v.length) { wrong += Math.max(1, words[i].length - g.ok); skip(); }
      }
    });
    function advance() { input.value = ""; i = (i + 1) % words.length; if (i === 0) words = Words.pick(6); show(); }
    function skip() { input.value = ""; wrong += 1; i++; if (i >= words.length) { words = words.concat(Words.pick(2)); } show(); }
    function acc() {
      var tot = correct + wrong;
      return tot ? Math.round((correct / tot) * 100) : 100;
    }
    function tick() {
      if (done || !t0) return;
      var left = Math.max(0, 60 - (Date.now() - t0) / 1000);
      set("left", Math.ceil(left));
      set("wpm", Words.wpm(correct, Date.now() - t0));
      set("acc", acc() + "%");
      if (left <= 0) finish();
    }
    function finish() {
      done = true;
      clearInterval(timer);
      input.disabled = true;
      var wpm = Words.wpm(correct, 60000);
      var b = ctx.putBest("words", Math.round(wpm));
      set("best", b.high);
      out.innerHTML = '<div class="outcome">Time. ' + wpm + " wpm at " + acc() + "% accuracy, " +
        (correct / 5).toFixed(1) + ' characters of real text. <button type="button" class="btn" data-again>run it again</button></div>';
      out.querySelector("[data-again]").addEventListener("click", start);
    }
    root.appendChild(el("div", "row mt8")).appendChild(el("button", "btn", "restart")).addEventListener("click", start);
    start();
    return function () { clearInterval(timer); };
  }

  api.seed = seed;
  api.mounts = {
    snake: mountSnake, mines: mountMines, merge: mountMerge,
    pong: mountPong, maze: mountMaze, lights: mountLights, words: mountWords
  };

  return api;
});
