// Who builds (README.md, "Content", "Who builds": C1–C5), checked on a
// finite model: two or three real render managers, each with its own replica
// of the docs and its own view of one manual clock, over a network that
// delivers every message and change after a delay it chooses. Every run of
// each scenario is enumerated, depth first, over the choices that can make a
// difference: who edits, how long each claim, release and change takes to
// arrive (at once, or at exactly REACH_MS, the bound the timing invariants
// assume), how long a build takes, whether it fails, whether a builder
// freezes past LAPSE_MS and then wakes and writes, whether a message is lost.
// The assertions are the invariants.
//
// What is not varied, and why that is safe:
//   - delays strictly between 0 and REACH_MS: the protocol compares arrival
//     times only with its own windows (CLAIM_MS, LAPSE_MS, LISTEN_MS), and
//     the derivation (lock.js) meets each with a margin at both ends, so the
//     extremes are the hard cases, an exact tie at REACH_MS among them;
//   - heartbeats at other than REACH_MS: a heartbeat only keeps a claim live,
//     and the latest one (at the bound) is the hardest; one lost is the
//     lost-message runs';
//   - a message later than REACH_MS but not lost: it is a lost one followed
//     by its successor;
//   - who edits among more than two writers: an edit only decides which
//     replica sees new inputs first, which the editor and delay choices span;
//   - the provider beyond succeed, fail, short or long: the lock reads only
//     when build() settles and whether it threw.
// Choice points past `bound` in a run take their first option.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createRenderManager, RETRY_BACKOFF_MS } from "./render-manager.js";
import { CLAIM_MS, LAPSE_MS, LISTEN_MS, REACH_MS } from "./lock.js";
import { manualTime } from "../stage/time.js";
import { newRenderDoc } from "../datatype.js";
import { encodeGLB } from "../glb.js";
import { fakeHead, fakeUrl } from "../test/fake-repo.js";

const FRAME = 100;
const SHORT = 400;
const LONG = 2.5 * LAPSE_MS;
const FROZEN = LAPSE_MS + 4 * CLAIM_MS; // long enough for another peer to take over
const R = REACH_MS;

/**
 * Peers, each holding a replica of every doc and running on its own view of
 * the clock. A change made at a replica is the truth at once and reaches each
 * other replica after a chosen delay (a later version never goes back to an
 * earlier one); a broadcast reaches each other replica after one, or is
 * lost. A frozen peer runs nothing: what falls due for it (its timers,
 * deliveries to it, its builds settling) waits, in order, until it wakes.
 */
