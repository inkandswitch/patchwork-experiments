// Who builds (README.md, "Content", "Who builds": C1–C5), checked on a
// finite model: two or three real render managers, each with its own replica
// of the docs and its own view of one manual clock, over a network that
// delivers every message and change after a delay it chooses. Replicas merge
// as Automerge does for the shape written (every key of a render doc a value
// of its own): each key's value is the write with the greater op id (counter,
// then actor), so writes made without seeing each other cross and one wins
// whole, by a rule that doesn't follow real time. Every run of each scenario
// is enumerated, depth first, over the choices that can make a difference:
// who edits, how long each claim, release and change takes to arrive (at
// once, or at exactly REACH_MS, the bound the timing invariants assume), how
// long a build takes, whether it fails, whether a builder freezes past
// LAPSE_MS and then wakes and writes, when a writer joins, whether a message
// is lost, and, where writes can cross, which writer's actor id wins a tie.
// The assertions are the invariants.
//
// What is not varied, and why that is safe:
//   - delays strictly between 0 and REACH_MS: the protocol compares arrival
//     times only with its own windows (CLAIM_MS, LAPSE_MS, LEASE_MS,
//     RECHECK_MS), and the derivation (lock.js) meets each with a margin at
//     both ends, so the extremes are the hard cases, an exact tie at
//     REACH_MS among them;
//   - heartbeats at other than REACH_MS: a heartbeat only keeps a claim live,
//     and the latest one (at the bound) is the hardest; one lost is the
//     lost-message runs';
//   - a message later than REACH_MS but not lost: it is a lost one followed
//     by its successor (a throttled tab's late heartbeats are their own run);
//   - who edits among more than two writers: an edit only decides which
//     replica sees new inputs first, which the editor and delay choices span;
//   - the provider beyond succeed, fail, short or long: the lock reads only
//     when build() settles and whether it threw;
//   - the actor order in runs where every message arrives in time: no two
//     result writes are concurrent there (asserted), so no tie is broken.
// Choice points past `bound` in a run take their first option.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createRenderManager, RETRY_BACKOFF_MS } from "./render-manager.js";
import { CLAIM_MS, HEARTBEAT_MS, LAPSE_MS, REACH_MS } from "./lock.js";
import { inputsKey } from "./staleness.js";
import { manualTime } from "../stage/time.js";
import { newRenderDoc } from "../shared/datatype.js";
import { encodeGLB } from "../glb.js";
import { fakeHead, fakeUrl } from "../test/fake-repo.js";

const FRAME = 100;
const SHORT = 400;
const LONG = 2.5 * LAPSE_MS;
const FROZEN = LAPSE_MS + 4 * CLAIM_MS; // long enough for another peer to take over
const WAKES_MID_CLAIM = LAPSE_MS + REACH_MS + CLAIM_MS / 2; // back while another peer's claim to take over stands
const R = REACH_MS;
const MINUTE = 60_000;
const SEED = "~seed"; // the actor of the changes every replica starts with

/**
 * Peers, each holding a replica of every doc and running on its own view of
 * the clock. A change is a set of puts, one per top-level key it changed,
 * each with an op id [counter, actor] (the counter one past the greatest the
 * replica has seen); it applies at its replica at once and reaches each other
 * after a chosen delay, applied there once what it depends on has arrived. A
 * key's value is its put with the greatest id, the actor's `rank` breaking a
 * tie. A broadcast reaches each other replica after a chosen delay, or is
 * lost. A frozen peer runs nothing: what falls due for it (its timers,
 * deliveries to it, its builds settling) waits, in order, until it wakes. A
 * throttled peer's timers (not its deliveries, nor its builds) fire on the
 * next whole minute.
 */
