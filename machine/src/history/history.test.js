// The history of a timeline, over every arrival schedule in a small finite
// space: two ports whose inputs arrive late by each of a few lags, two input
// scripts, and two snapshot spacings (so rewinds land on, and below, the tick
// that changed). For each, the toy engine's hash after every step is the
// truth, and the history must hold to it:
//   - a node is a state: whenever the engine steps to a node, it has the
//     hash it had every other time it stepped there;
//   - every node rebuilds (rebuild.js) to exactly that hash, from the root;
//   - siblings differ in their rows, and every extra child is one conflict,
//     whose ports are exactly where the two rows differ, and only late ones;
//   - once every input is known, the head's path is the true rows.
import { readFileSync } from "node:fs";
import { compile } from "../engine.js";
import { Timeline } from "../host/timeline.js";
import { History, pathTo, differ, ancestorAt } from "./history.js";
import { Rebuilder } from "./rebuild.js";
import { diffStates } from "./diff.js";

const wasm = readFileSync(new URL("../../engines/toy/dist/toy.wasm", import.meta.url));
const content = new TextEncoder().encode("history");
const machine = await compile(wasm);
const N = 24;
const W = 2; // the toy's inputBytes
const ALLOC = 1, FREE = 2;

const SCRIPTS = {
  // Inputs that change every few ticks, so predictions (repeat the last
  // known) are right for a while and then wrong.
  steady: (t, p) => [((t >> 2) + p) % 3, (t + p) % 7 === 0 ? ALLOC : 0],
  // One that changes every tick: every late input is a wrong prediction.
  jittery: (t, p) => [(t * (p + 1)) % 5, (t + p) % 3 === 0 ? FREE : (t + p) % 4 === 0 ? ALLOC : 0],
};
const LAGS = [0, 1, 3, 6];

function truth(script) {
  return Array.from({ length: N }, (_, t) => {
    const row = new Uint8Array(4 * W);
    for (let p = 0; p < 4; p++) row.set(script(t, p), p * W);
    return row;
  });
}

// Runs a timeline to N with port p's input for tick t arriving at time
// t + lags[p] (ports 2 and 3 on time), one frame per time, and returns the
// history, the hash of every node's state as the engine had it, and the run.
function play(rows, lags, every) {
  const engine = machine.boot(content);
  const history = new History({ inputBytes: W });
  const hashes = new Map(); // node -> hash
  const clash = [];
  const trace = (e) => {
    history.record(e);
    if ("step" in e) {
      const h = engine.hash();
      const had = hashes.get(history.head);
      if (had !== undefined && had !== h) clash.push(history.head.tick);
      hashes.set(history.head, h);
    }
  };
  const tl = new Timeline(engine, { every, max: 1000, trace });
  hashes.set(history.root, engine.hash());
  const lag = (p) => lags[p] ?? 0;
  const end = N + Math.max(...lags);
  for (let time = 0; time <= end; time++) {
    for (let p = 0; p < 4; p++) {
      const t = time - lag(p);
      if (t >= 0 && t < N) tl.put(p, t, rows[t].subarray(p * W, (p + 1) * W));
    }
    tl.advance(Math.min(time, N));
    history.record({ frame: time, target: Math.min(time, N), frontier: tl.frontier });
  }
  return { history, hashes, clash, tl };
}

const CASES = [];
for (const [name, script] of Object.entries(SCRIPTS))
  for (const a of LAGS) for (const b of LAGS) for (const every of [1, 4]) CASES.push({ name, script, lags: [a, b], every });

describe.each(CASES)("$name inputs, ports 0 and 1 late by $lags, a snapshot every $every", ({ script, lags, every }) => {
  const rows = truth(script);
  const { history, hashes, clash, tl } = play(rows, lags, every);
  const nodes = [...hashes.keys()];

  test("a node is a state: stepping to it always gives the same hash", () => {
    expect(clash).toEqual([]);
    expect(history.size).toBe(nodes.length);
  });

  test("every node rebuilds to the state the engine had there", () => {
    const r = new Rebuilder(machine, content, { keep: 4, every: 5 });
    const wrong = [];
    // In an order that moves around (forward, back, across branches).
    for (const n of [...nodes].sort((x, y) => ((x.id * 7) % 11) - ((y.id * 7) % 11)))
      if (r.at(n).hash() !== hashes.get(n)) wrong.push(n.tick);
    expect(wrong).toEqual([]);
  });

  test("siblings differ, and each extra child is one conflict on late ports", () => {
    let extra = 0;
    for (const n of nodes) {
      extra += Math.max(0, n.kids.length - 1);
      for (let i = 0; i < n.kids.length; i++)
        for (let j = i + 1; j < n.kids.length; j++)
          expect(differ(n.kids[i].row, n.kids[j].row, W).length).toBeGreaterThan(0);
    }
    expect(history.conflicts.length).toBe(extra);
    const late = [0, 1].filter((p) => lags[p] > 0);
    for (const c of history.conflicts) {
      expect(c.abandoned.parent).toBe(c.parent);
      expect(c.kept.parent).toBe(c.parent);
      expect(c.ports).toEqual(differ(c.abandoned.row, c.kept.row, W));
      expect(c.ports.length).toBeGreaterThan(0);
      for (const p of c.ports) expect(late).toContain(p);
      expect(ancestorAt(c.leaf, c.abandoned.tick)).toBe(c.abandoned);
      expect(c.restepped).toBeGreaterThan(0);
    }
    if (!late.length) expect(history.conflicts).toEqual([]);
  });

  test("once every input is known, the head's path is the true rows", () => {
    expect(tl.frontier).toBe(N);
    expect(history.head.tick).toBe(N);
    const path = pathTo(history.head);
    expect(path[0]).toBe(history.root);
    for (let t = 0; t < N; t++) expect([...path[t + 1].row]).toEqual([...rows[t]]);
  });
});

