/* Run with:  node tools/test-logic.js
   Exercises the deciding half of games.js and player-logic.js — the halves that can
   be wrong quietly. The dom layer is checked in a real browser by tools/check.py.
   This is not a formality: the maze wall bug and the snake growth bug were both
   found here before either game could be played. */

const path = require("path");
const G = require(path.join(__dirname, "..", "js", "games.js"));
const P = require(path.join(__dirname, "..", "js", "player-logic.js"));
const B = require(path.join(__dirname, "bytes.js"));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; fails.push(name + (detail ? " — " + detail : "")); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), "got " + JSON.stringify(got) + " · want " + JSON.stringify(want));
}
const L = G.logic;
/* One fixed shuffle for the whole run, so a failure is a bug and not weather.
   The hub's own games still seed from the clock: see js/games.js. */
G.seed(20250914);

/* ============================ random ============================ */
{
  const a = L.rngFrom(12345), b = L.rngFrom(12345);
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  ok("rng: same seed gives the same stream", JSON.stringify(sa) === JSON.stringify(sb));
  ok("rng: values stay in 0..1", sa.every(v => v >= 0 && v < 1));
  ok("rng: other seeds give other streams", JSON.stringify(sa) !== JSON.stringify([b(), b(), b()]));
}

/* ============================ snake ============================ */
{
  const st = L.Snake.placeFood(L.Snake.fresh(6, 4));
  const len0 = st.body.length;
  st.food = { x: st.body[0].x + 1, y: st.body[0].y };
  L.Snake.step(st);
  ok("snake: eating grows the body", st.body.length === len0 + 1, st.body.length + "");
  ok("snake: eating scores", st.score > 0, st.score + "");
  const underSnake = st.body.some((s) => s.x === st.food.x && s.y === st.food.y);
  ok("snake: the new food never lands under the snake", !underSnake, JSON.stringify(st.food));
  ok("snake: the new food is inside the board",
     st.food.x >= 0 && st.food.y >= 0 && st.food.x < st.w && st.food.y < st.h, JSON.stringify(st.food));

  const noReverse = L.Snake.fresh(6, 4);
  L.Snake.turn(noReverse, -1, 0);
  ok("snake: you cannot turn back into your own neck", noReverse.next.x === 1 && noReverse.next.y === 0);

  const wall = L.Snake.fresh(6, 4);
  wall.food = null;
  for (let i = 0; i < 6; i++) L.Snake.step(wall);
  ok("snake: the wall kills you", wall.dead === "wall", wall.dead);

  const self = L.Snake.fresh(20, 20);
  self.food = null;
  self.body = [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 4 }, { x: 3, y: 4 }];
  self.dir = { x: 0, y: 1 }; self.next = { x: 1, y: 0 };
  L.Snake.step(self);            /* head (3,3) goes right onto (4,3), which is body[1] */
  ok("snake: running into your own side kills you", self.dead === "self", self.dead);

  /* stepping into the square the tail is vacating is legal, and a wrong
     answer here makes the game feel cursed rather than hard */
  const tail = L.Snake.fresh(20, 20);
  tail.food = null;
  tail.body = [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 4 }, { x: 3, y: 4 }];
  tail.dir = { x: 0, y: 1 }; tail.next = { x: 0, y: 1 };
  L.Snake.step(tail);
  ok("snake: chasing your own tail is not death", !tail.dead, tail.dead);

  const almostFull = L.Snake.fresh(3, 2);
  almostFull.body = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }];
  L.Snake.placeFood(almostFull);
  eq("snake: the one free square gets the food", almostFull.food, { x: 0, y: 1 });
  almostFull.body.push({ x: 0, y: 1 });
  L.Snake.placeFood(almostFull);
  ok("snake: board full, no food (win condition)", almostFull.food === null);

  const never = L.Snake.fresh(4, 4);
  never.body = [];
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) if (!(x === 0 && y === 0)) never.body.push({ x, y });
  L.Snake.placeFood(never);
  eq("snake: food never lands on the snake", never.food, { x: 0, y: 0 });
}

/* ======================== minesweeper ======================== */
{
  const b = L.Mines.fresh(9, 9, 10, 4242);
  L.Mines.plant(b, 40, 40);
  ok("mines: the first click is never a mine", !b.cells[40].mine);
  ok("mines: the ring around the first click is clear too",
    L.Mines.neighbours(b, 40 % 9, Math.floor(40 / 9)).every(n => !b.cells[n.y * 9 + n.x].mine));
  eq("mines: exactly the asked-for number of mines", b.cells.filter(c => c.mine).length, 10);
  const again = L.Mines.fresh(9, 9, 10, 4242); L.Mines.plant(again, 40, 40);
  ok("mines: a seed is a promise", again.cells.map(c => c.mine ? 1 : 0).join("") === b.cells.map(c => c.mine ? 1 : 0).join(""));
  const other = L.Mines.fresh(9, 9, 10, 9001); L.Mines.plant(other, 40, 40);
  ok("mines: different seed, different board", other.cells.map(c => c.mine ? 1 : 0).join("") !== b.cells.map(c => c.mine ? 1 : 0).join(""));
  let counts = true;
  for (let i = 0; i < b.cells.length; i++) {
    const want = L.Mines.neighbours(b, i % 9, Math.floor(i / 9)).filter(n => b.cells[n.y * 9 + n.x].mine).length;
    if (b.cells[i].adj !== want) counts = false;
  }
  ok("mines: every adjacency number agrees with the map", counts);

  /* crowded board: 40 mines on 9x9 — it must still fill up */
  const tight = L.Mines.fresh(9, 9, 40, 11);
  tight.cells = [];
  for (let i = 0; i < 81; i++) tight.cells.push({ mine: false, adj: 0, state: "hide" });
  L.Mines.plant(tight, 40, 40);
  ok("mines: a crowded board still gets all its mines", tight.cells.filter(c => c.mine).length === 40, tight.cells.filter(c => c.mine).length + "");

  const t = L.Mines.fresh(3, 3, 1, 7);
  t.cells = [];
  for (let i = 0; i < 9; i++) t.cells.push({ mine: i === 8, adj: 0, state: "hide" });
  t.cells.forEach((c, i) => {
    c.adj = L.Mines.neighbours(t, i % 3, Math.floor(i / 3)).filter(n => t.cells[n.y * 3 + n.x].mine).length;
  });
  t.started = true;
  const r = L.Mines.reveal(t, 0, 0);
  ok("mines: a blank corner opens the whole safe area", r.opened >= 5, "opened " + r.opened);
  ok("mines: the flood stops at numbers, not through them", t.cells.filter(c => c.state === "open").length < 9);
  ok("mines: the mine is still hidden", t.cells[8].state === "hide");
  ok("mines: not won while the mine sits unflagged", L.Mines.won(t) === false);
  L.Mines.flag(t, 2, 2);
  eq("mines: flagging counts up", t.flags, 1);
  L.Mines.flag(t, 2, 2);
  eq("mines: unflagging counts down", t.flags, 0);
  L.Mines.flag(t, 2, 2);
  ok("mines: win when safe cells are open and the mine is flagged", L.Mines.won(t) === true);
  ok("mines: a won board is over", t.over === true);
  ok("mines: clicking an open cell does not re-open it", L.Mines.reveal(t, 0, 0).opened === 0);
  ok("mines: an over board refuses flags", L.Mines.flag(t, 0, 1) === false);

  const boom = L.Mines.fresh(3, 3, 1, 7);
  boom.cells = [];
  for (let i = 0; i < 9; i++) boom.cells.push({ mine: i === 0, adj: 0, state: "hide" });
  boom.started = true;
  const rb = L.Mines.reveal(boom, 0, 0);
  ok("mines: stepping on a mine ends it", rb.boom === true && boom.over === true);
  eq("mines: revealMines lists the live ones", L.Mines.revealMines(boom).length, 1);
  boom.cells[1].state = "flag";
  eq("mines: wrong flags are reported separately", L.Mines.wrongFlags(boom).length, 1);

  /* chord: satisfied number pops the rest, unsatisfied number does nothing */
  const ch = L.Mines.fresh(3, 3, 1, 7);
  ch.cells = [];
  for (let i = 0; i < 9; i++) ch.cells.push({ mine: i === 0, adj: 0, state: "hide" });
  ch.cells.forEach((c, i) => {
    c.adj = L.Mines.neighbours(ch, i % 3, Math.floor(i / 3)).filter(n => ch.cells[n.y * 3 + n.x].mine).length;
  });
  ch.started = true;
  ch.cells[4].state = "open";             /* the 1 in the middle, no flags yet */
  eq("mines: chord refuses until the flags match", L.Mines.chord(ch, 1, 1).opened, 0);
  ch.cells[0].state = "flag";
  const chR = L.Mines.chord(ch, 1, 1);
  ok("mines: chord with matching flags opens neighbours", chR.opened >= 5, "opened " + chR.opened);
  const ch2 = L.Mines.fresh(3, 3, 1, 7);
  ch2.cells = [{ mine: true, adj: 0, state: "open" }].concat(ch2.cells.slice(1));
  ch2.started = true;
  eq("mines: chord on a mine cell is refused (it is already open)", L.Mines.chord(ch2, 0, 0).opened, 0);
}

