// Time travel over a real session's documents: two peers on the WAN table,
// seats rolled every 2 s and checkpoints every second, so the record spans
// several seat documents and checkpoints. Every tick it reaches must rebuild
// to the state the documents give (harness replay, from genesis), whichever
// order travel visits them in, with its keyframes squeezed to a few; and the
// session document's own history must read back as what happened.
import { readFileSync } from "node:fs";
import { initSubduction } from "@automerge/automerge-repo";
import { SimNet } from "../host/simnet.js";
import { rig, run, WAN, LAN, LOSSLESS } from "../host/harness.js";
import { gunzip } from "../host/session.js";
import { hashSnapshot } from "../wasm-state.js";
import { Record } from "./record.js";
import { Travel } from "./travel.js";
import { sessionEvents } from "./events.js";

const wasm = readFileSync(new URL("../../engines/toy/dist/toy.wasm", import.meta.url));
const content = new TextEncoder().encode("record");
await initSubduction();
const { machine, session, replay } = await rig({
  wasm,
  content,
  input: (p, t) => new Uint8Array([(((t >> 3) + (p.port ?? 0)) % 5) - 2, t % 11 === (p.port ?? 0) ? 1 : 0]),
});
const FAST = { chunk: 0.25, every: 1, roll: 2 };

// The record as a viewer reads it, and its checkpoints' states, read now
// (while the repo's virtual time runs), for travel to load later.
// Awaits a promise while advancing virtual time (sync and streams run on it).
async function waited(promise) {
  let done = false;
  promise.finally(() => (done = true)).catch(() => {});
  while (!done) await vi.advanceTimersByTimeAsync(20);
  return promise;
}

async function recordOf(p) {
  const handle = await waited(p.repo.find(p.host.url));
  const doc = handle.doc();
  const record = new Record(doc);
  for (const s of record.seats()) record.ingest(s.id, (await waited(p.repo.find(s.inputs))).doc());
  const states = new Map();
  for (const c of record.checkpoints()) {
    const cp = (await waited(p.repo.find(c.url))).doc();
    const snap = await waited(gunzip(cp.state));
    if (hashSnapshot(snap) !== cp.hash) throw new Error("bad checkpoint");
    states.set(c.url, snap);
  }
  return { handle, record, load: async (url) => states.get(url).slice() };
}

async function settle(peers, ms) {
  await run(peers, ms);
  peers[0].host.pause();
  await run(peers, 1500);
}

describe("a played session", () => {
  let peers, truth, end, r;
  beforeAll(async () => {
    vi.useFakeTimers();
    ({ peers } = await session(new SimNet({ latency: WAN, loss: LOSSLESS }), 2, { seconds: FAST }));
    peers.forEach((p, i) => {
      p.port = i;
      p.host.sit(i);
    });
    await settle(peers, 4500);
    end = peers[0].host.tick;
    truth = await replay(peers[0], end);
    r = await recordOf(peers[0]);
    vi.useRealTimers();
  }, 60_000);

  test("the record holds every row up to where play stopped, across seat documents", () => {
    expect(r.record.seats().length).toBeGreaterThan(2); // rolled over
    expect(r.record.end).toBeGreaterThanOrEqual(end);
    for (let t = 0; t < end; t++) expect(r.record.rowAt(t)).not.toBe(null);
    expect(r.record.checkpoints().length).toBeGreaterThan(1);
  });

  // An order that goes forward, far back, across checkpoints and keyframes.
  const order = (n) => Array.from({ length: n + 1 }, (_, i) => (i * 37) % (n + 1));

  test.each([
    { how: "from genesis and its own keyframes", checkpoints: false },
    { how: "from checkpoints too", checkpoints: true },
  ])("every tick travels to the documents' state, $how", async ({ checkpoints }) => {
    const size = machine.boot(content).snapshot().length;
    // The toy steps so fast that loading a checkpoint is never worth it on
    // its own measure; a tiny aim makes keyframes dense and checkpoints worth it.
    const travel = new Travel(machine, content, r.record, { load: checkpoints ? r.load : null, budget: 3 * size, ...(checkpoints ? { aim: 0.001 } : {}) });
    const wrong = [];
    for (const t of order(end)) {
      travel.seek(t);
      let s;
      while ((s = travel.work(5)) !== "there") {
        expect(s).not.toBe("beyond");
        if (s === "waiting") await new Promise((ok) => setTimeout(ok, 1));
      }
      if (travel.engine.hash() !== truth[t]) wrong.push(t);
    }
    expect(wrong).toEqual([]);
    expect(travel.stats.mismatches).toEqual([]);
    if (checkpoints) expect(travel.stats.checkpoints).toBeGreaterThan(0);
  });

  test("past the record's end travel says so, and does not guess", () => {
    const travel = new Travel(machine, content, r.record);
    travel.seek(r.record.end + 5);
    let s;
    while ((s = travel.work(5)) === "going");
    expect(s).toBe("beyond");
    expect(travel.at).toBe(r.record.end);
  });

  test("the session document's history: claims, roll-overs, checkpoints, the pause", () => {
    const hz = 35;
    const ev = sessionEvents(r.handle, hz);
    const kinds = (k) => ev.filter((e) => e.kind === k);
    expect(kinds("made").length).toBe(1);
    expect(kinds("claim").map((e) => e.port).sort()).toEqual([0, 1]);
    expect(kinds("claim").every((e) => !e.concurrent)).toBe(true);
    expect(kinds("roll").length).toBeGreaterThan(0);
    expect(kinds("checkpoint").length).toBeGreaterThan(1);
    expect(kinds("pause").length).toBeGreaterThan(0);
    for (const e of ev) expect(e.time).toBeGreaterThan(0);
    // Read again, it reads only what is new: nothing.
    const memo = { changes: new Map(), spelled: new Map() };
    expect(sessionEvents(r.handle, hz, memo)).toEqual(ev);
    const n = memo.changes.size;
    sessionEvents(r.handle, hz, memo);
    expect(memo.changes.size).toBe(n);
  });
});

test("two peers take one port at once: both claims are concurrent, one loses", async () => {
  vi.useFakeTimers();
  try {
    const { peers } = await session(new SimNet({ latency: LAN, loss: LOSSLESS }), 2, { seconds: FAST });
    for (const p of peers) {
      p.port = 0;
      p.host.sit(0);
    }
    await run(peers, 2000);
    const handle = await peers[0].repo.find(peers[0].host.url);
    const ev = sessionEvents(handle, 35);
    const claims = ev.filter((e) => e.kind === "claim");
    expect(claims.length).toBe(2);
    expect(claims.every((e) => e.concurrent)).toBe(true);
    const lost = ev.filter((e) => e.kind === "lost");
    expect(lost.length).toBe(1);
    expect(claims.map((c) => c.seat)).toContain(lost[0].seat);
  } finally {
    vi.useRealTimers();
  }
}, 60_000);
