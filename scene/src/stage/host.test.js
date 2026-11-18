import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAtom } from "./atom.js";
import { createHost, mergeOrder, LINGER_MS, BUSY_RECHECK_MS } from "./host.js";
import { fakeTimers, flush } from "../test/fake-repo.js";

// A registry of plugin metadata whose modules come from `mods` (id → module),
// with a per-id load delay so start order can differ from running order.
function registry(metas, mods, delays = {}) {
  const listeners = new Set();
  return {
    filter: (fn) => metas.filter(fn),
    has: (id) => metas.some((m) => m.id === id),
    async load(id) {
      const m = metas.find((x) => x.id === id);
      if (!m) return undefined;
      if (delays[id]) await delays[id];
      return { ...m, module: mods[id] };
    },
    on(ev, fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    changed: () => listeners.forEach((fn) => fn()),
  };
}

/** A module whose instances log what happens to them. */
function mod(id, log, instance = {}) {
  return {
    create(api) {
      log.push(`create:${id}`);
      return {
        dispose: () => log.push(`dispose:${id}`),
        ...(typeof instance === "function" ? instance(api) : instance),
      };
    },
  };
}

// For the exhaustive runs (H2, the view's move): promises only, as the host
// and these timers need no macrotask, so each sequence is quick.
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function quickTimers() {
  let now = 0;
  let n = 0;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => (pending.set(++n, { fn, at: now + ms }), n),
    clearTimeout: (k) => pending.delete(k),
    async advance(ms) {
      now += ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, p]) => p.at <= now).sort((x, y) => x[1].at - y[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        due[1].fn();
        await settle();
      }
    },
  };
}

describe("mergeOrder", () => {
  it("keeps a lingering id just after what preceded it", () => {
    expect(mergeOrder(["a", "b", "c"], ["a", "c"], new Set(["b"]))).toEqual(["a", "b", "c"]);
    expect(mergeOrder(["b", "a"], ["a"], new Set(["b"]))).toEqual(["b", "a"]);
    expect(mergeOrder(["a", "b"], ["c"], new Set(["b"]))).toEqual(["b", "c"]);
    expect(mergeOrder(["a", "b"], ["a"], new Set())).toEqual(["a"]);
  });
});