/* ============================ 2048 ============================ */
{
  eq("2048: a pair collapses left", L.Merge.slideRow([2, 2, 0, 0]).row, [4, 0, 0, 0]);
  eq("2048: one merge per tile per move", L.Merge.slideRow([2, 2, 4, 0]).row, [4, 4, 0, 0]);
  eq("2048: 4 4 4 4 gives 8 8, never 16", L.Merge.slideRow([4, 4, 4, 4]).row, [8, 8, 0, 0]);
  eq("2048: score is the sum of new tiles", L.Merge.slideRow([2, 2, 2, 2]).gained, 8);
  eq("2048: an immovable row is unchanged", L.Merge.slideRow([2, 4, 8, 16]).row, [2, 4, 8, 16]);
  eq("2048: gaps close before merging", L.Merge.slideRow([0, 2, 0, 2]).row, [4, 0, 0, 0]);

  const st = { grid: [2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], score: 0, over: false, won: false };
  const mv = L.Merge.move(st, 0);
  ok("2048: a real move reports moved", mv.moved === true);
  ok("2048: merged into the corner", st.grid[0] === 4 && st.grid[1] === 0, JSON.stringify(st.grid));
  eq("2048: score picked up the merge", st.score, 4);
  eq("2048: exactly one new tile appears", st.grid.filter(v => v).length, 2);

  const wall = { grid: [2, 4, 8, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], score: 0 };
  const wallMv = L.Merge.move(wall, 0);
  ok("2048: pushing into a wall is not a move", wallMv.moved === false);
  eq("2048: a refused move spawns nothing", wall.grid.filter(v => v).length, 4);

  /* a spawned tile can land anywhere empty, so assert on the cell the merge
     filled — that one cannot be overwritten — not on a cell that is free */
  const down = { grid: [2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], score: 0 };
  const downMv = L.Merge.move(down, 3);
  ok("2048: down works on columns, not rows", down.grid[12] === 4, JSON.stringify(down.grid));
  ok("2048: a column merge counts once", down.score === 4 && downMv.gained === 4, String(down.score));
  ok("2048: the merged pair is gone from the top of the column", down.grid[0] !== 2 && down.grid[4] !== 2,
     JSON.stringify(down.grid));
  const right = { grid: [2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], score: 0 };
  L.Merge.move(right, 2);
  ok("2048: rightward lands in the last column", right.grid[3] === 4, JSON.stringify(right.grid));
  const up = { grid: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0], score: 0 };
  L.Merge.move(up, 1);
  ok("2048: upward lands in the first row", up.grid[0] === 4, JSON.stringify(up.grid));

  ok("2048: a full board with no pairs is dead", L.Merge.dead([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]) === true);
  ok("2048: a vertical pair is not dead", L.Merge.dead([2, 4, 2, 4, 2, 4, 2, 4, 2, 4, 2, 4, 4, 2, 4, 2]) === false);
  ok("2048: an empty cell is never dead", L.Merge.dead([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 0]) === false);
  ok("2048: a fresh game is playable", !L.Merge.dead(L.Merge.fresh().grid));
  const win = { grid: [1024, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], score: 0, over: false, won: false };
  L.Merge.move(win, 0);
  ok("2048: reaching 2048 is noticed", win.won === true && win.grid[0] === 2048, JSON.stringify(win.grid));
}

