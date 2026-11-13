// Test support: peers on automerge-repo over a SimNet, in virtual time (the
// caller turns on fake timers), each running a Host; and the state a
// session's documents say it should be in, rebuilt from scratch. Every
// peer's engine is traced: the hash of every state it steps to, by tick, so
// that settle can hold each peer to the documents tick for tick, not only at
// the end. Uses vitest's globals (vi, expect), so it is for tests only.
import { Repo } from "@automerge/automerge-repo";
import { compile } from "../engine.js";
import { createSession, Host } from "./host.js";
import { seating, holder, chunkSpan, unpack } from "./session.js";

export const FRAME = 16;
export const LAN = [20, 25, 30];
export const WAN = [60, 140, 90, 250, 70];
export const LOSSLESS = [false];
export const LOSSY = [false, false, false, false, false, false, false, false, false, true]; // 1 in 10
export const SKEWS = [0, 37, -52, 91];

/**
 * A rig for one engine and content. `input(peer, tick)` is a peer's scripted
 * input at the tick its own clock says it is (so inputs never depend on
 * timing, only on the clock).
 */
export async function rig({ wasm, content, input }) {
  const machine = await compile(wasm);

  function peer(net, name, skew = 0) {
    const repo = new Repo({ peerId: name, network: [net.adapter(name)] });
    const p = { name, repo, now: () => Date.now() + skew, host: null, port: null };
    p.input = () => input(p, p.host ? p.host.target() : 0);
    return p;
  }

  async function open(p, url, o = {}) {
    const found = p.repo.find(url);
    await vi.advanceTimersByTimeAsync(500);
    await found;
    const opening = Host.open(p.repo, url, { wasm, content, id: p.name, now: p.now, input: p.input, ...o });
    while (!(await settled(opening))) await vi.advanceTimersByTimeAsync(20);
    p.host = await opening;
    trace(p);
    return p.host;
  }

  /** n peers (a, b, c, d) with skewed clocks, on one new session. */
  async function session(net, n, { seconds, ...o } = {}) {
    const peers = Array.from({ length: n }, (_, i) => peer(net, "abcd"[i], SKEWS[i]));
    const handle = await createSession(peers[0].repo, { wasm, content, wall: peers[0].now(), seconds });
    for (const p of peers) await open(p, handle.url, o);
    return { peers, url: handle.url };
  }

  // The states the session's documents say it should be in at ticks 0..n:
  // genesis, stepped with each port's durable inputs (vacant where nobody
  // sat). Returns their hashes, by tick.
  async function replay(p, n) {
    const doc = (await p.repo.find(p.host.url)).doc();
    const seated = seating(doc.seats, doc.engine.players);
    const inputs = new Map();
    for (const s of seated.flat()) {
      if (s.from >= n) continue;
      const sd = (await p.repo.find(doc.seats[s.id].inputs)).doc();
      const m = new Map();
      for (const [k, bytes] of Object.entries(sd.chunks)) {
        const [start] = chunkSpan(+k, doc.chunk, { from: sd.from });
        for (const [t, b] of unpack(start, bytes, doc.engine.inputBytes)) m.set(t, b);
      }
      inputs.set(s.id, m);
    }
    const e = machine.boot(content);
    const w = doc.engine.inputBytes;
    const hashes = [e.hash()];
    for (let t = 0; t < n; t++) {
      const row = new Uint8Array(doc.engine.players * w);
      for (let port = 0; port < doc.engine.players; port++) {
        const id = holder(seated, port, t);
        const b = id === null ? doc.vacant : inputs.get(id).get(t);
        if (!b) throw new Error(`no durable input for port ${port} at tick ${t}`);
        row.set(b, port * w);
      }
      e.step(row);
      hashes.push(e.hash());
    }
    return hashes;
  }

  // Pauses, lets everything land, and checks that every peer is at the same
  // tick, has every input below it, and has the state the documents give,
  // there and at every tick it confirmed on the way (from where it started).
  async function settle(peers) {
    peers[0].host.pause();
    await run(peers, 1500);
    const ticks = peers.map((p) => p.host.tick);
    expect(new Set(ticks).size).toBe(1);
    for (const p of peers) expect(p.host.frontier).toBeGreaterThanOrEqual(ticks[0]);
    const hashes = new Set(peers.map((p) => p.host.engine.hash()));
    expect(hashes.size).toBe(1);
    const truth = await replay(peers[0], ticks[0]);
    expect([...hashes][0]).toBe(truth[ticks[0]]);
    for (const p of peers) {
      const wrong = [];
      for (let t = p.host.status.start; t <= ticks[0]; t++) if (p.hashes.get(t) !== truth[t]) wrong.push(t);
      expect(wrong, `${p.name}'s states that differ from the documents'`).toEqual([]);
    }
    for (const p of peers) expect(p.host.status.desync).toEqual([]);
    for (const p of peers) expect(p.host.status.error).toBe(null);
    return ticks[0];
  }

  return { machine, peer, open, session, replay, settle };
}

// Records the hash of every state p's engine steps to, under the tick it
// reaches. A state stepped again (after a rollback) overwrites the old one,
// so once a tick is confirmed its entry is the confirmed state's. The
// timeline's tick is the one being stepped from while step runs.
function trace(p) {
  const e = p.host.engine;
  const step = e.step.bind(e);
  p.hashes = new Map([[p.host.tick, e.hash()]]);
  e.step = (row) => {
    const t = p.host.tick;
    step(row);
    p.hashes.set(t + 1, e.hash());
  };
}

/** Runs every peer's frame each FRAME ms of virtual time. */
export async function run(peers, ms) {
  for (let t = 0; t < ms; t += FRAME) {
    for (const p of peers) if (p.host) p.host.frame();
    await vi.advanceTimersByTimeAsync(FRAME);
  }
}

async function settled(promise) {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  await Promise.resolve();
  await Promise.resolve();
  return done;
}
