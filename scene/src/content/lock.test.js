// Who builds (README.md, "Content", C1–C4), checked on a finite model: two
// or three real render managers, each with its own replica of the docs, on
// one manual clock, over a network whose every message and change arrives
// after a delay it chooses. Every run of the model is enumerated: each
// claim and build message, each change of a doc and each build's length
// takes each of its choices in turn (at once or REACH_MS late; a short
// build or one past LAPSE_MS), and the first builder vanishes or doesn't,
// up to a bound on the choice points per run.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createRenderManager } from "./render-manager.js";
import { CLAIM_MS, LAPSE_MS, REACH_MS } from "./lock.js";
import { manualTime } from "../stage/time.js";
import { newRenderDoc } from "../datatype.js";
import { encodeGLB } from "../glb.js";
import { fakeHead, fakeUrl } from "../test/fake-repo.js";

const FRAME = 100;
const SHORT = 500;
const LONG = 2.5 * LAPSE_MS;

/**
 * A network of peers each holding a replica of every doc. A change made at
 * one replica is the truth at once and reaches each other replica after a
 * chosen delay (a later version never goes back to an earlier one); a
 * broadcast reaches each other replica's "ephemeral-message" after one.
 * A peer that vanishes sends and hears nothing more.
 */
function network(time, peers, choose) {
  const truth = new Map(); // url → { versions: [{ doc, heads }] }
  const replicas = new Map(); // peer → url → replica
  const gone = new Set();
  let inFlight = 0;
  const later = (ms, fn) => {
    inFlight++;
    time.after(ms, () => {
      inFlight--;
      fn();
    });
  };
  function replica(peer, url) {
    const t = truth.get(url);
    const listeners = new Map();
    const r = {
      url,
      version: t.versions.length - 1,
      doc: () => t.versions[r.version].doc,
      heads: () => [...t.versions[r.version].heads],
      containsHeads: (hs) => hs.every((h) => t.versions.slice(0, r.version + 1).some((v) => v.heads.includes(h))),
      view(hs) {
        const v = t.versions.find((x) => x.heads.join() === [...hs].join());
        return v ? { url: `${url}#${hs.join("|")}`, doc: () => v.doc, heads: () => [...hs], isReadOnly: () => true, on() {}, off() {} } : { doc: () => ({}), heads: () => [...hs] };
      },
      isReadOnly: () => false,
      on: (ev, fn) => (listeners.get(ev) ?? listeners.set(ev, new Set()).get(ev)).add(fn),
      off: (ev, fn) => listeners.get(ev)?.delete(fn),
      emit: (ev, payload) => [...(listeners.get(ev) ?? [])].forEach((fn) => fn(payload)),
      change(fn) {
        if (gone.has(peer)) return;
        const doc = structuredClone(t.versions.at(-1).doc);
        fn(doc);
        t.versions.push({ doc, heads: [fakeHead()] });
        const v = t.versions.length - 1;
        arrive(r, v);
        for (const q of peers) if (q !== peer) later(choose("change", { from: peer, url, doc }), () => !gone.has(q) && arrive(replicas.get(q).get(url), v));
      },
      broadcast(message) {
        if (gone.has(peer)) return;
        for (const q of peers) if (q !== peer) later(choose("message", { from: peer, message }), () => !gone.has(q) && replicas.get(q).get(url).emit("ephemeral-message", { message: structuredClone(message), senderId: peer }));
      },
    };
    return r;
  }
  function arrive(r, v) {
    if (v <= r.version) return;
    r.version = v;
    r.emit("change", {});
  }
  function add(doc) {
    const url = fakeUrl();
    truth.set(url, { versions: [{ doc: structuredClone(doc), heads: [fakeHead()] }] });
    for (const p of peers) (replicas.get(p) ?? replicas.set(p, new Map()).get(p)).set(url, replica(p, url));
    return url;
  }
  const repo = (peer) => ({
    peerId: peer,
    find: async (url) => {
      const r = replicas.get(peer).get(url);
      if (!r) throw new Error(`unavailable ${url}`);
      return r;
    },
    create2: async (doc) => replicas.get(peer).get(add(doc)),
  });
  const last = (url) => truth.get(url).versions.at(-1);
  return { add, repo, handle: (peer, url) => replicas.get(peer).get(url), truth: (url) => last(url).doc, heads: (url) => last(url).heads.join(), vanish: (p) => gone.add(p), gone, quiet: () => inFlight === 0 };
}