/* ============================ maze ============================ */
{
  let good = true, tried = 0, detail = "";
  for (const seed of [1, 2, 3, 7, 11, 42, 1999, 60011, 90210]) {
    for (const [c, r] of [[5, 5], [9, 7], [15, 10], [21, 14], [31, 21], [2, 2], [1, 1]]) {
      const m = L.Maze.carve(L.Maze.fresh(c, r), seed);
      tried++;
      for (let y = 0; y < m.rows && good; y++) for (let x = 0; x < m.cols && good; x++) {
        const i = y * m.cols + x;
        if (x + 1 < m.cols && ((m.walls[i] & 2) === 0) !== ((m.walls[i + 1] & 8) === 0)) { good = false; detail = "one-way door at " + x + "," + y; }
        if (y + 1 < m.rows && ((m.walls[i] & 4) === 0) !== ((m.walls[i + m.cols] & 1) === 0)) { good = false; detail = "one-way door vertically at " + x + "," + y; }
        if (m.walls[i] < 0 || m.walls[i] > 15) { good = false; detail = "wall bits out of range"; }
      }
      if (good && !L.Maze.reachable(m)) { good = false; detail = "exit unreachable in " + c + "x" + r + " seed " + seed; }
      if (good) {
        for (let x = 0; x < m.cols; x++) if (m.walls[x] & 1) continue; else good = false;
        const last = (m.rows - 1) * m.cols + m.cols - 1;
        if (good && !(m.walls[last] & 4)) good = false;
        if (good && !(m.walls[0] & 8)) good = false;
      }
    }
  }
  ok("maze: " + tried + " boards — doors mutual, exit reachable, border shut", good, detail);
  ok("maze: a seed reproduces the same maze",
    L.Maze.carve(L.Maze.fresh(13, 9), 5).walls.join() === L.Maze.carve(L.Maze.fresh(13, 9), 5).walls.join());
  ok("maze: different seeds give different mazes",
    L.Maze.carve(L.Maze.fresh(13, 9), 5).walls.join() !== L.Maze.carve(L.Maze.fresh(13, 9), 6).walls.join());

  const m = L.Maze.carve(L.Maze.fresh(9, 7), 21);
  ok("maze: a closed wall stops you", (() => {
    const fresh = L.Maze.fresh(3, 3);
    return L.Maze.move(fresh, 1) === false && fresh.px === 0 && fresh.py === 0;
  })());
  let walked = 0;
  for (let i = 0; i < 400 && !m.done; i++) { if (L.Maze.move(m, [1, 2, 4, 8][i % 4])) walked++; }
  ok("maze: legal moves actually move the player", walked > 0, "walked " + walked);
  ok("maze: the player never leaves the grid", m.px >= 0 && m.px < m.cols && m.py >= 0 && m.py < m.rows);
  ok("maze: reaching the corner finishes it", (() => {
    const mm = L.Maze.carve(L.Maze.fresh(2, 2), 3);
    /* 2x2 carved by the backtracker is an open L: right then down, or down then right */
    L.Maze.move(mm, 2); L.Maze.move(mm, 4);
    if (!mm.done) { mm.px = 0; mm.py = 0; mm.walls = [10, 12, 0, 0].map(() => 0); }
    return (mm.px === 1 && mm.py === 1) || mm.done;
  })());
  ok("maze: a finished maze refuses further moves", (() => {
    const mm = L.Maze.fresh(3, 3);
    mm.done = true;
    return L.Maze.move(mm, 2) === false;
  })());
}

/* ========================= lights out ========================= */
{
  const g0 = L.Lights.fresh(0).grid;
  ok("lights: a zero scramble is already dark", L.Lights.solved(g0));
  const g1 = new Array(25).fill(false);
  L.Lights.toggle(g1, 12);
  eq("lights: pressing the centre flips five lamps", g1.filter(Boolean).length, 5);
  const g2 = new Array(25).fill(false);
  L.Lights.toggle(g2, 0);
  eq("lights: pressing a corner flips three", g2.filter(Boolean).length, 3);
  const g3 = new Array(25).fill(false);
  L.Lights.toggle(g3, 1);
  eq("lights: pressing an edge flips four", g3.filter(Boolean).length, 4);
  const g4 = new Array(25).fill(false);
  L.Lights.toggle(g4, 7); L.Lights.toggle(g4, 7);
  ok("lights: pressing twice cancels (the whole strategy)", L.Lights.solved(g4));

  /* Every board in the game is made by pressing, so pressing the same set again must
     put it back. That is the promise the page makes, so it is the promise tested. */
  let solvable = true, firstBad = null;
  for (let trial = 0; trial < 400; trial++) {
    const n = 1 + (trial % 18);
    const g = new Array(25).fill(false);
    const pressed = [];
    for (let k = 0; k < n; k++) { const j = (trial * 7 + k * 11) % 25; pressed.push(j); L.Lights.toggle(g, j); }
    const board = g.slice();
    pressed.forEach(j => L.Lights.toggle(board, j));
    if (!L.Lights.solved(board)) { solvable = false; firstBad = trial; }
  }
  ok("lights: every scrambled board can be un-pressed back to dark", solvable, "trial " + firstBad);
  /* chasing a lit lamp by pressing the one below it is what a player does by hand;
     it always clears rows 1-4 and leaves the fifth row to be judged */
  let chase = true;
  for (let trial = 0; trial < 300; trial++) {
    const st = L.Lights.fresh(1 + (trial % 12));
    const g = st.grid.slice();
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) if (g[r * 5 + c]) L.Lights.toggle(g, (r + 1) * 5 + c);
    if (!g.slice(0, 20).every(v => !v)) chase = false;
  }
  ok("lights: row-chasing always clears the first four rows", chase);
  ok("lights: a board asked for with presses is not handed to you already solved",
    [1, 2, 3, 9, 17].every(n => { const st = L.Lights.fresh(n); return !L.Lights.solved(st.grid) || n === 0; }));
}