function network(time, peers, choose) {
  const truth = new Map(); // url → { versions: [{ doc, heads }] }
  const replicas = new Map(); // peer → url → replica
  const frozen = new Map(); // peer → what fell due while frozen
  let inFlight = 0;
  const gate = (peer, fn) => (frozen.has(peer) ? frozen.get(peer).push(fn) : fn());
  const deliver = (to, ms, fn) => {
    inFlight++;
    time.after(ms, () => {
      inFlight--;
      gate(to, fn);
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
      containsHeads: (hs) => hs.every((h) => t.versions.slice(0, r.version + 1).some((x) => x.heads.includes(h))),
      view(hs) {
        const v = t.versions.find((x) => x.heads.join() === [...hs].join());
        return v ? { url: `${url}#${hs.join("|")}`, doc: () => v.doc, heads: () => [...hs], isReadOnly: () => true, on() {}, off() {} } : { doc: () => ({}), heads: () => [...hs] };
      },
      isReadOnly: () => false,
      on: (ev, fn) => (listeners.get(ev) ?? listeners.set(ev, new Set()).get(ev)).add(fn),
      off: (ev, fn) => listeners.get(ev)?.delete(fn),
      emit: (ev, payload) => [...(listeners.get(ev) ?? [])].forEach((fn) => fn(payload)),
      change(fn) {
        const doc = structuredClone(t.versions.at(-1).doc);
        fn(doc);
        t.versions.push({ doc, heads: [fakeHead()] });
        const v = t.versions.length - 1;
        arrive(r, v);
        for (const q of peers) if (q !== peer) deliver(q, choose("change", { from: peer, url }), () => arrive(replicas.get(q).get(url), v));
      },
      broadcast(message) {
        for (const q of peers) {
          if (q === peer) continue;
          const ms = choose("message", { from: peer, to: q, message });
          if (ms != null) deliver(q, ms, () => replicas.get(q).get(url).emit("ephemeral-message", { message: structuredClone(message), senderId: peer }));
        }
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
    peerId: "page", // (two tabs of one page share a repo: the lock must not take this for its own)
    find: async (url) => {
      const r = replicas.get(peer).get(url);
      if (!r) throw new Error(`unavailable ${url}`);
      return r;
    },
    create2: async (doc) => replicas.get(peer).get(add(doc)),
  });
  /** A peer's view of the clock: its timers wait while it is frozen. */
  const timeOf = (peer) => Object.freeze({ manual: true, now: time.now, after: (ms, fn) => time.after(ms, () => gate(peer, fn)), frame: (fn) => time.frame(fn) });
  const last = (url) => truth.get(url).versions.at(-1);
  /** A change every replica has from the start (the doc as the run finds it). */
  function given(url, fn) {
    const t = truth.get(url);
    const doc = structuredClone(t.versions.at(-1).doc);
    fn(doc);
    t.versions.push({ doc, heads: [fakeHead()] });
    for (const p of peers) replicas.get(p).get(url).version = t.versions.length - 1;
  }
  return {
    add,
    given,
    repo,
    timeOf,
    handle: (peer, url) => replicas.get(peer).get(url),
    truth: (url) => last(url).doc,
    heads: (url) => last(url).heads.join(),
    versionOf: (url, heads) => truth.get(url).versions.findIndex((v) => v.heads.join() === [...(heads ?? [])].join()),
    freeze: (p) => frozen.set(p, []),
    // waking, it runs what fell due one task at a time, each one's promises settling before the next (as a page does)
    async wake(p) {
      const due = frozen.get(p) ?? [];
      frozen.delete(p);
      inFlight++;
      for (const fn of due) {
        fn();
        await new Promise((r) => setImmediate(r));
      }
      inFlight--;
    },
    frozen: (p) => frozen.has(p),
    quiet: () => inFlight === 0,
  };
}

/**
 * One run of a scenario, each choice made by pick(n) (an index into n
 * options). → what happened, for check(). The scenario:
 *   writers, readers   peer ids (the lower id wins a tie)
 *   atBound            every message and change takes exactly REACH_MS (no delay choices: the build choices then lie within the bound)
 *   built, stale       the render starts built from the source as it is, or from a version before it
 *   edit               "listened": once every writer has listened (LISTEN_MS); "claim": as the first claim goes out; "build": as the first build starts
 *   join               a writer that opens only as the first build starts
 *   freeze             the first builder may freeze past LAPSE_MS (a choice), then wake and finish
 *   force              a person asks writers[0] for a rebuild: "start", once it has opened; "build", as the first build starts
 *   fail               builds may fail (a choice each), at most this many
 *   pinned             the render is pinned
 *   lose               how many messages, of any kind, may be lost (a choice each)
 *   lostGLB            the render names a GLB file that never arrives, and is stale
 */
async function run(sc, pick) {
  const { writers, readers = [], atBound = false, built = false, stale = false, edit = null, join = null, freeze = false, force = null, fail = 0, pinned = false, lose = 0, lostGLB = false } = sc;
  const time = manualTime({ frameMs: FRAME, yieldTo: () => new Promise((r) => setImmediate(r)) });
  const peers = [...writers, ...readers];
  const log = { builds: [], ends: [], writes: [], replaced: [], shown: [], vanished: null, lost: false };
  let claims = 0;
  let lost = 0;
  const choose = (kind, info) => {
    if (kind === "message" && info.message.phase === "claim") claims++;
    if (kind === "message" && lost < lose && pick(2) === 1) return lost++, (log.lost = true), null;
    if (atBound) return R;
    if (kind === "message") {
      const phase = info.message.phase;
      // a claim or a release decides who builds: at once, or at the bound; a heartbeat, at the bound
      return phase === "claim" || phase === "done" ? [R, 0][pick(2)] : R;
    }
    return [R, 0][pick(2)];
  };
  const net = network(time, peers, choose);
  const sourceUrl = net.add({ "@patchwork": { type: "thing" }, size: 1 });
  const glb = encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }] });
  const seed = { ...newRenderDoc({ title: "Thing", parent: sourceUrl, providerId: "thing", params: {} }), pinned };
  if (built) Object.assign(seed, { glbUrl: net.add({ "@patchwork": { type: "file" }, content: glb }), builtFrom: { heads: [net.heads(sourceUrl)], fingerprint: null, paramsKey: "{}", deps: {} } });
  // stale: built from the source's version before the one every replica has
  if (stale || lostGLB) Object.assign(seed, { glbUrl: lostGLB ? "automerge:never-arrives" : net.add({ "@patchwork": { type: "file" }, content: glb }), builtFrom: { heads: [net.heads(sourceUrl)], fingerprint: null, paramsKey: "{}", deps: {} } });
  if (stale || lostGLB) net.given(sourceUrl, (d) => (d.size = 3));
  const renderUrl = net.add(seed);
  const building = new Map(); // peer → the source version its build reads
  let fails = 0;
  const managers = new Map();
  const said = new Map(); // peer → the state it says now
  const startSnap = new Map(); // peer → the render's build as its replica had it when its build began
  const buildOf = (doc) => JSON.stringify([doc.glbUrl ?? null, doc.builtFrom ?? null]);
  function onFirstBuild(peer) {
    if (join) queueMicrotask(() => open(join));
    if (force === "build") queueMicrotask(() => managers.get(writers[0])?.rebuild("o"));
    if (freeze && pick(2) === 1) {
      net.freeze(peer);
      log.vanished = { peer, at: time.now() };
      time.after(FROZEN, () => net.wake(peer));
    }
  }
  function open(peer) {
    const provider = {
      id: "thing",
      name: "Thing",
      params: [],
      module: {
        build: ({ signal }) =>
          new Promise((resolve, reject) => {
            const v = net.versionOf(sourceUrl, net.handle(peer, sourceUrl).heads());
            log.builds.push({ peer, v, at: time.now() });
            building.set(peer, v);
            startSnap.set(peer, buildOf(net.handle(peer, renderUrl).doc()));
            if (log.builds.length === 1) onFirstBuild(peer);
            const failing = fails < fail && pick(2) === 1;
            if (failing) fails++;
            const length = failing ? SHORT : [SHORT, LONG][pick(2)];
            const end = () => {
              if (building.get(peer) !== v) return;
              building.delete(peer);
              log.ends.push({ peer, at: time.now() });
            };
            const stop = net.timeOf(peer).after(length, () => (end(), failing ? reject(new Error("it breaks")) : resolve({ kind: "glb", glb })));
            signal?.addEventListener("abort", () => (stop(), end(), reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
          }),
      },
    };
    const handle = net.handle(peer, renderUrl);
    const change = handle.change;
    handle.change = (fn) => {
      const before = buildOf(handle.doc());
      const truthBefore = net.truth(renderUrl);
      let wrote = false;
      change((d) => {
        const was = buildOf(d);
        fn(d);
        wrote = buildOf(d) !== was;
      });
      const after = handle.doc();
      if (!wrote) return;
      const vNew = net.versionOf(sourceUrl, after.builtFrom?.heads);
      log.writes.push({ peer, before, start: startSnap.get(peer) });
      const vOld = truthBefore.builtFrom ? net.versionOf(sourceUrl, truthBefore.builtFrom.heads) : -1;
      if (vOld > vNew) log.replaced.push({ peer, vOld, vNew, seen: before === buildOf(truthBefore) });
    };
    const m = createRenderManager({
      repo: net.repo(peer),
      time: net.timeOf(peer),
      readOnly: readers.includes(peer),
      loadProvider: async () => provider,
      onState: (_id, s) => said.set(peer, s.state),
      onGLB: () => {},
    });
    managers.set(peer, m);
    m.track("o", { sourceUrl, renderUrl });
  }
  let edited = !edit;
  const doEdit = () => {
    edited = true;
    const live = writers.filter((w) => managers.has(w) && !net.frozen(w));
    const by = live[pick(live.length)];
    if (by) net.handle(by, sourceUrl).change((d) => (d.size = 2));
  };
  for (const p of peers) if (p !== join) open(p);
  let forced = force !== "start";
  const t0 = time.now();
  const settled = () => net.quiet() && building.size === 0 && writers.every((w) => !net.frozen(w));
  // (a run lasts until nothing has happened for long enough that nothing more will: past the last retry, if builds fail)
  const enough = 2 * LAPSE_MS + (fail ? Math.max(...RETRY_BACKOFF_MS) : 0);
  let quietSince = null;
  for (let i = 0; i < 6000; i++) {
    // while nothing is on its way, frames pass without waiting on the event loop, until something is
    if (quietSince != null) for (let k = 0; k < 100 && settled(); k++) time.tick({ draw: false });
    await time.step(1);
    for (const [peer, st] of said) if (st?.state === "building" && !net.frozen(peer)) log.shown.push({ peer, at: time.now(), live: [...building.keys()].some((p) => !net.frozen(p)) });
    if (!forced && i === 2) (forced = true), managers.get(writers[0]).rebuild("o");
    if (!edited && (edit === "claim" ? claims > 0 : edit === "build" ? log.builds.length > 0 : edit === "listened" ? time.now() - t0 > LISTEN_MS + FRAME : false)) doEdit();
    quietSince = settled() ? (quietSince ?? time.now()) : null;
    if (edited && forced && quietSince != null && time.now() - quietSince > enough) break;
  }
  const r = net.truth(renderUrl);
  log.fresh = r.builtFrom?.heads?.join() === net.heads(sourceUrl);
  log.failedNow = r.status === "error";
  log.end = time.now();
  log.states = Object.fromEntries([...said].map(([p, st]) => [p, st]));
  for (const m of managers.values()) m.dispose();
  return log;
}

/** Every run of `scenario`: depth first over its choices, at most `bound` choice points branching per run. */
async function everyRun(scenario, bound) {
  const runs = [];
  const stack = [[]];
  while (stack.length) {
    const prefix = stack.pop();
    const seen = [];
    let i = 0;
    const pick = (n) => {
      if (n <= 1) return 0;
      const c = i < prefix.length ? prefix[i] : 0;
      if (i >= prefix.length && i < bound) seen.push(n);
      i++;
      return c;
    };
    let ids = 0; // (each manager's lock id, from Math.random: in the order they open)
    const random = vi.spyOn(Math, "random").mockImplementation(() => (++ids % 997) / 1000);
    runs.push({ prefix, log: await run(scenario, pick) });
    random.mockRestore();
    for (let j = seen.length - 1; j >= 0; j--) for (let c = 1; c < seen[j]; c++) stack.push([...prefix, ...new Array(j).fill(0), c]);
  }
  return runs;
}

/** Each build's span [at, end), its end the same peer's next end at or after it. */
function spans(log) {
  const used = new Set();
  return log.builds.map((b) => {
    const e = log.ends.findIndex((x, i) => !used.has(i) && x.peer === b.peer && x.at >= b.at);
    if (e >= 0) used.add(e);
    return { ...b, end: e >= 0 ? log.ends[e].at : Infinity };
  });
}

/**
 * The invariants on one run (README.md, "Content", "Who builds"). Always, by
 * the write fence: C3, C4's first half, C5. With the timing assumption (every
 * message within REACH_MS, so not in a run with a lost one; a frozen peer
 * doesn't break it, its clock merely stops): C4's second half, C2, and
 * failing inputs tried at most 1 + RETRY_BACKOFF_MS.length times in all; and
 * C1, among the peers that aren't frozen.
 */
function check(sc, log) {
  const out = [];
  const timely = !log.lost;
  // C1: at most one peer builds a render at a time (a frozen one's build counted until it froze)
  if (timely) {
    const s = spans(log).map((b) => (log.vanished && b.peer === log.vanished.peer && b.at <= log.vanished.at && b.end > log.vanished.at ? { ...b, end: log.vanished.at } : b));
    for (const a of s) for (const b of s) if (a.peer < b.peer && a.at < b.end && b.at < a.end) out.push(`C1: ${a.peer} and ${b.peer} built at once (${a.at}, ${b.at})`);
  }
  // C2: a builder that vanishes is replaced within REACH_MS + LAPSE_MS + CLAIM_MS of its last word
  const left = sc.writers.filter((w) => w !== log.vanished?.peer).length > 0;
  if (log.vanished && left) {
    const next = log.builds.find((b) => b.at > log.vanished.at && b.peer !== log.vanished.peer);
    if (!next || next.at - log.vanished.at > R + LAPSE_MS + CLAIM_MS + 2 * FRAME) out.push(`C2: replaced after ${next ? next.at - log.vanished.at : "never"} ms`);
  }
  // C3: a peer that can't write never builds; a build is shown in progress only while one is, until its release arrives, or LAPSE_MS after its builder's last word
  for (const r of sc.readers ?? []) if (log.builds.some((b) => b.peer === r)) out.push(`C3: ${r} built`);
  for (const s of log.shown) {
    if (s.live) continue;
    const last = Math.max(-Infinity, ...log.ends.filter((e) => e.at <= s.at).map((e) => e.at), log.vanished?.at ?? -Infinity);
    const grace = log.lost || log.vanished ? R + LAPSE_MS + 2 * FRAME : R + 2 * FRAME;
    if (s.at - last > grace) out.push(`C3: ${s.peer} said building at ${s.at} with nobody building`);
  }
  // C4: a write replaces only the build its writer saw as its own began (so never a newer one it had received);
  // and, messages arriving in time, an older build never replaces a newer one, even from a peer that froze mid-build
  for (const w of log.writes) if (w.start !== undefined && w.before !== w.start) out.push(`C4: ${w.peer} wrote over a build that arrived during its own`);
  for (const x of log.replaced) if (x.seen || timely) out.push(`C4: ${x.peer} wrote version ${x.vNew} over version ${x.vOld}`);
  // C5: it ends built from the current inputs (or failed for them, or pinned), nobody saying a build is in progress
  if (left) {
    if (!log.fresh && !(sc.fail && log.failedNow) && !sc.pinned) out.push(`C5: not built from the current inputs at the end (${log.end} ms)`);
    for (const [p, st] of Object.entries(log.states)) if (st?.state === "building") out.push(`C5: ${p} still says building at the end`);
  }
  // retries: failing inputs are tried at most 1 + RETRY_BACKOFF_MS.length times in all, and once given up nobody says it's retrying
  if (sc.fail) {
    const byV = new Map();
    for (const b of log.builds) byV.set(b.v, (byV.get(b.v) ?? 0) + 1);
    if (timely && !log.vanished) for (const [v, n] of byV) if (n > 1 + RETRY_BACKOFF_MS.length) out.push(`retries: version ${v} built ${n} times`);
    for (const [p, st] of Object.entries(log.states)) if (log.failedNow && st?.state === "failed" && (st.retrying ?? st.retryAt != null)) out.push(`retries: ${p} still says retrying after it was given up`);
  }
  // holds: a pinned render is rebuilt only when a person asks
  if (sc.pinned && log.builds.length > (sc.force ? 1 : 0)) out.push(`pinned: built ${log.builds.length} times`);
  // a stale render whose GLB can't be shown is still rebuilt
  if (sc.lostGLB && !log.fresh) out.push(`an unloadable GLB kept the render from being rebuilt`);
  return out;
}

// C1, C2, C3, C4, C5: every run of each scenario keeps them all
describe("who builds: the lock, on a finite model (C1–C5)", () => {
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
    ["two writers open a render never built", { writers: ["a", "b"] }, 11],
    ["either writer edits a built render they have both listened to", { writers: ["a", "b"], built: true, edit: "listened" }, 12],
    ["either writer edits while the first claims are out", { writers: ["a", "b"], edit: "claim" }, 11],
    ["either writer edits while the first build runs", { writers: ["a", "b"], edit: "build" }, 11],
    ["a writer joins while the first build runs", { writers: ["a", "b"], join: "b" }, 11],
    ["the first builder of a stale render may freeze past LAPSE_MS, then wake and write; the other edits", { writers: ["a", "b"], stale: true, freeze: true, edit: "build" }, 11],
    ["a person asks a writer for a rebuild of a built render, and either edits while it builds", { writers: ["a", "b"], built: true, force: "start", edit: "build" }, 12],
    ["builds fail and are retried until given up; a reader watches", { writers: ["a", "b"], readers: ["r"], atBound: true, fail: 5 }, 13],
    ["a stale pinned render a person rebuilds, whose build fails", { writers: ["a", "b"], stale: true, pinned: true, force: "start", fail: 1 }, 9],
    ["a stale render whose GLB never arrives", { writers: ["a", "b"], lostGLB: true }, 9],
    ["one message may be lost; either edits", { writers: ["a", "b"], lose: 1, edit: "build" }, 11],
    ["two messages may be lost, every other at the bound", { writers: ["a", "b"], atBound: true, lose: 2, edit: "build" }, 13],
    ["three writers", { writers: ["a", "b", "c"] }, 10],
  ];
  for (const [name, scenario, bound] of scenarios) {
    it(`${name}: every run keeps the invariants`, async () => {
      const runs = await everyRun(scenario, bound);
      const bad = runs.flatMap(({ prefix, log }) => check(scenario, log).map((e) => `[${prefix.join("")}] ${e}`));
      expect(bad.slice(0, 5)).toEqual([]);
      expect(runs.length).toBeGreaterThan(8);
    }, 60_000);
  }
});
