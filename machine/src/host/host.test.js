// Peers over real automerge-repo, on an in-memory network with fixed latency
// and loss tables, in virtual time (fake timers): nothing is random.
import { readFileSync } from "node:fs";
import { initSubduction, DocHandle } from "@automerge/automerge-repo";
import { SimNet } from "./simnet.js";
import { rig, run, FRAME, LAN, WAN, LOSSLESS, LOSSY, SKEWS } from "./harness.js";
import { gzip } from "./session.js";
import { hashSnapshot } from "../wasm-state.js";
import { FULL } from "../test-tier.js";

const ALLOC = 1, FREE = 2;
const wasm = readFileSync(new URL("../../engines/toy/dist/toy.wasm", import.meta.url));
const content = new TextEncoder().encode("host");
await initSubduction();
// Each peer's input depends only on its port and the tick its clock says.
const { machine, peer, open, session: start, settle, replay } = await rig({
  wasm,
  content,
  input: (p, t) => {
    const k = p.port ?? 0;
    return new Uint8Array([(((t >> 3) + k) % 5) - 2, t % 11 === k ? ALLOC : t % 13 === k ? FREE : 0]);
  },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const FAST = { chunk: 0.25, every: 1, roll: 2 }; // so a short run rolls seats and writes checkpoints
const session = (net, n, o = {}) => start(net, n, { seconds: FAST, ...o });

// Fast tier: the gentlest and the harshest network; full: all four.
describe.each([
  { net: "LAN", latency: LAN, lost: "none", loss: LOSSLESS },
  { net: "LAN", latency: LAN, lost: "1 in 10", loss: LOSSY },
  { net: "WAN", latency: WAN, lost: "none", loss: LOSSLESS },
  { net: "WAN", latency: WAN, lost: "1 in 10", loss: LOSSY },
].filter((c, i) => FULL || i === 0 || i === 3))("$net latency, ephemeral lost: $lost", ({ latency, loss }) => {
  test.each([2, 3])("%i peers play, pause, and agree with the durable record", async (n) => {
    const net = new SimNet({ latency, loss });
    const { peers } = await session(net, n);
    peers.forEach((p, i) => {
      p.port = i;
      p.host.sit(i);
    });
    let spread = 0;
    for (let k = 0; k < 4; k++) {
      await run(peers, 1000);
      if (k > 0) {
        const targets = peers.map((p) => p.host.target());
        spread = Math.max(spread, Math.max(...targets) - Math.min(...targets));
      }
    }
    const tick = await settle(peers);
    expect(tick).toBeGreaterThan(4 * 35);
    // Seats rolled over to new documents (every 2 s here), and late inputs
    // were rolled back over wherever latency exceeds the input delay.
    const doc = (await peers[0].repo.find(peers[0].host.url)).doc();
    expect(Object.keys(doc.seats).length).toBeGreaterThan(n);
    if (latency === WAN) for (const p of peers) expect(p.host.stats.rewinds).toBeGreaterThan(0);
    // Local clocks are skewed by up to 143 ms. Each peer's estimate of the
    // shared time is off by at most half the spread of one-way latencies, and
    // two peers' errors can add: so ticks apart by at most that spread.
    expect(spread).toBeLessThanOrEqual(Math.max(1, Math.ceil(((Math.max(...latency) - Math.min(...latency)) * 35) / 1000)));
    expect(peers[0].host.status.written.checkpoints).toBeGreaterThan(0);
  }, 30_000);
});

test("a late joiner starts from the newest checkpoint and reaches the same state", async () => {
  const net = new SimNet({ latency: WAN, loss: LOSSY });
  const { peers, url } = await session(net, 2);
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  await run(peers, 4000);
  const d = peer(net, "d", SKEWS[3]);
  const opening = open(d, url);
  // The others keep playing while d loads.
  let done = false;
  opening.then(() => (done = true));
  while (!done) await run(peers, FRAME);
  peers.push(d);
  expect(d.host.status.start).toBeGreaterThan(0);
  expect(d.host.status.start % 35).toBe(0);
  await run(peers, 2000);
  d.port = 2;
  d.host.sit(2);
  await run(peers, 2000);
  await settle(peers);
}, 30_000);

test("a late joiner on a time budget catches up over several frames, to the same state", async () => {
  const net = new SimNet({ latency: WAN, loss: LOSSY });
  const { peers, url } = await session(net, 2);
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  await run(peers, 4000);
  // d's budget clock moves 1 ms each time it is read, once per step: a
  // budget of 5 ms is 5 steps a frame.
  let ms = 0;
  const d = peer(net, "d", SKEWS[3]);
  const opening = open(d, url, { budget: 5, perf: () => ms++ });
  let done = false;
  opening.then(() => (done = true));
  while (!done) await run(peers, FRAME);
  const behind = d.host.target() - d.host.tick;
  expect(behind).toBeGreaterThan(10);
  const steps = [];
  for (let i = 0; i < 40 && d.host.tick < d.host.target(); i++) {
    const was = d.host.tick;
    d.host.frame();
    steps.push(d.host.tick - was);
    await run(peers, FRAME);
  }
  expect(Math.max(...steps)).toBe(5);
  expect(steps.length).toBeGreaterThan(2);
  expect(d.host.tick).toBeGreaterThanOrEqual(d.host.target() - 1);
  peers.push(d);
  await run(peers, 1000);
  await settle(peers);
}, 30_000);

test("two peers take the same port at once: one gets it, everywhere", async () => {
  const net = new SimNet({ latency: WAN });
  const { peers } = await session(net, 3);
  peers[0].port = 0;
  peers[0].host.sit(0);
  peers[1].port = 1;
  peers[2].port = 1;
  peers[1].host.sit(1);
  peers[2].host.sit(1); // neither has heard of the other's claim
  await run(peers, 3000);
  const holders = peers.filter((p) => p.host.seat?.port === 1);
  expect(holders.length).toBe(1);
  const doc = (await peers[0].repo.find(peers[0].host.url)).doc();
  const claims = Object.values(doc.seats).filter((s) => s.port === 1);
  expect(claims.length).toBeGreaterThanOrEqual(2);
  expect(claims.filter((s) => s.until === s.from).length).toBe(1); // the loser gave its claim up
  await settle(peers);
}, 30_000);

test("the engine is asked a query once a state and kind; every answer is of the state the host is in, rollbacks included", async () => {
  // Two peers over a WAN, both playing: late inputs roll a's state back and re-step it. Each frame a
  // asks some of kinds 0, 1 and 9 (one the engine lacks: null), each twice; the 8 subsets in turn.
  const net = new SimNet({ latency: WAN });
  const { peers } = await session(net, 2);
  peers.forEach((p, i) => ((p.port = i), p.host.sit(i)));
  await run(peers, 500);
  const host = peers[0].host;
  const engine = host.engine;
  const own = engine.query.bind(engine);
  let calls = 0;
  engine.query = (kind) => (calls++, own(kind), kind === 9 ? null : { kind, hash: engine.hash() });
  const last = new Map(); // kind -> the state (tick and revision) it was last asked in
  let want = 0, same = 0, moved = 0, prev = null;
  for (let f = 0; f < 240; f++) {
    await run(peers, FRAME);
    const kinds = [0, 1, 9].filter((_, i) => (f % 8) & (1 << i));
    const state = `${host.tick}:${host.revision}`;
    for (const k of kinds) {
      const first = host.query(k);
      expect(host.query(k)).toBe(first); // the same answer to everyone in one state
      if (k === 9) expect(first).toBe(null);
      else expect(first).toEqual({ kind: k, hash: engine.hash() }); // of the state the engine is in now
      if (last.get(k) !== state) want++;
      last.set(k, state);
    }
    if (state === prev) same++;
    else moved++;
    prev = state;
  }
  expect(calls).toBe(want); // once a state and kind
  expect(same).toBeGreaterThan(0); // frames that didn't step
  expect(moved).toBeGreaterThan(0);
  expect(host.stats.rewinds).toBeGreaterThan(0);
  await settle(peers);
}, 30_000);

test("a holder who vanishes loses the rest of the seat; the others carry on", async () => {
  const net = new SimNet({ latency: WAN, loss: LOSSY });
  const { peers } = await session(net, 3, { reap: 2 });
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  await run(peers, 2500);
  const c = peers.pop();
  net.remove(c.name);
  await run(peers, 5000);
  const tick = peers[0].host.tick;
  for (const p of peers) expect(p.host.frontier).toBeGreaterThan(tick - 40);
  const doc = (await peers[0].repo.find(peers[0].host.url)).doc();
  const cs = Object.entries(doc.seats).filter(([id]) => id.startsWith("c."));
  expect(cs.every(([, s]) => s.until !== undefined)).toBe(true); // reaped
  await settle(peers);
}, 30_000);

test("standing up, and sitting again later, on a running session", async () => {
  const net = new SimNet({ latency: LAN });
  const { peers } = await session(net, 2);
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  await run(peers, 1500);
  peers[1].host.stand();
  expect(peers[1].host.seat).toBe(null);
  await run(peers, 1500);
  peers[1].port = 3;
  peers[1].host.sit(3);
  await run(peers, 1500);
  await settle(peers);
}, 30_000);

test("inputs lost in a burst longer than a message's redundancy are asked for", async () => {
  // 12 ephemeral messages in a row lost on every link, then 28 through: more
  // than the 8 inputs each message repeats. Chunks are 2 s here, so without
  // asking, a gap would last until its chunk is written.
  const burst = Array.from({ length: 40 }, (_, i) => i >= 20 && i < 32);
  const net = new SimNet({ latency: LAN, loss: burst });
  const { peers } = await session(net, 2, { seconds: { ...FAST, chunk: 2 } });
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  await run(peers, 1000);
  let lag = 0;
  for (let k = 0; k < 200; k++) {
    await run(peers, FRAME);
    for (const p of peers) lag = Math.max(lag, p.host.tick - p.host.frontier);
  }
  // The confirmed state trails the clock by at most the burst (12 messages,
  // one every 1/30 s: 14 ticks), plus the input delay (4: an input is sent
  // that many ticks early, and so is its loss), plus a LAN round trip (2):
  // 20. Without asking it trails by 43 here.
  expect(lag).toBeLessThanOrEqual(Math.ceil((12 * 35) / 30) + 4 + 2);
  for (const p of peers) expect(p.host.status.asked).toBeGreaterThan(0);
  await settle(peers);
}, 30_000);

test("a seat that ends below the floor sends the peer back to a checkpoint", async () => {
  // Chunks of 2 s: when b vanishes, a has b's inputs by message well past
  // what b made durable, and has confirmed states beyond that. Reaping ends
  // b's seat where its durable inputs end, below a's floor: a must start
  // again from a checkpoint before it, and replay with b's port vacant.
  const net = new SimNet({ latency: LAN });
  const { peers } = await session(net, 3, { reap: 1, seconds: { ...FAST, chunk: 2 } });
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  await run(peers, 3000);
  const c = peers.pop();
  net.remove(c.name);
  await run(peers, 3000);
  expect(peers.some((p) => p.host.status.rebases > 0)).toBe(true);
  await settle(peers);
}, 30_000);

test("a checkpoint computed under another seating is never started from, and is deleted", async () => {
  // What a writer that vanished mid-race leaves behind: a checkpoint whose
  // state is real and matches its hash, but was computed under a seating that
  // is not the session's (here genesis, labelled as a later tick). Its
  // writers are gone (a and b close, leaving their repos to serve the
  // documents), so nobody else deletes it before d opens.
  const net = new SimNet({ latency: LAN });
  const { peers, url } = await session(net, 2);
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  await run(peers, 4000);
  const handle = await peers[0].repo.find(url);
  const real = Object.keys(handle.doc().checkpoints).map(Number);
  expect(real.length).toBeGreaterThan(0);
  const tick = Math.max(...real) + 5;
  for (const p of peers) p.host.close();
  const snap = machine.boot(content).snapshot();
  const hash = hashSnapshot(snap);
  const cp = peers[0].repo.create({ session: url, tick, hash, state: await gzip(snap) });
  handle.change((d) => {
    d.checkpoints[tick] = { url: cp.url, hash, seating: "0000000000000000" };
  });
  const d = peer(net, "d", SKEWS[3]);
  await open(d, url);
  expect(d.host.status.start).toBeLessThan(tick);
  await run([d], 12_000); // d reaps the silent holders, so its frontier runs on
  expect(handle.doc().checkpoints[tick]).toBe(undefined);
  await settle([d]);
}, 30_000);

test("each peer hears every tick once, in order, and its events end up the documents' (output.js)", async () => {
  const net = new SimNet({ latency: WAN, loss: LOSSY });
  const { peers, url } = await session(net, 3);
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  const heard = new Map(peers.map((p) => [p, { next: p.host.status.start, events: new Map(), skipped: 0, corrected: 0 }]));
  const listen = () => {
    for (const [p, h] of heard)
      for (const o of p.host.output()) {
        if (o.gap) {
          expect(o.gap[0]).toBe(h.next);
          h.skipped += o.gap[1] - o.gap[0];
          h.next = o.gap[1];
        } else if (o.was) {
          expect(o.tick).toBeLessThan(h.next);
          expect(h.events.get(o.tick)).toEqual(o.was);
          h.events.set(o.tick, o.events);
          h.corrected++;
        } else {
          expect(o.tick).toBe(h.next++);
          expect(o.audio.samples.length).toBe(64);
          h.events.set(o.tick, o.events);
        }
      }
  };
  for (let k = 0; k < 250; k++) {
    await run(peers, FRAME);
    listen();
  }
  await settle(peers);
  listen();
  const end = Math.min(...[...heard.values()].map((h) => h.next));
  expect(end).toBeGreaterThan(200);
  const truth = new Map();
  await replay(peers[0], end, (t, e) => truth.set(t, e.output().events));
  for (const [p, h] of heard) {
    const wrong = [];
    for (const [t, events] of h.events) if (t < end && events.join() !== truth.get(t).join()) wrong.push(t);
    expect(wrong, `${p.name}'s ticks heard with other events than the documents'`).toEqual([]);
    // Every tick was heard or skipped; skipped only while the others set up.
    expect(h.events.size + h.skipped).toBe(h.next);
    expect(p.host.stats.output).toMatchObject({ delivered: h.events.size, skipped: h.skipped });
  }
  // The first peer waited for the others to open (1.5 s), and skipped that.
  expect(heard.get(peers[0]).skipped).toBeGreaterThan(0);
  // WAN latency is over the input delay, so some deliveries were corrected.
  expect([...heard.values()].reduce((n, h) => n + h.corrected, 0)).toBeGreaterThan(0);
}, 30_000);

test.skipIf(!FULL)("four peers through a hub, as through a sync server: each sends at most 30 input messages a second, and all agree", async () => {
  const net = new SimNet({ latency: WAN, loss: LOSSY, hub: "hub" });
  const { peers } = await session(net, 4);
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  await run(peers, 1000);
  // Each peer's broadcasts, by kind (its session handle is its own).
  const sent = new Map();
  const broadcast = DocHandle.prototype.broadcast;
  const spy = vi.spyOn(DocHandle.prototype, "broadcast").mockImplementation(function (m) {
    const k = sent.get(this) ?? sent.set(this, {}).get(this);
    k[m.m] = (k[m.m] ?? 0) + 1;
    return broadcast.call(this, m);
  });
  const heard = new Map(peers.map((p) => [p.name, net.by.get(p.name).received]));
  await run(peers, 4000);
  spy.mockRestore();
  expect(sent.size).toBe(4);
  for (const k of sent.values()) {
    // Inputs: at most 30 a second, give or take one at the window's edge,
    // and the answers to the others' requests for lost ones (1 in 10 is).
    expect(k.in).toBeLessThanOrEqual(4 * 30 + 1 + 4);
    expect(k["clock/ping"] / 4).toBeLessThanOrEqual(1);
  }
  // What a peer hears is the others' messages, each once, relayed by the hub.
  const all = [...sent.values()].reduce((n, k) => n + Object.values(k).reduce((a, b) => a + b, 0), 0);
  for (const p of peers) expect(net.by.get(p.name).received - heard.get(p.name)).toBeLessThanOrEqual(all);
  await settle(peers);
}, 30_000);