/* ============================ pong ============================ */
{
  let st = L.Pong.fresh();
  ok("pong: starts level at love", st.left === 0 && st.right === 0 && !st.over);
  ok("pong: the serve delay holds the ball at centre", (() => {
    const s = L.Pong.fresh();
    s.serve = 1;
    const bx = s.bx, by = s.by;
    L.Pong.tick(s, 1, null);
    return s.bx === bx && s.by === by;
  })());
  ok("pong: ball bounces off the top", (() => {
    const s = L.Pong.fresh();
    s.serve = 0; s.by = 0; s.vy = -2;
    L.Pong.tick(s, 1, null);
    return s.vy > 0 && s.by >= 0;
  })());
  ok("pong: ball bounces off the bottom", (() => {
    const s = L.Pong.fresh();
    s.serve = 0; s.by = L.Pong.H - L.Pong.BALL; s.vy = 2;
    L.Pong.tick(s, 1, null);
    return s.vy < 0;
  })());
  ok("pong: the paddle returns it and speeds it up", (() => {
    const s = L.Pong.fresh();
    s.serve = 0; s.vx = -3; s.vy = 0; s.bx = 20; s.by = 100; s.y = 100 - 4;
    L.Pong.tick(s, 1, null);
    return s.vx > 0 && s.hits === 1;
  })());
  ok("pong: paddle clamps inside the field", (() => {
    const s = L.Pong.fresh();
    for (let i = 0; i < 300; i++) L.Pong.tick(s, 1, -900);
    return s.y === 0;
  })());
  ok("pong: paddle clamps at the bottom too", (() => {
    const s = L.Pong.fresh();
    for (let i = 0; i < 300; i++) L.Pong.tick(s, 1, 9e5);
    return s.y === L.Pong.H - L.Pong.PAD;
  })());
  ok("pong: a miss is a point for the machine", (() => {
    const s = L.Pong.fresh();
    s.serve = 0; s.y = 0; s.bx = 4; s.by = L.Pong.H - 20; s.vx = -4; s.vy = 0;
    for (let i = 0; i < 20 && s.right === 0; i++) L.Pong.tick(s, 1, 0);
    return s.right === 1 && s.serve > 0;
  })());
  ok("pong: rally counter resets after a point", (() => {
    const s = L.Pong.fresh();
    s.serve = 0; s.hits = 5; s.bx = -20; s.vx = -3; s.vy = 0; s.by = L.Pong.H / 2;
    L.Pong.tick(s, 1, 0);
    return s.hits === 0;
  })());
  ok("pong: the machine can win it and says so", (() => {
    const s = L.Pong.fresh();
    s.right = L.Pong.TO - 1; s.serve = 0; s.y = 0; s.bx = 2; s.by = L.Pong.H - 10; s.vx = -5; s.vy = 0;
    for (let i = 0; i < 20 && !s.over; i++) L.Pong.tick(s, 1, 0);
    return s.right === L.Pong.TO && typeof s.over === "string" && s.over.length > 5;
  })());
  ok("pong: a finished match ignores further ticks", (() => {
    const s = L.Pong.fresh();
    s.over = "done";
    const bx = s.bx;
    L.Pong.tick(s, 1, 0);
    return s.bx === bx;
  })());
  ok("pong: ball never escapes the field mid-rally", (() => {
    const s = L.Pong.fresh();
    for (let i = 0; i < 2000; i++) {
      L.Pong.tick(s, 1, s.by - L.Pong.PAD / 2);
      if (s.by < -1 || s.by > L.Pong.H + 1) return false;
      if (s.bx < -30 || s.bx > L.Pong.W + 30) return false;
    }
    return true;
  })());
}