/**
 * One run of the model, its choices made by `choose(kind, info)` (an index
 * into the options it is offered). → what happened.
 */
async function run({ writers, readers = [], edit = null }, pick) {
  const time = manualTime({ frameMs: FRAME, yieldTo: () => new Promise((r) => setImmediate(r)) });
  const peers = [...writers, ...readers];
  const log = { builds: [], writes: [], vanished: null, shown: [] };
  const said = new Map(); // peer → the state it says now
  let ended = -Infinity; // when a build last ended
  let vanishable = true;
  let claims = 0;
  const choose = (kind, info) => {
    if (kind === "message" && info.message.phase === "claim") claims++;
    if (kind === "message") return info.message.phase === "claim" || info.message.phase === "build" ? [0, REACH_MS][pick(2)] : REACH_MS;
    return [0, REACH_MS][pick(2)];
  };
  const net = network(time, peers, choose);
  const sourceUrl = net.add({ "@patchwork": { type: "thing" }, size: 1 });
  const renderUrl = net.add(newRenderDoc({ title: "Thing", parent: sourceUrl, providerId: "thing", params: {} }));
  const building = new Map(); // peer → key being built, while it is
  const glb = encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }] });
  const managers = [];
  for (const peer of peers) {
    const provider = {
      id: "thing",
      name: "Thing",
      params: [],
      module: {
        build: ({ doc, signal }) =>
          new Promise((resolve, reject) => {
            const key = String(doc.size);
            log.builds.push({ peer, key, at: time.now() });
            building.set(peer, key);
            if (vanishable && !readers.includes(peer)) {
              vanishable = false;
              if (pick(2) === 1) {
                net.vanish(peer);
                building.delete(peer);
                log.vanished = { peer, at: time.now() };
                return;
              }
            }
            const length = [SHORT, LONG][pick(2)];
            const done = () => building.get(peer) === key && building.delete(peer) && (ended = time.now());
            const stop = time.after(length, () => (done(), resolve({ kind: "glb", glb })));
            signal.addEventListener("abort", () => (stop(), done(), reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
          }),
      },
    };
    const handle = net.handle(peer, renderUrl);
    const change = handle.change;
    handle.change = (fn) => {
      const before = handle.doc().glbUrl;
      change(fn);
      if (!net.gone.has(peer) && handle.doc().glbUrl !== before) log.writes.push({ peer, key: handle.doc().builtFrom.heads.join() });
    };
    const m = createRenderManager({
      repo: net.repo(peer),
      time,
      readOnly: readers.includes(peer),
      loadProvider: async () => provider,
      onState: (_id, s) => said.set(peer, s.state.state),
      onGLB: () => {},
    });
    managers.push(m);
    m.track("o", { sourceUrl, renderUrl });
  }
  const fresh = () => net.truth(renderUrl).builtFrom?.heads?.join() === net.heads(sourceUrl) && net.quiet();
  let edited = !edit;
  for (let i = 0; i < 2000; i++) {
    await time.step(1);
    // who says "building" now, and whether anyone is (or just was: its "done" on its way, its claim not yet lapsed)
    for (const [peer, st] of said) if (st === "building" && !net.gone.has(peer)) log.shown.push({ peer, at: time.now(), anyone: building.size > 0, ended });
    if (!edited && (edit === "claim" ? claims > 0 : log.builds.length > 0)) {
      // an edit while the first claims are out, or while the first build runs: what is built moves on
      edited = true;
      const by = writers.find((w) => !net.gone.has(w));
      net.handle(by, sourceUrl).change((d) => (d.size = 2));
    }
    if (edited && i % 10 === 0 && fresh() && building.size === 0) break;
  }
  log.fresh = fresh();
  log.end = time.now();
  for (const m of managers) m.dispose();
  return log;
}

/** Every run of `scenario` (depth-first over its choices, at most `bound` choice points branching per run). */
async function everyRun(scenario, bound = 12) {
  const runs = [];
  const stack = [[]];
  while (stack.length) {
    const prefix = stack.pop();
    const seen = [];
    let i = 0;
    const pick = (n) => {
      const c = i < prefix.length ? prefix[i] : 0;
      if (i >= prefix.length && i < bound) seen.push(n);
      i++;
      return c;
    };
    runs.push({ prefix, log: await run(scenario, pick) });
    // the next runs: each later choice point taken another way
    for (let j = seen.length - 1; j >= 0; j--) for (let c = 1; c < seen[j]; c++) stack.push([...prefix, ...new Array(j).fill(0), c]);
  }
  return runs;
}

/** C1–C4 on one run's log. */
function check({ writers, readers = [] }, log) {
  const byKey = new Map();
  for (const b of log.builds) byKey.set(b.key, [...(byKey.get(b.key) ?? []), b]);
  const out = [];
  // C1: a given (render, inputs) is built by one peer; twice only when its first builder vanished
  for (const [key, bs] of byKey) {
    const allowed = log.vanished && bs[0].peer === log.vanished.peer ? 2 : 1;
    if (bs.length > allowed) out.push(`C1: inputs ${key} built ${bs.length} times (${bs.map((b) => `${b.peer}@${b.at}`).join(", ")})`);
  }
  // C2: a builder that vanishes is replaced within REACH_MS + LAPSE_MS + CLAIM_MS of its last word
  const left = writers.filter((w) => w !== log.vanished?.peer).length > 0; // (a writer is left to build)
  if (log.vanished && left) {
    const next = log.builds.find((b) => b.at > log.vanished.at && b.peer !== log.vanished.peer);
    if (!next || next.at - log.vanished.at > REACH_MS + LAPSE_MS + CLAIM_MS + 2 * FRAME) out.push(`C2: replaced after ${next ? next.at - log.vanished.at : "never"} ms`);
  }
  // C3: a peer that can't write never builds; a build in progress is shown only while one is (or until
  // its "done" arrives, REACH_MS; or its claim lapses, LAPSE_MS after its builder vanished)
  for (const r of readers) if (log.builds.some((b) => b.peer === r)) out.push(`C3: ${r} built`);
  for (const s of log.shown) {
    const lately = s.at - s.ended <= REACH_MS + 2 * FRAME || (log.vanished && s.at - log.vanished.at <= REACH_MS + LAPSE_MS + 2 * FRAME);
    if (!s.anyone && !lately) out.push(`C3: ${s.peer} said building at ${s.at} with nobody building`);
  }
  // C4: a build's result is written once
  const writes = new Map();
  for (const w of log.writes) writes.set(w.key, (writes.get(w.key) ?? 0) + 1);
  for (const [key, n] of writes) if (n > 1) out.push(`C4: inputs ${key} written ${n} times`);
  // and it ends built from what is current, with no build running
  if (left && !log.fresh) out.push(`not built from the current inputs at the end (${log.end} ms)`);
  return out;
}

// C1, C2, C3, C4: every run of each scenario keeps them all
describe("who builds: the lock, on a finite model (C1–C4)", () => {
  beforeAll(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // GLB hashing without WebCrypto, so every step of a run lands on the manual clock
    vi.stubGlobal("crypto", {});
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const scenarios = [
    ["two writers open a render never built", { writers: ["a", "b"] }, 10],
    ["two writers, an edit while the first claims are out", { writers: ["a", "b"], edit: "claim" }, 10],
    ["two writers, an edit while the first build runs", { writers: ["a", "b"], edit: "build" }, 10],
    ["three writers", { writers: ["a", "b", "c"] }, 8],
    ["a writer and a reader", { writers: ["a"], readers: ["r"] }, 8],
    ["two writers and a reader", { writers: ["a", "b"], readers: ["r"] }, 8],
  ];
  for (const [name, scenario, bound] of scenarios) {
    it(`${name}: every run keeps C1–C4 and ends built`, async () => {
      const runs = await everyRun(scenario, bound);
      const bad = runs.flatMap(({ prefix, log }) => check(scenario, log).map((e) => `[${prefix.join("")}] ${e}`));
      expect(bad.slice(0, 5)).toEqual([]);
      expect(runs.length).toBeGreaterThan(64);
    }, 60_000);
  }
});