function network(time, peers, choose, rank, hooks = {}) {
  const docs = new Map(); // url → { log: changes in the order made, byHash }
  const replicas = new Map(); // peer → url → replica
  const frozen = new Map(); // peer → what fell due while frozen
  const throttled = new Set();
  let inFlight = 0;
  const gate = (peer, fn) => (frozen.has(peer) ? frozen.get(peer).push(fn) : fn());
  const deliver = (to, ms, fn) => {
    inFlight++;
    time.after(ms, () => {
      inFlight--;
      gate(to, fn);
    });
  };
  const newer = (a, b) => !b || a[0] > b[0] || (a[0] === b[0] && rank(a[1]) > rank(b[1]));
  /** Apply a change at a replica if what it depends on is there (else it waits): true if it applied. */
  function integrate(r, ch) {
    if (r.have.has(ch.hash)) return false;
    if (!ch.deps.every((h) => r.have.has(h))) return void r.waiting.push(ch), false;
    r.have.add(ch.hash);
    for (const h of ch.deps) r.tips.delete(h);
    r.tips.add(ch.hash);
    for (const op of ch.ops) {
      r.counter = Math.max(r.counter, op.id[0]);
      const cur = r.state.get(op.key);
      if (!newer(op.id, cur?.id)) continue;
      hooks.put?.(r.peer, r.url, op, cur);
      r.state.set(op.key, op);
    }
    r.cached = null;
    hooks.applied?.(r.peer, r.url, ch);
    const waiting = r.waiting;
    r.waiting = [];
    for (const c of waiting) integrate(r, c);
    return true;
  }
  const docOf = (state) => Object.fromEntries([...state].filter(([, op]) => op.value !== undefined).map(([k, op]) => [k, op.value]));
  function opsFor(before, after, counter, actor) {
    const ops = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) ops.push({ key, value: after[key], id: [counter + ops.length + 1, actor] });
    }
    return ops;
  }
  function replica(peer, url) {
    const listeners = new Map();
    const r = {
      peer,
      url,
      have: new Set(),
      tips: new Set(),
      state: new Map(), // key → its winning put
      counter: 0,
      waiting: [],
      cached: null,
      doc: () => (r.cached ??= docOf(r.state)),
      heads: () => [...r.tips].sort(),
      containsHeads: (hs) => hs.every((h) => r.have.has(h)),
      view(hs) {
        const d = docs.get(url);
        const wanted = new Set();
        const walk = (h) => {
          if (wanted.has(h) || !d.byHash.has(h)) return;
          wanted.add(h);
          d.byHash.get(h).deps.forEach(walk);
        };
        hs.forEach(walk);
        if (![...hs].every((h) => r.have.has(h))) return { doc: () => ({}), heads: () => [...hs] };
        const state = new Map();
        for (const ch of d.log) if (wanted.has(ch.hash)) for (const op of ch.ops) if (newer(op.id, state.get(op.key)?.id)) state.set(op.key, op);
        const doc = docOf(state);
        return { url: `${url}#${hs.join("|")}`, doc: () => doc, heads: () => [...hs], isReadOnly: () => true, on() {}, off() {} };
      },
      isReadOnly: () => false,
      on: (ev, fn) => (listeners.get(ev) ?? listeners.set(ev, new Set()).get(ev)).add(fn),
      off: (ev, fn) => listeners.get(ev)?.delete(fn),
      emit: (ev, payload) => [...(listeners.get(ev) ?? [])].forEach((fn) => fn(payload)),
      change(fn) {
        const before = r.doc();
        const draft = structuredClone(before);
        fn(draft);
        const ops = opsFor(before, draft, r.counter, peer);
        if (!ops.length) return;
        const ch = { hash: fakeHead(), deps: [...r.tips], ops, by: peer };
        docs.get(url).log.push(ch);
        docs.get(url).byHash.set(ch.hash, ch);
        integrate(r, ch);
        r.emit("change", {});
        for (const q of peers) {
          if (q === peer) continue;
          const there = replicas.get(q).get(url);
          deliver(q, choose("change", { from: peer, url }), () => integrate(there, ch) && there.emit("change", {}));
        }
      },
      broadcast(message) {
        hooks.said?.(peer, message);
        for (const q of peers) {
          if (q === peer) continue;
          const ms = choose("message", { from: peer, to: q, message });
          if (ms != null) deliver(q, ms, () => replicas.get(q).get(url).emit("ephemeral-message", { message: structuredClone(message), senderId: peer }));
        }
      },
    };
    return r;
  }
  /** A change every replica has from the start (the doc as the run finds it). */
  function given(url, fn) {
    const any = replicas.get(peers[0]).get(url);
    const draft = structuredClone(any.doc());
    fn(draft);
    const ch = { hash: fakeHead(), deps: [...any.tips], ops: opsFor(any.doc(), draft, any.counter, SEED), by: SEED };
    docs.get(url).log.push(ch);
    docs.get(url).byHash.set(ch.hash, ch);
    for (const p of peers) integrate(replicas.get(p).get(url), ch);
  }
  function add(doc) {
    const url = fakeUrl();
    docs.set(url, { log: [], byHash: new Map() });
    for (const p of peers) (replicas.get(p) ?? replicas.set(p, new Map()).get(p)).set(url, replica(p, url));
    given(url, (d) => Object.assign(d, structuredClone(doc)));
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
  /** A peer's view of the clock: its timers wait while it is frozen, and fire on whole minutes while it is throttled. */
  const timeOf = (peer) =>
    Object.freeze({
      manual: true,
      now: time.now,
      after: (ms, fn) => {
        const due = time.now() + ms;
        const at = throttled.has(peer) ? Math.ceil(due / MINUTE) * MINUTE : due;
        return time.after(at - time.now(), () => gate(peer, fn));
      },
      frame: (fn) => time.frame(fn),
    });
  return {
    add,
    given,
    repo,
    timeOf,
    /** Work that isn't a timer of the page's (a build finishing): never throttled, but it waits while its peer is frozen. */
    rawAfter: (peer, ms, fn) => time.after(ms, () => gate(peer, fn)),
    handle: (peer, url) => replicas.get(peer).get(url),
    last: (url) => docs.get(url).log.at(-1),
    /** The source version these heads name: the index of the latest change among them, in the order changes were made. */
    versionOf: (url, heads) => Math.max(-1, ...(heads ?? []).map((h) => docs.get(url).log.findIndex((c) => c.hash === h))),
    freeze: (p) => frozen.set(p, []),
    throttle: (p) => throttled.add(p),
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
 *   writers, readers   peer ids (the lower id wins a tie; ids are given in the order peers open)
 *   atBound            every message and change takes exactly REACH_MS (no delay choices: the build choices then lie within the bound)
 *   built, stale       the render starts built from the source as it is, or from a version before it
 *   edit               "later": once both have long had the render open; "claim": as the first claim goes out; "build": as the first build starts
 *   join               a writer that opens only once the first build has begun: as it starts, or HEARTBEAT_MS + D + a frame later (between the builder's heartbeats)
 *   freeze             the first builder may freeze past LAPSE_MS (a choice: not, until another has taken over, or until
 *                      another's claim to take over is out), then wake and finish
 *   throttle           the first builder's timers fire on whole minutes from its first build on (a background tab)
 *   force              a person asks writers[0] for a rebuild: "start", once it has opened; "build", as the first build starts
 *   fail               builds may fail (a choice each), at most this many
 *   versions, failsV   each writer's provider version; the builds of version failsV fail, the others' succeed
 *   lengths            how long a build that succeeds may take (a choice)
 *   pinned             the render is pinned
 *   lose               how many messages, of any kind, may be lost (a choice each)
 *   partition          every message between the writers is lost (their changes still sync)
 *   lostGLB            the render names a GLB file that never arrives, and is stale
 *   ties               which writer's actor id wins a tie between concurrent writes (a choice)
 */
async function run(sc, pick) {
  const { writers, readers = [], atBound = false, built = false, stale = false, edit = null, join = null, freeze = false, throttle = false, force = null, fail = 0, versions = {}, failsV = null, lengths = [SHORT, LONG], pinned = false, lose = 0, partition = false, lostGLB = false, ties = false } = sc;
  const time = manualTime({ frameMs: FRAME, yieldTo: () => new Promise((r) => setImmediate(r)) });
  const peers = [...writers, ...readers];
  const order = ties && pick(2) === 1 ? [...peers].reverse() : peers;
  const rank = (actor) => order.indexOf(actor); // (SEED: -1)
  const log = { builds: [], ends: [], writes: [], replaced: [], shown: [], vanished: null, lost: false, readerWrote: false };
  let claims = 0;
  let lost = 0;
  const choose = (kind, info) => {
    if (kind === "message" && info.message.phase === "claim") claims++;
    if (kind === "message" && partition) return (log.lost = true), null;
    if (kind === "message" && lost < lose && pick(2) === 1) return lost++, (log.lost = true), null;
    if (atBound) return R;
    if (kind === "message") {
      const phase = info.message.phase;
      // a claim or a release decides who builds: at once, or at the bound; a heartbeat, at the bound
      return phase === "claim" || phase === "done" ? [R, 0][pick(2)] : R;
    }
    return [R, 0][pick(2)];
  };
  const lastWord = new Map(); // peer → when it last spoke
  const seenWrites = new Map(); // peer → the result writes its replica has
  let sourceUrl = null;
  let renderUrl = null;
  const versionOfResult = (result) => (result?.builtFrom ? net.versionOf(sourceUrl, result.builtFrom.heads) : -1);
  const net = network(time, peers, choose, rank, {
    said: (peer) => lastWord.set(peer, time.now()),
    applied: (peer, url, ch) => {
      if (url === renderUrl && ch.ops.some((op) => op.key === "result")) (seenWrites.get(peer) ?? seenWrites.set(peer, new Set()).get(peer)).add(ch.hash);
    },
    // a result put that wins at a replica, by its own write or a merge: never an older build over a newer one (in time)
    put: (peer, url, op, cur) => {
      if (url !== renderUrl || op.key !== "result" || !cur) return;
      const vOld = versionOfResult(cur.value);
      const vNew = versionOfResult(op.value);
      if (vOld > vNew) log.replaced.push({ at: peer, by: op.id[1], vOld, vNew });
    },
  });
  sourceUrl = net.add({ "@patchwork": { type: "thing" }, size: 1 });
  const glb = encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }] });
  const seed = { ...newRenderDoc({ title: "Thing", parent: sourceUrl, providerId: "thing", params: {} }), pinned };
  const result = (glbUrl) => ({ glbUrl, builtFrom: { heads: net.handle(peers[0], sourceUrl).heads(), fingerprint: null, paramsKey: "{}", deps: {} }, bounds: null, builtAt: 0 });
  if (built) seed.result = result(net.add({ "@patchwork": { type: "file" }, content: glb }));
  // stale: built from the source's version before the one every replica has
  if (stale || lostGLB) seed.result = result(lostGLB ? "automerge:never-arrives" : net.add({ "@patchwork": { type: "file" }, content: glb }));
  if (stale || lostGLB) net.given(sourceUrl, (d) => (d.size = 3));
  renderUrl = net.add(seed);
  const building = new Map(); // peer → the source version its build reads
  let fails = 0;
  const managers = new Map();
  const said = new Map(); // peer → the state it says now
  const startSnap = new Map(); // peer → the render's result as its replica had it when its build began
  const resultOf = (doc) => JSON.stringify(doc.result ?? null);
  function onFirstBuild(peer) {
    if (join) {
      if (pick(2) === 0) queueMicrotask(() => open(join));
      else time.after(HEARTBEAT_MS + R + FRAME, () => open(join));
    }
    if (force === "build") queueMicrotask(() => managers.get(writers[0])?.rebuild("o"));
    if (throttle) net.throttle(peer);
    const frozenFor = freeze ? [0, FROZEN, WAKES_MID_CLAIM][pick(3)] : 0;
    if (frozenFor) {
      net.freeze(peer);
      log.vanished = { peer, at: time.now(), word: lastWord.get(peer) ?? time.now() };
      time.after(frozenFor, () => net.wake(peer));
    }
  }
  function open(peer) {
    const provider = {
      id: "thing",
      name: "Thing",
      params: [],
      version: versions[peer],
      module: {
        build: ({ signal }) =>
          new Promise((resolve, reject) => {
            const v = net.versionOf(sourceUrl, net.handle(peer, sourceUrl).heads());
            log.builds.push({ peer, v, pv: versions[peer], at: time.now() });
            building.set(peer, v);
            startSnap.set(peer, resultOf(net.handle(peer, renderUrl).doc()));
            if (log.builds.length === 1) onFirstBuild(peer);
            const failing = failsV != null ? versions[peer] === failsV : fails < fail && pick(2) === 1;
            if (failing) fails++;
            const length = failing ? SHORT : lengths[pick(lengths.length)];
            const end = () => {
              if (building.get(peer) !== v) return;
              building.delete(peer);
              log.ends.push({ peer, at: time.now() });
            };
            const stop = net.rawAfter(peer, length, () => (end(), failing ? reject(new Error("it breaks")) : resolve({ kind: "glb", glb })));
            signal?.addEventListener("abort", () => (stop(), end(), reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
          }),
      },
    };
    const handle = net.handle(peer, renderUrl);
    const change = handle.change;
    handle.change = (fn) => {
      if (readers.includes(peer)) log.readerWrote = true;
      const before = resultOf(handle.doc());
      const seen = new Set(seenWrites.get(peer) ?? []);
      change(fn);
      const ch = net.last(renderUrl);
      if (ch?.by !== peer || !ch.ops.some((op) => op.key === "result")) return;
      log.writes.push({ peer, hash: ch.hash, before, start: startSnap.get(peer), seen, value: resultOf(handle.doc()) });
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
  // (a run lasts until nothing has happened for long enough that nothing more will: past the last retry, or a throttled timer's minute)
  const enough = 2 * LAPSE_MS + (fail || failsV != null ? Math.max(...RETRY_BACKOFF_MS) : 0) + (throttle ? 2 * MINUTE : 0);
  let quietSince = null;
  for (let i = 0; i < 6000; i++) {
    // while nothing is on its way, frames pass without waiting on the event loop, until something is
    if (quietSince != null) for (let k = 0; k < 100 && settled(); k++) time.tick({ draw: false });
    await time.step(1);
    for (const [peer, st] of said) if (st?.state === "building" && !net.frozen(peer)) log.shown.push({ peer, at: time.now(), live: [...building.keys()].some((p) => !net.frozen(p)) });
    if (!forced && i === 2) (forced = true), managers.get(writers[0]).rebuild("o");
    if (!edited && (edit === "claim" ? claims > 0 : edit === "build" ? log.builds.length > 0 : edit === "later" ? time.now() - t0 > LAPSE_MS + FRAME : false)) doEdit();
    quietSince = settled() ? (quietSince ?? time.now()) : null;
    if (edited && forced && quietSince != null && time.now() - quietSince > enough) break;
  }
  // every replica merged to the same docs
  const renders = peers.map((p) => JSON.stringify(net.handle(p, renderUrl).doc()));
  const sources = peers.map((p) => net.handle(p, sourceUrl).heads().join());
  log.converged = new Set(renders).size === 1 && new Set(sources).size === 1;
  const r = net.handle(writers[0], renderUrl).doc();
  log.whole = resultOf(r) === resultOf(seed) || log.writes.some((w) => w.value === resultOf(r));
  const heads = net.handle(writers[0], sourceUrl).heads();
  log.fresh = (r.result?.builtFrom?.heads ?? []).join() === heads.join();
  log.failedNow = r.failure != null && writers.some((w) => r.failure.inputs === inputsKey(r, { heads, fingerprint: null, deps: {}, providerVersion: versions[w] }));
  log.crossed = log.writes.filter((a, i) => log.writes.some((b, j) => j > i && a.peer !== b.peer && !a.seen.has(b.hash) && !b.seen.has(a.hash))).length;
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
 * The invariants on one run (README.md, "Content", "Who builds"). Always:
 * C3, C4's first half, C5. With the timing assumption (every message within
 * REACH_MS, so not in a run with a lost one nor a throttled tab; a frozen
 * peer doesn't break it, its clock merely stops): C4's second half, C2,
 * failing inputs tried at most 1 + RETRY_BACKOFF_MS.length times in all, no
 * two result writes concurrent; and C1, among the peers that aren't frozen.
 */
function check(sc, log) {
  const out = [];
  const timely = !log.lost && !sc.throttle;
  // C1: at most one peer builds a render at a time (a frozen one's build counted until it froze)
  if (timely) {
    const s = spans(log).map((b) => (log.vanished && b.peer === log.vanished.peer && b.at <= log.vanished.at && b.end > log.vanished.at ? { ...b, end: log.vanished.at } : b));
    for (const a of s) for (const b of s) if (a.peer < b.peer && a.at < b.end && b.at < a.end) out.push(`C1: ${a.peer} and ${b.peer} built at once (${a.at}, ${b.at})`);
  }
  // C2: a builder that vanishes is replaced within REACH_MS + LAPSE_MS + CLAIM_MS of its last word
  const left = sc.writers.filter((w) => w !== log.vanished?.peer).length > 0;
  if (log.vanished && left && timely) {
    const next = log.builds.find((b) => b.at > log.vanished.at && b.peer !== log.vanished.peer);
    if (!next || next.at - log.vanished.word > R + LAPSE_MS + CLAIM_MS + 2 * FRAME) out.push(`C2: replaced ${next ? next.at - log.vanished.word : "never"} ms after its last word`);
  }
  // C3: a peer that can't write never builds nor writes; a build is shown in progress only while one is,
  // until its release arrives, or LAPSE_MS after its builder's last word
  for (const r of sc.readers ?? []) if (log.builds.some((b) => b.peer === r)) out.push(`C3: ${r} built`);
  if (log.readerWrote) out.push(`C3: a reader wrote the render doc`);
  for (const s of log.shown) {
    if (s.live) continue;
    const last = Math.max(-Infinity, ...log.ends.filter((e) => e.at <= s.at).map((e) => e.at), log.vanished?.word ?? -Infinity);
    const grace = log.lost || log.vanished || sc.throttle ? R + LAPSE_MS + 2 * FRAME : R + 2 * FRAME;
    if (s.at - last > grace) out.push(`C3: ${s.peer} said building at ${s.at} with nobody building`);
  }
  // C4: a write replaces only the result its writer had as its build began (so never a newer one it had received);
  // and, messages arriving in time, no two result writes are concurrent and an older build never replaces a newer one
  // at any replica, by a write or a merge, even from a peer that froze mid-build
  for (const w of log.writes) if (w.start !== undefined && w.before !== w.start) out.push(`C4: ${w.peer} wrote over a result that arrived during its build`);
  if (timely) {
    for (const x of log.replaced) out.push(`C4: at ${x.at}, ${x.by}'s version ${x.vNew} replaced version ${x.vOld}`);
    if (log.crossed) out.push(`C4: ${log.crossed} result writes crossed`);
  }
  // C5: it ends merged alike everywhere, built from the current inputs (or failed for them, or pinned), nobody saying a build is in progress
  if (!log.converged) out.push(`C5: the replicas didn't converge`);
  if (!log.whole) out.push(`C4: the result is no one writer's whole`);
  if (left) {
    if (!log.fresh && !(sc.fail && log.failedNow) && !sc.pinned) out.push(`C5: not built from the current inputs at the end (${log.end} ms)`);
    for (const [p, st] of Object.entries(log.states)) if (st?.state === "building") out.push(`C5: ${p} still says building at the end`);
  }
  // retries: failing inputs are tried at most 1 + RETRY_BACKOFF_MS.length times in all, and once given up nobody says it's retrying
  if (sc.fail || sc.failsV != null) {
    const byInputs = new Map();
    for (const b of log.builds) byInputs.set(`${b.v}|${b.pv}`, (byInputs.get(`${b.v}|${b.pv}`) ?? 0) + 1);
    if (timely && !log.vanished) for (const [k, n] of byInputs) if (n > 1 + RETRY_BACKOFF_MS.length) out.push(`retries: inputs ${k} built ${n} times`);
    for (const [p, st] of Object.entries(log.states)) if (st?.state === "failed" && st.retrying) out.push(`retries: ${p} still says retrying after it was given up`);
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
    ["either writer edits a built render they have long had open", { writers: ["a", "b"], built: true, edit: "later" }, 12],
    ["either writer edits while the first claims are out", { writers: ["a", "b"], edit: "claim" }, 11],
    ["either writer edits while the first build runs", { writers: ["a", "b"], edit: "build" }, 11],
    ["a writer joins as the first build starts, or between its builder's heartbeats", { writers: ["a", "b"], join: "b" }, 11],
    ["the first builder of a stale render may freeze past LAPSE_MS, then wake and write; the other edits", { writers: ["a", "b"], stale: true, freeze: true, edit: "build", ties: true }, 9],
    ["the first builder of a stale render goes to a background tab (its timers on whole minutes), its builds 8 s", { writers: ["a", "b"], stale: true, throttle: true, lengths: [8_000], ties: true }, 9],
    ["a person asks a writer for a rebuild of a built render, and either edits while it builds", { writers: ["a", "b"], built: true, force: "start", edit: "build" }, 12],
    ["builds fail and are retried until given up; a reader watches", { writers: ["a", "b"], readers: ["r"], atBound: true, fail: 5 }, 13],
    ["two writers on provider versions 1 and 2; version 1's builds fail", { writers: ["a", "b"], stale: true, versions: { a: 1, b: 2 }, failsV: 1 }, 8],
    ["two writers on provider versions 1 and 2; version 2's builds fail", { writers: ["a", "b"], stale: true, versions: { a: 1, b: 2 }, failsV: 2 }, 8],
    ["a stale pinned render a person rebuilds, whose build fails", { writers: ["a", "b"], stale: true, pinned: true, force: "start", fail: 1 }, 9],
    ["a stale render whose GLB never arrives", { writers: ["a", "b"], lostGLB: true }, 9],
    ["one message may be lost; either edits", { writers: ["a", "b"], lose: 1, edit: "build", ties: true }, 11],
    ["two messages may be lost, every other at the bound", { writers: ["a", "b"], atBound: true, lose: 2, edit: "build", ties: true }, 13],
    ["the writers can't hear each other, their changes still syncing; either edits", { writers: ["a", "b"], partition: true, edit: "build", ties: true }, 10, { crosses: true }],
    ["three writers", { writers: ["a", "b", "c"] }, 10],
  ];
  for (const [name, scenario, bound, { crosses = false } = {}] of scenarios) {
    it(`${name}: every run keeps the invariants`, async () => {
      const runs = await everyRun(scenario, bound);
      const bad = runs.flatMap(({ prefix, log }) => check(scenario, log).map((e) => `[${prefix.join("")}] ${e}`));
      expect(bad.slice(0, 5)).toEqual([]);
      expect(runs.length).toBeGreaterThan(crosses ? 8 : 4);
      if (crosses) expect(runs.filter(({ log }) => log.crossed > 0).length).toBeGreaterThan(0);
    }, 60_000);
  }
});