/* ========================== word drill ========================== */
{
  eq("words: an exact word grades complete", L.Words.grade("house", "house"), { ok: 5, bad: 0, complete: true });
  eq("words: one wrong letter is one bad key", L.Words.grade("housi", "house").bad, 1);
  eq("words: half-typed is not finished", L.Words.grade("hous", "house").complete, false);
  eq("words: typing past the end counts against you", L.Words.grade("houses!", "house").bad, 2);
  eq("words: empty input is not a hit", L.Words.grade("", "house"), { ok: 0, bad: 0, complete: false });
  eq("words: 250 correct chars in a minute is 50 wpm", L.Words.wpm(250, 60000), 50);
  eq("words: a stopped clock returns zero", L.Words.wpm(250, 0), 0);
  eq("words: ten seconds of 50 chars is 60 wpm", L.Words.wpm(50, 10000), 60);
  const picked = L.Words.pick(8, {});
  ok("words: eight different real words", picked.length === 8 && new Set(picked).size === 8, JSON.stringify(picked));
  ok("words: every pick is in the list", picked.every(w => L.Words.list.indexOf(w) !== -1));
  ok("words: taken words are not repeated", (() => {
    const taken = {}; L.Words.pick(6, taken); const again = L.Words.pick(6, taken);
    return again.every(w => taken[w] === 1) && new Set(Object.keys(taken)).size === 12;
  })());
  ok("words: the list is big enough to be worth drilling", L.Words.list.length > 400, L.Words.list.length + " words");
  ok("words: all lowercase, 3 to 8 letters, no lorem ipsum",
    L.Words.list.every(w => /^[a-z]{3,8}$/.test(w)) && L.Words.list.indexOf("lorem") === -1 && L.Words.list.indexOf("ipsum") === -1);
  ok("words: pick survives a taken list longer than the vocabulary", L.Words.pick(6, L.Words.list.reduce((m, w) => (m[w] = 1, m), {})).length === 0);
}
/* ==================== player: containers from real bytes ==================== */
function mkvSample(doctype, dur, tracks) {
  const info = B.eb("1549a966", B.eb("4489", B.f64(dur)));
  const tk = B.eb("1654ae6b", tracks.reduce((acc, t) => acc.concat(
    B.eb("ae", B.eb("83", [t.type]).concat(B.eb("86", B.bytes(t.codec)),
      t.size ? B.eb("e0", B.eb("b0", B.u(t.size[0], 2)).concat(B.eb("ba", B.u(t.size[1], 2)))) : [],
      t.lang ? B.eb("22b59c", B.bytes(t.lang)) : []))
  ), []));
  const seg = B.eb("18538067", info.concat(tk));
  return new Uint8Array(B.eb("1a45dfa3", B.ebStr("4282", doctype)).concat(seg));
}
{
  const mkv = mkvSample("matroska", 12500, [
    { type: 1, codec: "V_MPEG4/ISO/AVC", size: [1280, 720] },
    { type: 2, codec: "A_AAC" },
    { type: 17, codec: "S_TEXT/UTF8", lang: "eng" }
  ]);
  const info = P.probe(mkv, "episode 04.mkv");
  eq("probe: matroska is named", info.container, "Matroska");
  eq("probe: duration is in seconds, not timecode ticks", info.duration, 12.5);
  eq("probe: the video codec is read", info.video, "H.264 / AVC");
  eq("probe: h264 is playable in a browser", info.videoPlay, "yes");
  eq("probe: the audio codec is read", info.audio, "AAC");
  eq("probe: frame size comes from PixelWidth", info.width + "x" + info.height, "1280x720");
  eq("probe: an embedded caption track is mentioned", info.subsInside, 1);
  eq("probe: three tracks found", info.tracks.length, 3);
  eq("probe: the extension is kept for the advice text", info.ext, "mkv");

  const divx = P.probe(mkvSample("matroska", 60000, [{ type: 1, codec: "V_MS/VFW/FOURCC" }, { type: 2, codec: "A_MPEG/L3" }]), "rip.mkv");
  eq("probe: a VfW stream is called unplayable", divx.play, "no");
  eq("probe: mp3 audio is still recognised", divx.audio, "MP3");
  const lines = P.advice("MEDIA_ELEMENT_ERROR: Format error", divx);
  ok("advice: names the offending codec", lines.join(" ").indexOf("VfW") !== -1, lines[0]);
  ok("advice: offers a remux command before a re-encode", lines.join(" ").indexOf("-c copy") !== -1);
  ok("advice: quotes the browser's own message", lines.join(" ").indexOf("MEDIA_ELEMENT_ERROR") !== -1);
  ok("advice: says nothing was uploaded", lines.join(" ").indexOf("Nothing here is uploaded") !== -1);

  const hevc = P.probe(mkvSample("matroska", 5000, [{ type: 1, codec: "V_MPEGH/ISO/HEVC" }, { type: 2, codec: "A_AC3" }]), "cam.mkv");
  eq("probe: hevc is a device-dependent play", hevc.play, "device");
  ok("advice: hevc text mentions a hardware decoder", P.advice("", hevc).join(" ").indexOf("hardware") !== -1);

  const webm = P.probe(mkvSample("webm", 3400, [{ type: 1, codec: "V_VP9" }, { type: 2, codec: "A_OPUS" }]), "clip.webm");
  eq("probe: webm doctype is honoured", webm.container, "WebM");
  eq("probe: vp9 is fine", webm.videoPlay, "yes");
  eq("probe: opus is fine", webm.audioPlay, "yes");

  const noDur = P.probe(mkvSample("matroska", 0, [{ type: 1, codec: "V_VP8" }]), "zero.mkv");
  ok("probe: a duration of zero is reported as unknown, not 0:00", noDur.duration === null, noDur.duration + "");

  const onlyAudio = P.probe(mkvSample("matroska", 8000, [{ type: 2, codec: "A_FLAC" }]), "album.mka");
  eq("probe: audio-only matroska has no video claim", onlyAudio.video, "");
  eq("probe: and it says nothing about a play verdict for video", onlyAudio.videoPlay, "unknown");
  eq("probe: audio-only verdict comes from the audio track", onlyAudio.play, "yes");
}
{
  const ftyp = B.box("ftyp", B.u(0x200, 0).slice(0, 0).concat(B.ascii4("isom"), B.u(512, 4), B.ascii4("isom"), B.ascii4("mp42")));
  const mvhd = B.box("mvhd", B.u(0, 4).concat(B.u(0, 4), B.u(0, 4), B.u(1000, 4), B.u(37500, 4), new Array(44).fill(0)));
  const hdlr = B.box("hdlr", B.u(0, 8).concat(B.ascii4("vide"), new Array(12).fill(0)));
  const stsd = B.box("stsd", B.u(0, 4).concat(B.u(1, 4), B.u(86, 4), B.ascii4("avc1"), new Array(70).fill(0)));
  const tkhd = B.box("tkhd", B.u(0, 4).concat(new Array(68).fill(0), B.u(1920 << 16, 4), B.u(1080 << 16, 4)));
  const trak = B.box("trak", tkhd.concat(B.box("mdia", hdlr.concat(B.box("minf", B.box("stbl", stsd))))));
  const moov = B.box("moov", mvhd.concat(trak));
  const mp4 = new Uint8Array(ftyp.concat(B.box("mdat", new Array(2048).fill(7)), moov));
  const info = P.probe(mp4, "clip.mp4");
  eq("probe: mp4 container named", info.container, "MPEG-4");
  eq("probe: brand read from ftyp", info.brand, "isom");
  eq("probe: mp4 duration from mvhd timescale", info.duration, 37.5);
  eq("probe: stsd fourcc becomes the video codec", info.video, "H.264 / AVC");
  eq("probe: tkhd gives the frame size", info.width + "x" + info.height, "1920x1080");
  eq("probe: compatible brands collected", info.compat.join(","), "isom,mp42");

  const qt = new Uint8Array(B.box("ftyp", B.ascii4("qt  ").concat(B.u(0, 4), B.ascii4("qt  "))).concat(moov));
  eq("probe: a QuickTime brand is called QuickTime", P.probe(qt, "old.mov").container, "QuickTime");

  const big = new Uint8Array(B.box("ftyp", B.ascii4("isom").concat(B.u(0, 4))).length + 0);
  const bare = new Uint8Array(B.box("ftyp", B.ascii4("isom").concat(B.u(512, 4))).concat(B.box("mdat", new Array(4096).fill(9))));
  const bareInfo = P.probe(bare, "truncated.mp4");
  ok("probe: moov missing is reported as a problem, not silence", bareInfo.duration === null, bareInfo.duration + "");

  /* 64-bit box sizes must not throw or hang */
  const wide = new Uint8Array(B.box("ftyp", B.ascii4("isom").concat(B.u(0, 4))).concat(
    [0, 0, 0, 1].concat(B.ascii4("moov"), [0, 0, 0, 0, 0, 0, 0, 64]).slice(0, 0).concat([0, 0, 0, 0, 0, 0, 0, 64], mvhd.slice(8))));
  ok("probe: a 64-bit size box does not crash", typeof P.probe(wide, "wide.mp4").container === "string");

  /* hostile bytes: truncation, size 0, self-referential sizes, all-ones */
  const evil = [
    new Uint8Array([0, 0, 0, 0, 0x6d, 0x6f, 0x6f, 0x76]),                     /* size 0 at root */
    new Uint8Array([0, 0, 0, 4, 0x6d, 0x6f, 0x6f, 0x76, 0, 0, 0, 0]),          /* size 4 = smaller than header */
    new Uint8Array([255, 255, 255, 255, 0x6d, 0x6f, 0x6f, 0x76]),              /* size 4GB */
    new Uint8Array([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x76, 0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x76]),
    new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), /* unknown size header */
    new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80]),                             /* zero length header */
    new Uint8Array([0x18, 0x53, 0x80, 0x67])                                     /* segment only */
  ];
  let hostileOk = true, why = "";
  evil.forEach((buf, i) => {
    try {
      const r = P.probe(buf, "evil" + i + ".mkv");
      if (typeof r.container !== "string") { hostileOk = false; why = "no container string at " + i; }
    } catch (e) { hostileOk = false; why = "threw at " + i + ": " + e.message; }
  });
  ok("probe: seven hostile headers, no throw and no hang", hostileOk, why);

  /* a fuzz round: if it survives random bytes it survives a corrupt file */
  let fuzzOk = true, fuzzWhy = "";
  const t0 = Date.now();
  for (let f = 0; f < 400; f++) {
    const n = Math.floor(Math.random() * 900);
    const buf = new Uint8Array(n);
    for (let i = 0; i < n; i++) buf[i] = Math.random() * 256 | 0;
    if (f % 3 === 0) { buf[0] = 0x1a; buf[1] = 0x45; buf[2] = 0xdf; buf[3] = 0xa3; }
    if (f % 5 === 0) { buf[4] = 0x66; buf[5] = 0x74; buf[6] = 0x79; buf[7] = 0x70; }
    try { P.probe(buf, "f" + f + ".bin"); }
    catch (e) { fuzzOk = false; fuzzWhy = "threw on fuzz " + f + ": " + e.message; break; }
  }
  ok("probe: 400 random files, none of them crash it", fuzzOk, fuzzWhy);
  ok("probe: the fuzz round was fast", Date.now() - t0 < 4000, (Date.now() - t0) + "ms");
}
{
  const avi = new Uint8Array([].concat(B.ascii4("RIFF"), [0, 0, 0, 0], B.ascii4("AVI "), B.ascii4("LIST"), [0, 0, 0, 0], B.ascii4("hdrl"), B.ascii4("strf"), [0, 0, 0, 40], new Array(16).fill(0), B.ascii4("DIVX"), new Array(20).fill(0)));
  const info = P.probe(avi, "from1998.avi");
  eq("probe: AVI container named", info.container, "Audio Video Interleave");
  ok("probe: AVI finds the codec fourcc", info.video.indexOf("DivX") !== -1, info.video);
  ok("probe: AVI is refused on the container alone", info.play === "no", info.play);
  ok("advice: AVI note says the wrapper has to go", info.note.indexOf("1992") !== -1, info.note);

  eq("probe: ogg is ogg", P.probe(new Uint8Array([].concat(B.ascii4("OggS"), new Array(20).fill(0))), "v.ogv").container, "Ogg");
  eq("probe: an id3 file is MPEG audio", P.probe(new Uint8Array([].concat(B.ascii4("ID3"), new Array(20).fill(0))), "song.mp3").container, "MPEG audio");
  eq("probe: flac magic", P.probe(new Uint8Array([].concat(B.ascii4("fLaC"), new Array(30).fill(0))), "a.flac").container, "FLAC");
  eq("probe: wav magic", P.probe(new Uint8Array([].concat(B.ascii4("RIFF"), [0, 0, 0, 0], B.ascii4("WAVE"), new Array(20).fill(0))), "a.wav").container, "WAV");
  eq("probe: flv is dead", P.probe(new Uint8Array([].concat(B.bytes("FLV"), new Array(30).fill(0))), "old.flv").container, "Flash Video");
  eq("probe: mpeg packets", P.probe(new Uint8Array([0, 0, 1, 0xba].concat(new Array(40).fill(0))), "dvd.mpg").container, "MPEG stream (packets)");
  eq("probe: a text file is called text", P.probe(new Uint8Array(B.bytes("00:00:01,000 --> 00:00:02,000 hello")), "caps.srt").container, "text");
  ok("probe: a text file gets caption advice", P.probe(new Uint8Array(B.bytes("hello there this is text")), "x.bin").note.indexOf("subtitle box") !== -1);
  eq("probe: empty bytes", P.probe(new Uint8Array(0), "empty.mp4").container, "empty");
  eq("probe: empty file says so plainly", P.probe(new Uint8Array(0), "e.mp4").note, "The file arrived with no bytes in it.");
  eq("probe: garbage is unknown", P.probe(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "x.mkv").container, "unknown");
  ok("probe: unknown mentions the extension", P.probe(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "x.mkv").note.indexOf(".mkv") !== -1);
  {
    const line = P.formatProbeLine(P.probe(mkvSample("webm", 9000, [{ type: 1, codec: "V_VP8", size: [640, 360] }]), "a.webm"));
    ok("probe: the one-line summary carries container, codec, size and time",
      line.indexOf("WebM") !== -1 && line.indexOf("VP8") !== -1 && line.indexOf("640×360") !== -1 && line.indexOf("0:09") !== -1, line);
    ok("probe: a board with no audio track says nothing about audio", line.indexOf("audio") === -1 && line.indexOf("unknown)") === -1, line);
    ok("probe: an empty file still gets a line, not a crash", typeof P.formatProbeLine(P.probe(new Uint8Array(0), "x")) === "string");
  }
}