test("one late input that changes: one conflict, at its tick, on its port", () => {
  // Port 1 holds 0 (what a port is predicted to hold at the start) until
  // tick 5, then 2; it arrives 3 ticks late. The timeline steps 5, 6, 7 on 0
  // (the prediction), learns 2, rewinds.
  const rows = Array.from({ length: N }, (_, t) => {
    const row = new Uint8Array(4 * W);
    row[1 * W] = t < 5 ? 0 : 2;
    return row;
  });
  const { history } = play(rows, [0, 3], 1);
  expect(history.conflicts.length).toBe(1);
  const [c] = history.conflicts;
  expect(c.parent.tick).toBe(5);
  expect(c.ports).toEqual([1]);
  expect(c.abandoned.row[1 * W]).toBe(0);
  expect(c.kept.row[1 * W]).toBe(2);
  expect(c.leaf.tick).toBeGreaterThan(5);
  // The two branches' states differ, and only in memory the input reached.
  const r = new Rebuilder(machine, content);
  const kept = ancestorAt(history.head, c.leaf.tick);
  const d = diffStates(r.snapshot(c.leaf), r.snapshot(kept));
  expect(d.bytes).toBeGreaterThan(0);
  expect(d.regions.length).toBeGreaterThan(0);
  expect(diffStates(r.snapshot(kept), r.snapshot(kept)).bytes).toBe(0);
});

test("rerooting keeps every later state rebuildable and drops what came before", () => {
  const rows = truth(SCRIPTS.jittery);
  const { history, hashes } = play(rows, [3, 1], 4);
  const r = new Rebuilder(machine, content);
  const root = history.onPath(10);
  const before = history.size;
  history.reroot(root, r.snapshot(root));
  expect(history.size).toBeLessThan(before);
  expect(history.root).toBe(root);
  for (const c of history.conflicts) expect(c.parent.tick).toBeGreaterThanOrEqual(10);
  const fresh = new Rebuilder(machine, content);
  for (const n of pathTo(history.head)) expect(fresh.at(n).hash()).toBe(hashes.get(n));
});

test("a history keeps a window: confirmed states past it become the root", () => {
  const rows = truth(SCRIPTS.jittery);
  const engine = machine.boot(content);
  const history = new History({ inputBytes: W, keep: 6 });
  const hashes = new Map();
  const tl = new Timeline(engine, {
    every: 2,
    marks: (t) => t > 0 && t % 4 === 0,
    trace: (e) => {
      history.record(e);
      if ("step" in e) hashes.set(history.head, engine.hash());
    },
  });
  const roots = [];
  for (let time = 0; time <= N + 2; time++) {
    for (let p = 0; p < 4; p++) {
      const t = time - (p === 1 ? 2 : 0);
      if (t >= 0 && t < N) tl.put(p, t, rows[t].subarray(p * W, (p + 1) * W));
    }
    tl.advance(Math.min(time, N));
    history.record({ frame: time, target: Math.min(time, N), frontier: tl.frontier });
    if (roots.at(-1) !== history.root.tick) roots.push(history.root.tick);
  }
  // Rerooted at marked ticks only, each more than `keep` past the last.
  expect(roots.length).toBeGreaterThan(2);
  for (let i = 1; i < roots.length; i++) {
    expect(roots[i] % 4).toBe(0);
    expect(roots[i] - roots[i - 1]).toBeGreaterThan(6);
  }
  const r = new Rebuilder(machine, content);
  for (const n of pathTo(history.head)) expect(r.at(n).hash()).toBe(hashes.get(n) ?? engine.hash());
  expect(r.at(history.head).hash()).toBe(engine.hash());
});