describe("the host", () => {
  let log, timers, local, busy;
  const metas = [
    { id: "seats", traits: ["seats"] },
    { id: "zones", traits: ["zone"] },
    { id: "select", traits: ["*"] },
    { id: "outline", traits: ["*"] },
    { id: "inspector", traits: ["*"] },
    { id: "clock", traits: ["*"] },
    { id: "deck", traits: ["deck"], drops: ["deck-doc"] },
  ];

  function make({ delays = {}, instances = {}, mods = {} } = {}) {
    const all = {};
    for (const m of metas) all[m.id] = mods[m.id] ?? mod(m.id, log, instances[m.id]);
    for (const [k, v] of Object.entries(mods)) all[k] = v;
    const reg = registry(metas, all, delays);
    const releases = [];
    const host = createHost({
      registry: async () => reg,
      local,
      makeApi: (rec) => ({
        api: { id: rec.id, signal: rec.signal },
        release: () => {
          releases.push(rec.id);
          log.push(`release:${rec.id}:${rec.signal.aborted ? "aborted" : "live"}`);
        },
      }),
      busy: (id) => busy.has(id),
      setTimer: timers.setTimeout,
      clearTimer: timers.clearTimeout,
    });
    return { host, reg, releases };
  }

  beforeEach(() => {
    log = [];
    timers = fakeTimers();
    local = createAtom({ running: [] });
    busy = new Set();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const doc = (extra = {}) => ({ objects: {}, view: {}, ...extra });
  const ids = () => local.get().running.map((r) => `${r.id}:${r.scope}`);

  it("makes them in running order, never in the order they finished loading, and publishes local.running so", async () => {
    let release;
    const slow = new Promise((r) => (release = r));
    const { host } = make({ delays: { seats: slow } });
    host.sync(doc({ traits: { seats: {} }, objects: { c: { traits: { zone: {} } } } }));
    await flush();
    // seats is still loading: nothing after it is made yet (a provider is up before what asks for it)
    expect(ids()).toEqual([]);
    release();
    await flush();
    expect(ids()).toEqual(["seats:scene", "select:scene", "outline:scene", "inspector:scene", "clock:scene", "zones:objects"]);
    expect(host.instances().map((r) => r.id)).toEqual(["seats", "select", "outline", "inspector", "clock", "zones"]);
    expect(log.filter((l) => l.startsWith("create"))).toEqual(["seats", "select", "outline", "inspector", "clock", "zones"].map((id) => `create:${id}`));
  });

  it("collects a field from every running extension, in running order", async () => {
    const { host } = make({ instances: { select: { commands: ["s"] }, clock: { commands: ["k"] }, outline: { tab: 1 } } });
    host.sync(doc());
    await flush();
    expect(host.collect("commands")).toEqual([
      { id: "select", value: ["s"] },
      { id: "clock", value: ["k"] },
    ]);
    expect(host.inputOf("select")).toBeUndefined();
    expect(host.instanceOf("nope")).toBeNull();
  });

  it("an extension whose plugin leaves the registry stops at once (no code to come back to); one the doc sends away lingers", async () => {
    const { host, reg } = make();
    host.sync(doc({ traits: { seats: {} } }));
    await flush();
    log.length = 0;
    const i = metas.findIndex((m) => m.id === "inspector");
    const [gone] = metas.splice(i, 1);
    try {
      reg.changed();
      expect(log).toEqual(["release:inspector:aborted", "dispose:inspector"]);
      host.sync(doc());
      expect(host.lingering("seats")).toBe(true);
      expect(log).not.toContain("dispose:seats");
    } finally {
      metas.splice(i, 0, gone);
    }
  });

  it("starts what a registry change installs", async () => {
    const { host, reg } = make({ mods: { late: mod("late", log) } });
    host.sync(doc());
    await flush();
    metas.push({ id: "late", traits: ["*"] });
    try {
      reg.changed();
      await flush();
      expect(ids()).toContain("late:scene");
    } finally {
      metas.pop();
    }
  });

  it("a create that throws doesn't run, and its api is released", async () => {
    const { host, releases } = make({
      mods: {
        select: {
          create() {
            throw new Error("boom");
          },
        },
      },
    });
    host.sync(doc());
    await flush();
    expect(ids()).not.toContain("select:scene");
    expect(releases).toContain("select");
  });

  it("dispose stops everything, last first", async () => {
    const { host } = make();
    host.sync(doc());
    await flush();
    log.length = 0;
    host.dispose();
    expect(log.filter((l) => l.startsWith("dispose"))).toEqual(["dispose:clock", "dispose:inspector", "dispose:outline", "dispose:select"]);
  });

  // H2: one stop rule. One extension, the doc calling for it or not, busy or
  // not, over every sequence of up to four events (want, unwant, busy, idle,
  // wait LINGER_MS, wait BUSY_RECHECK_MS): 1,555 sequences. After every
  // event: wanted ⇒ running; it stops only when the doc doesn't call for it,
  // at least LINGER_MS after the doc stopped calling, and not while busy; and
  // not wanted, not busy, a LINGER_MS and a recheck on ⇒ stopped. At most
  // one instance at a time.
  it("H2: over every order of ≤4 of want, unwant, busy, idle and two waits, it stops only by the one rule", async () => {
    const EVENTS = ["want", "unwant", "busy", "idle", "linger", "recheck"];
    const seqs = [[]];
    for (let n = 1; n <= 4; n++) for (const s0 of seqs.filter((q) => q.length === n - 1)) for (const e of EVENTS) seqs.push([...s0, e]);
    expect(seqs.length).toBe(1555);
    const one = [{ id: "seats", traits: ["seats"] }];
    for (const seq of seqs) {
      log = [];
      timers = quickTimers();
      local = createAtom({ running: [] });
      busy = new Set();
      const reg = registry(one, { seats: mod("seats", log) });
      const host = createHost({
        registry: async () => reg,
        local,
        makeApi: (rec) => ({ api: { id: rec.id, signal: rec.signal }, release: () => {} }),
        busy: (id) => busy.has(id),
        setTimer: timers.setTimeout,
        clearTimer: timers.clearTimeout,
      });
      let t = 0;
      let wanted = true;
      let since = null; // when the doc last stopped calling
      const lines = (k) => log.filter((l) => l === `${k}:seats`).length;
      host.sync(doc({ traits: { seats: {} } }));
      await settle();
      for (const e of seq) {
        const stoppedBefore = lines("dispose");
        if (e === "want" || e === "unwant") {
          if (wanted !== (e === "want")) since = e === "unwant" ? t : null;
          wanted = e === "want";
          host.sync(doc(wanted ? { traits: { seats: {} } } : {}));
          await settle();
        } else if (e === "busy") busy.add("seats");
        else if (e === "idle") busy.delete("seats");
        else {
          const ms = e === "linger" ? LINGER_MS : BUSY_RECHECK_MS;
          await timers.advance(ms);
          t += ms;
        }
        const running = lines("create") > lines("dispose");
        const where = seq.join(",");
        expect(lines("create") - lines("dispose"), where).toBeLessThanOrEqual(1);
        if (wanted) expect(running, where).toBe(true);
        if (lines("dispose") > stoppedBefore) {
          expect(wanted, where).toBe(false);
          expect(busy.has("seats"), where).toBe(false);
          expect(t - since, where).toBeGreaterThanOrEqual(LINGER_MS);
        }
        if (!wanted && !busy.has("seats") && since != null && t - since >= LINGER_MS + BUSY_RECHECK_MS && e !== "idle") {
          // (idle just now: its recheck is still to come)
          expect(running, where).toBe(false);
        }
      }
      host.dispose();
    }
  }, 120_000);
});