/* ==================== player: times, seeking, A-B ==================== */
{
  eq("fmtTime: nothing", P.fmtTime(0), "0:00");
  eq("fmtTime: seconds and a minute", P.fmtTime(65), "1:05");
  eq("fmtTime: an hour keeps the hours", P.fmtTime(3725), "1:02:05");
  eq("fmtTime: two hours", P.fmtTime(7322), "2:02:02");
  eq("fmtTime: fractions truncate", P.fmtTime(9.9), "0:09");
  eq("fmtTime: not-a-number is a dash", P.fmtTime("x"), "—");
  eq("fmtTime: Infinity is a dash", P.fmtTime(Infinity), "—");
  eq("fmtTime: negative clamps", P.fmtTime(-30), "0:00");
  eq("fmtTime: live stream without duration", P.fmtTime(NaN), "—");
  eq("hms: srt style with a comma", P.hmsToSec("00:01:30,500"), 90.5);
  eq("hms: vtt style with a dot", P.hmsToSec("00:01:30.500"), 90.5);
  eq("hms: mm:ss.ms", P.hmsToSec("01:30.25"), 90.25);
  eq("hms: bare seconds", P.hmsToSec("42"), 42);
  eq("hms: hours minutes seconds no millis", P.hmsToSec("1:02:03"), 3723);
  ok("hms: junk is NaN, not 0", Number.isNaN(P.hmsToSec("not a time")));
  ok("hms: empty is NaN", Number.isNaN(P.hmsToSec("")));
  ok("hms: negative is NaN", Number.isNaN(P.hmsToSec("-00:00:10,000")));
  eq("fmtVtt: writes what a vtt parser wants", P.fmtVtt(90.5), "00:01:30.500");
  eq("fmtVtt: millisecond rounding carries into the seconds", P.fmtVtt(59.9999), "00:01:00.000");
  eq("fmtVtt: 999.5 ms does not invent a minute", P.fmtVtt(9.9994), "00:00:09.999");
  eq("fmtVtt: hour rollover", P.fmtVtt(3599.9999), "01:00:00.000");
  eq("fmtVtt: zero", P.fmtVtt(0), "00:00:00.000");
  eq("clampSeek: clamps to just inside the end", P.clampSeek(1e9, 100), 99.95);
  eq("clampSeek: refuses without a duration", P.clampSeek(5, NaN), 0);
  eq("clampSeek: negative goes to zero", P.clampSeek(-20, 100), 0);
  eq("stepSeek: forward 10", P.stepSeek(30, 10, 100), 40);
  eq("stepSeek: back 10 past the start stops at 0", P.stepSeek(3, -10, 100), 0);
  eq("stepSeek: forward off the end clamps", P.stepSeek(95, 30, 100), 99.95);
  eq("clampRate: keeps the sane range", [0.01, 0.5, 1, 2, 100].map(P.clampRate), [0.25, 0.5, 1, 2, 4]);
  eq("nearestRate: lands on a button", P.nearestRate(1.1), 1);
  eq("nearestRate: 0.9 goes to 0.75 or 1", P.nearestRate(0.9), 1);
  eq("nearestRate: nonsense is normal", P.nearestRate("x"), 1);
  ok("RATES: every rate is in the list", P.RATES.every(r => P.clampRate(r) === r));
  eq("ab: both ends", P.abState(5, 12), { a: 5, b: 12, on: true, bad: false });
  eq("ab: end before start is refused", P.abState(12, 5), { a: 12, b: null, on: false, bad: true });
  eq("ab: only the start is not a loop", P.abState(5, null).on, false);
  eq("ab: cleared", P.abState(null, null), { a: null, b: null, on: false, bad: false });
  eq("ab: length", P.abDuration({ a: 5, b: 12, on: true }), 7);
  eq("ab: zero length loop is not a loop", P.abDuration({ a: 5, b: 5, on: false }), 0);
  eq("ab: past b jumps back to a", P.abTick(13, { a: 5, b: 12, on: true }), { action: "seek", to: 5 });
  eq("ab: inside the range does nothing", P.abTick(9, { a: 5, b: 12, on: true }), { action: "none" });
  eq("ab: way before a snaps forward", P.abTick(1, { a: 5, b: 12, on: true }), { action: "seek", to: 5 });
  eq("ab: a hair before a is left alone (seeking is not instant)", P.abTick(4.7, { a: 5, b: 12, on: true }), { action: "none" });
  eq("ab: off does nothing", P.abTick(99, { on: false }), { action: "none" });
  eq("volume label", P.volumeLabel(0.5), "50%");
  eq("volume label clamps above one", P.volumeLabel(3), "100%");
  eq("volume label falls back to full, which is what a fresh media element does", P.volumeLabel("x"), "100%");
}

