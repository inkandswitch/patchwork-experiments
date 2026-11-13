// Faults: an engine that traps, on one peer or on all; a peer whose state
// has drifted from everyone else's; and a seat change deeper than the
// newest checkpoints. Real automerge-repo on SimNet, in virtual time.
import { readFileSync } from "node:fs";
import { initSubduction } from "@automerge/automerge-repo";
import { SimNet } from "./simnet.js";
import { rig, run, LAN, WAN, LOSSY } from "./harness.js";
import { seating } from "./session.js";

const ALLOC = 1, FREE = 2;
const wasm = readFileSync(new URL("../../engines/toy/dist/toy.wasm", import.meta.url));
const content = new TextEncoder().encode("host");
await initSubduction();
const { peer, session: start, settle, replay } = await rig({
  wasm,
  content,
  input: (p, t) => {
    const k = p.port ?? 0;
    return new Uint8Array([(((t >> 3) + k) % 5) - 2, t % 11 === k ? ALLOC : t % 13 === k ? FREE : 0]);
  },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const FAST = { chunk: 0.25, every: 1, roll: 2 };
const session = (net, n, o = {}) => start(net, n, { seconds: FAST, ...o });
const seated = (peers) =>
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });

// Makes p's engine trap when it steps a tick `when` picks, after the step has
// written memory, as a real trap leaves it.
function trapping(p, when) {
  const e = p.host.engine;
  const step = e.step;
  e.step = (row) => {
    const t = p.host.tick;
    step(row);
    if (when(t)) throw new WebAssembly.RuntimeError("unreachable");
  };
}

test("an engine that traps on one peer only: it says so and keeps its seat, and the others play on", async () => {
  const net = new SimNet({ latency: WAN, loss: LOSSY });
  const { peers } = await session(net, 3, { reap: 2 });
  seated(peers);
  await run(peers, 1000);
  const [a, b, c] = peers;
  const T = b.host.tick + 20;
  trapping(b, (t) => t === T);
  await run(peers, 4000); // twice the reap time
  expect(b.host.tick).toBe(T);
  expect(b.host.status.fault).toMatchObject({ tick: T, confirmed: true, error: expect.stringMatching(/unreachable/) });
  // b's inputs still flow, so nobody reaps it and nobody waits for it: b
  // holds port 1 from its first seat to now without a break.
  const doc = (await a.repo.find(a.host.url)).doc();
  const held = seating(doc.seats, 4)[1];
  expect(held.every((s) => s.id.startsWith("b."))).toBe(true);
  expect(held.slice(1).every((s, i) => s.from === held[i].until)).toBe(true);
  expect(held[held.length - 1].until).toBe(Infinity);
  for (const p of [a, c]) {
    expect(p.host.status.fault).toBe(null);
    expect(p.host.frontier).toBeGreaterThan(T + 3 * 35);
  }
  await settle([a, c], [b]);
  expect(b.host.tick).toBe(T);
}, 30_000);

test("an engine that traps on every peer at the same confirmed tick: all stop there, agree, and nobody hangs", async () => {
  const net = new SimNet({ latency: WAN, loss: LOSSY });
  const { peers } = await session(net, 3);
  seated(peers);
  await run(peers, 1000);
  const T = Math.max(...peers.map((p) => p.host.tick)) + 20;
  for (const p of peers) trapping(p, (t) => t === T);
  await run(peers, 3000);
  const truth = await replay(peers[0], T);
  for (const p of peers) {
    expect(p.host.tick).toBe(T);
    expect(p.host.status.fault).toMatchObject({ tick: T, confirmed: true });
    expect(p.host.frontier).toBeGreaterThan(T + 35); // inputs go on
    expect(p.host.engine.hash()).toBe(truth[T]);
  }
}, 30_000);

test("a peer whose state drifts from the others' says so at the next checkpoint; the others do not", async () => {
  const net = new SimNet({ latency: LAN });
  const { peers } = await session(net, 3);
  seated(peers);
  await run(peers, 1500);
  const c = peers[2]; // a holds port 0, so a writes the checkpoints
  const e = c.host.engine;
  const snap = e.snapshot();
  snap[snap.length - 4096] ^= 1; // one bit of memory, from here on
  e.restore(snap);
  await run(peers, 2500);
  expect(c.host.status.desync.length).toBeGreaterThan(0);
  const d = c.host.status.desync[0];
  expect(d.ours).not.toBe(d.theirs);
  expect(peers[0].host.status.desync).toEqual([]);
  expect(peers[1].host.status.desync).toEqual([]);
}, 30_000);

test("a seat change deeper than the two newest checkpoints rebases from the newest one before it, not from genesis", async () => {
  // As a partition healing would: a peer that did not hear of later inputs
  // ends a seat far back (here written directly). Every checkpoint is linked,
  // so the peers start again from the one just before the change.
  const net = new SimNet({ latency: LAN });
  const { peers, url } = await session(net, 3);
  seated(peers);
  await run(peers, 6000);
  const handle = await peers[0].repo.find(url);
  const linked = { ...handle.doc().checkpoints };
  const before = Object.keys(linked).map(Number).sort((x, y) => x - y);
  expect(before.length).toBeGreaterThan(4);
  // c's seat holding the tick half-way between the third and fourth newest checkpoints ends there.
  const at = (before[before.length - 4] + before[before.length - 3]) >> 1;
  const [id] = Object.entries(handle.doc().seats).find(([id, s]) => id.startsWith("c.") && s.from <= at && (s.until ?? Infinity) > at);
  handle.change((d) => {
    d.seats[id].until = at;
  });
  await run(peers, 1000);
  for (const p of peers) {
    expect(p.host.status.rebases).toBeGreaterThan(0);
    expect(p.host.status.start).toBe(before[before.length - 4]);
  }
  // The checkpoints after the change were computed under another seating:
  // unlinked, and those confirmed again since are new documents.
  const now = handle.doc().checkpoints;
  for (const t of before.filter((t) => t > at)) expect(now[t]?.url).not.toBe(linked[t].url);
  for (const t of before.filter((t) => t <= at)) expect(now[t].url).toBe(linked[t].url);
  await settle(peers);
}, 30_000);