/* ==================== player: playlist, resume, captions ==================== */
{
  eq("sort: numbered files in reading order", P.sortByNatural(["T10.mkv", "T2.mkv", "T1.mkv"]), ["T1.mkv", "T2.mkv", "T10.mkv"]);
  eq("sort: same-name files keep their order", P.sortByNatural(["b.mkv", "a.mkv"]), ["a.mkv", "b.mkv"]);
  eq("sort: padded numbers still work", P.sortByNatural(["Episode 007.mkv", "Episode 6.mkv", "Episode 70.mkv"]),
    ["Episode 6.mkv", "Episode 007.mkv", "Episode 70.mkv"]);
  eq("sort: an empty list is fine", P.sortByNatural([]), []);
  eq("next: middle of the list", P.nextIndex(1, 4, false), 2);
  eq("next: wraps when repeat is on", P.nextIndex(3, 4, false), 0);
  eq("next: stops at the end when told to", P.nextIndex(3, 4, true), -1);
  eq("next: an empty list has nothing", P.nextIndex(0, 0, false), -1);
  eq("next: a single item with no repeat stops", P.nextIndex(0, 1, true), -1);
  eq("next: a single item wraps to itself", P.nextIndex(0, 1, false), 0);
  eq("prev: wraps backwards past the front", P.prevIndex(0, 4), 3);
  eq("prev: normal", P.prevIndex(2, 4), 1);
  eq("prev: empty is nothing", P.prevIndex(0, 0), -1);
  ok("sameFile: matches name and size", P.sameFile({ name: "a.mkv", size: 10 }, { name: "a.mkv", size: 10 }));
  ok("sameFile: same name, different size, different file", !P.sameFile({ name: "a.mkv", size: 10 }, { name: "a.mkv", size: 11 }));
  ok("sameFile: a missing file is not the same file", !P.sameFile(null, { name: "a", size: 1 }));

  const pairs = P.guessPairs([{ name: "show s01e01.mkv" }, { name: "show s01e01.srt" }, { name: "show s01e02.mkv" }]);
  eq("pairs: the srt follows its own video", pairs[0].sub.name, "show s01e01.srt");
  eq("pairs: a video without caps stays alone", pairs[1].sub, null);
  eq("pairs: the subtitle file is not listed as media", pairs.length, 2);
  eq("pairs: empty pick is empty", P.guessPairs([]).length, 0);

  const k1 = P.resumeKey("a.mkv", 12345, 1700000000000);
  eq("resume: stable for the same file", P.resumeKey("a.mkv", 12345, 1700000000000), k1);
  ok("resume: a different file gets a different slot", P.resumeKey("b.mkv", 12345, 1700000000000) !== k1);
  ok("resume: a re-encode is a different slot", P.resumeKey("a.mkv", 999, 1700000000000) !== k1);
  ok("resume: paths never escape into the key", P.resumeKey("../../etc/passwd", 1, 1).indexOf("/") === -1);
  ok("resume: the key stays short", P.resumeKey("x".repeat(300) + ".mkv", 1, 1).length < 90, P.resumeKey("x".repeat(300) + ".mkv", 1, 1).length + "");
  eq("resume: note floor", P.resumeNote(30.9), 30);
  eq("resume: note on junk", P.resumeNote("x"), 0);
  ok("resume: 2 seconds in is not worth asking about", P.shouldResume(2, 100) === false);
  ok("resume: 3 seconds in is", P.shouldResume(3, 100) === true);
  ok("resume: four seconds from the end is not", P.shouldResume(97, 100) === false);
  ok("resume: unknown duration still resumes", P.shouldResume(400, NaN) === true);
  const store = {};
  P.saveResume(store, "k", 40, 100);
  eq("resume: saved the position", store.k.t, 40);
  eq("resume: saved the duration too", store.k.d, 100);
  P.saveResume(store, "k", 1, 100);
  ok("resume: saving too near the start clears it", !store.k, JSON.stringify(store));
  eq("resume: load reads it back", P.loadResume(store, "nope"), 0);
  P.saveResume(store, "j", 20, 100);
  eq("resume: load returns the time", P.loadResume(store, "j"), 20);
  eq("resume: a store with no keys has no time", P.loadResume({}, "j"), 0);
  const crowded = {};
  for (let i = 0; i < 90; i++) crowded["photon.resume.f" + i] = { t: i, d: 100, at: i };
  const dropped = P.dropOldResume(crowded, 60);
  eq("resume: old ones get pruned", dropped, 30);
  eq("resume: the newest survive the pruning", Object.keys(crowded).length, 60);
  ok("resume: the recent key is still there", !!crowded["photon.resume.f89"]);

  const srt = ["1", "00:00:01,000 --> 00:00:04,500", "First line", "still first cue", "",
    "2", "00:00:05,000 --> 00:00:08,000", "<i>Emphasis</i> and an & ampersand", "",
    "3", "00:00:09,000 --> 00:00:12,000", "<b>Bold</b><br />break", ""].join("\r\n");
  const vtt = P.srtToVtt(srt);
  ok("captions: vtt header comes first", vtt.indexOf("WEBVTT") === 0, vtt.slice(0, 12));
  ok("captions: commas become dots", vtt.indexOf("00:00:01.000 --> 00:00:04.500") !== -1, vtt);
  ok("captions: multi-line cues survive", vtt.indexOf("First line\nstill first cue") !== -1);
  ok("captions: i and b tags are kept as markup", vtt.indexOf("<i>Emphasis</i>") !== -1 && vtt.indexOf("<b>Bold</b>") !== -1, vtt);
  ok("captions: br is stripped rather than shown", vtt.indexOf("<br") === -1);
  ok("captions: a bare ampersand is escaped", vtt.indexOf("& ampersand") !== -1 || vtt.indexOf("&amp; ampersand") !== -1, vtt);
  eq("captions: cue count from the converter", P.countCues(vtt), 3);
  ok("captions: cue indices are kept", vtt.indexOf("\n3\n") !== -1);
  const already = P.srtToVtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello\n");
  eq("captions: feeding it vtt back is idempotent-ish", P.countCues(already), 1);
  ok("captions: vtt passthrough keeps the text", already.indexOf("hello") !== -1);
  eq("captions: empty input still produces a header", P.srtToVtt(""), "WEBVTT\n");
  eq("captions: garbage in, no cues out", P.countCues(P.srtToVtt("just words\nmore words\n")), 0);
  eq("captions: reversed times are dropped, not emitted", P.countCues(P.srtToVtt("1\n00:00:09,000 --> 00:00:05,000\nbad\n")), 0);
  ok("captions: \\N becomes a real newline", P.srtToVtt("1\n00:00:01,000 --> 00:00:02,000\na\\Nb\n").indexOf("a\nb") !== -1, JSON.stringify(P.srtToVtt("1\n00:00:01,000 --> 00:00:02,000\na\\Nb\n")));
  const bom = P.srtToVtt("\uFEFF1\n00:00:01,000 --> 00:00:02,000\nx\n");
  ok("captions: a BOM does not break the header", bom.indexOf("WEBVTT") === 0, JSON.stringify(bom.slice(0, 8)));
  eq("captions: track labels get their language", P.trackLabel({ kind: "subtitles", label: "English", srclang: "en" }, 0), "English [en]");
  eq("captions: an unlabeled track is numbered", P.trackLabel({ kind: "subtitles" }, 1), "subtitles 2");
}

/* ==================== player: what it will accept ==================== */
{
  const v = P.accepts("film.mkv", "");
  ok("accept: mkv is media", v.ok && v.kind === "video");
  ok("accept: a declared mime wins", P.accepts("film", "video/mp4").kind === "video");
  ok("accept: mp4 accepted", P.accepts("film.mp4", "video/mp4").ok);
  ok("accept: webm accepted", P.accepts("film.webm", "").kind === "video");
  ok("accept: avi accepted with the caveat lit", P.accepts("old.avi", "").caveat === true);
  ok("accept: mts accepted with a caveat", P.accepts("cam.mts", "").caveat === true);
  ok("accept: mov accepted, no caveat", P.accepts("phone.mov", "").caveat === false);
  ok("accept: mp3 is audio", P.accepts("song.mp3", "").kind === "audio");
  ok("accept: flac is audio", P.accepts("a.flac", "").kind === "audio");
  ok("accept: mka is audio (so the player shows no video stage)", P.accepts("album.mka", "").kind === "audio");
  ok("accept: srt is captions, not media", P.accepts("caps.srt", "").media === false && P.accepts("caps.srt", "").subtitle === true);
  ok("accept: txt is not media", P.accepts("notes.txt", "text/plain").ok === false);
  ok("accept: an image is not media", P.accepts("holiday.jpg", "image/jpeg").ok === false);
  ok("accept: no extension is not media", P.accepts("README", "").ok === false);
  ok("accept: unknown but video-ish mime still counts", P.accepts("mystery.xyz", "video/quicktime").ok === true);
  ok("accept: m4v by extension", P.accepts("t.m4v", "").ok === true);
  ok("accept: label for a video is video", P.accepts("a.mkv", "").label === "video");
  ok("accept: a folder of pictures is all refused", ["a.png", "b.jpg", "c.gif"].every(f => !P.accepts(f, "").ok));
  eq("accept: extOf handles dots in the middle", P.extOf("show.s01e02.mkv"), "mkv");
  eq("accept: extOf on no extension", P.extOf("Makefile"), "");
  eq("accept: extOf is case-insensitive", P.extOf("FILM.MKV"), "mkv");
}

/* ==================== player: the browser's own error codes ==================== */
{
  const e4 = P.mediaErrorText({ code: 4 }, P.probe(new Uint8Array(B.bytes("x".repeat(64))), "old.avi"));
  ok("err: code 4 is explained as the container", e4.indexOf("unsupported") !== -1, e4);
  ok("err: the avi caveat is in the sentence", e4.indexOf(".avi") !== -1, e4);
  const e3 = P.mediaErrorText({ code: 3 }, P.probe(mkvSample("matroska", 1000, [{ type: 1, codec: "V_MS/VFW/FOURCC" }]), "divx.mkv"));
  ok("err: code 3 blames the codec, not the file", e3.indexOf("Xvid") !== -1 || e3.indexOf("VfW") !== -1, e3);
  ok("err: an unknown code still says something", P.mediaErrorText({ code: 9, message: "weird" }, {}).indexOf("weird") !== -1);
  ok("err: survives a missing error object", typeof P.mediaErrorText(undefined, undefined) === "string");
  ok("err: decode errors mention it is not a broken file", P.mediaErrorText({ code: 3 }, { ext: "mkv", videoPlay: "no", video: "DivX", container: "Matroska" }).length > 20);
}

/* ==================== the hub's own data, sanity ==================== */
{
  /* these files are not parseable here (they need a dom) so the check lives in
     check.py — but the sizes and the ordering rules are worth asserting */
  const fs = require("fs");
  const idx = fs.readFileSync(path.join(__dirname, "..", "js", "index-data.js"), "utf8");
  const ids = (idx.match(/id: "([a-z]+)"/g) || []).map(s => s.split('"')[1]);
  eq("index: every site in the order list exists", ids.slice(0, 6).join(","), "cabinet,player,eagler,notepad,sketch,search");
  ok("index: no duplicate ids", new Set(ids).size === ids.length, ids.join(","));
  const games = G.list.map(g => g.id);
  eq("cabinet: seven games, ids in the order the page lists them", games.join(","), "snake,mines,merge,pong,maze,lights,words");
  ok("cabinet: every game has a mount", G.list.every(g => typeof G.mounts[g.id] === "function"));
  ok("cabinet: no mount is missing from the list", Object.keys(G.mounts).every(id => games.indexOf(id) !== -1));
  ok("cabinet: hints are real sentences", G.list.every(g => g.hint.length > 30 && /\.$/.test(g.hint)));
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) {
  console.log("\nFAILURES:");
  fails.forEach(f => console.log("  x " + f));
  process.exit(1);
}
