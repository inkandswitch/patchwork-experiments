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
    { id: "select" },
    { id: "outline" },
    { id: "inspector" },
    { id: "clock" },
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
      makeDropContext: (id) => ({ ctxFor: id }),
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

  it("publishes local.running in running order, never in the order they finished loading", async () => {
    let release;
    const slow = new Promise((r) => (release = r));
    const { host } = make({ delays: { seats: slow } });
    host.sync(doc({ traits: { seats: {} }, objects: { c: { traits: { zone: {} } } } }));
    await flush();
    // seats is still loading: everything else is running, in its place
    expect(ids()).toEqual(["zones:objects", "select:general", "outline:general", "inspector:general", "clock:general"]);
    release();
    await flush();
    expect(ids()).toEqual(["seats:scene", "zones:objects", "select:general", "outline:general", "inspector:general", "clock:general"]);
    expect(host.instances().map((r) => r.id)).toEqual(["seats", "zones", "select", "outline", "inspector", "clock"]);
    // started out of order
    expect(log.filter((l) => l.startsWith("create")).at(-1)).toBe("create:seats");
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

  it("what runs is the doc's: the same doc runs the same set, whatever local holds (H1)", async () => {
    const { host } = make();
    host.sync(doc({ view: { start: { body: "walk" } } }));
    await flush();
    const before = ids();
    log.length = 0;
    local.swap((m) => ({ ...m, body: { id: "walk" }, held: { name: "Gun" }, selected: "c", prefs: { grid: false }, clock: { running: false } }));
    host.sync(doc({ view: { start: { body: "walk" } } }));
    await flush();
    expect(ids()).toEqual(before);
    expect(log).toEqual([]);
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

  it("keeps what the doc stopped calling for running 2 s, and while it's busy", async () => {
    const { host } = make();
    host.sync(doc({ traits: { seats: {} } }));
    await flush();
    expect(ids()[0]).toBe("seats:scene");
    // a peer's undo takes the trait away
    host.sync(doc());
    expect(host.lingering("seats")).toBe(true);
    expect(ids()[0]).toBe("seats:scene"); // still running, in its place
    busy.add("seats");
    await timers.advance(LINGER_MS);
    expect(log).not.toContain("dispose:seats");
    await timers.advance(BUSY_RECHECK_MS * 3);
    expect(log).not.toContain("dispose:seats");
    busy.delete("seats");
    await timers.advance(BUSY_RECHECK_MS);
    expect(log).toContain("dispose:seats");
    expect(ids()).not.toContain("seats:scene");
  });

  it("cancels the linger when the doc calls for it again", async () => {
    const { host } = make();
    host.sync(doc({ traits: { seats: {} } }));
    await flush();
    host.sync(doc());
    await timers.advance(LINGER_MS / 2);
    host.sync(doc({ traits: { seats: {} } }));
    await timers.advance(LINGER_MS * 2);
    expect(log).not.toContain("dispose:seats");
    expect(log.filter((l) => l === "create:seats")).toHaveLength(1);
  });

  it("drop: loads only the modules that take the datatype, without running them", async () => {
    const drop = vi.fn(async (ctx, info) => info.doc["@patchwork"].type === "deck-doc");
    const { host } = make({ mods: { deck: { create: () => ({}), drop } } });
    host.sync(doc());
    await flush();
    expect(await host.drop({ url: "u", doc: { "@patchwork": { type: "other" } } })).toBe(false);
    expect(drop).not.toHaveBeenCalled();
    expect(await host.drop({ url: "u", doc: { "@patchwork": { type: "deck-doc" } } })).toBe(true);
    expect(drop.mock.calls[0][0]).toEqual({ ctxFor: "deck" });
    expect(ids().some((x) => x.startsWith("deck"))).toBe(false);
  });

  it("starts what a registry change installs", async () => {
    const { host, reg } = make({ mods: { late: mod("late", log) } });
    host.sync(doc());
    await flush();
    metas.push({ id: "late" });
    try {
      reg.changed();
      await flush();
      expect(ids()).toContain("late:general");
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
    expect(ids()).not.toContain("select:general");
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
    // (promises only: the host and these timers need no macrotask, so each sequence is quick)
    const settle = async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    };
    const quickTimers = () => {
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
    };
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
      const flush = settle;
      let t = 0;
      let wanted = true;
      let since = null; // when the doc last stopped calling
      const lines = (k) => log.filter((l) => l === `${k}:seats`).length;
      host.sync(doc({ traits: { seats: {} } }));
      await flush();
      for (const e of seq) {
        const stoppedBefore = lines("dispose");
        if (e === "want" || e === "unwant") {
          if (wanted !== (e === "want")) since = e === "unwant" ? t : null;
          wanted = e === "want";
          host.sync(doc(wanted ? { traits: { seats: {} } } : {}));
          await flush();
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

  // The view's move (setGeneral): H2's busy half. One general extension, the
  // focus moving in and out, busy or not, over every sequence of up to four
  // events (in, out, busy, idle, wait BUSY_RECHECK_MS): 781 sequences. After
  // every event: in ⇒ running and offering, and started only if it wasn't
  // running (back before it stopped, it's kept); out ⇒ offering nothing; it
  // stops only while out and not busy, at once on going out idle, else at
  // the recheck after it lets go. At most one instance at a time.
  it("the view's move: over every order of ≤4 of in, out, busy, idle and a recheck, a general part stops only out and idle, and offers only in", async () => {
    const EVENTS = ["in", "out", "busy", "idle", "recheck"];
    const seqs = [[]];
    for (let n = 1; n <= 4; n++) for (const s0 of seqs.filter((q) => q.length === n - 1)) for (const e of EVENTS) seqs.push([...s0, e]);
    expect(seqs.length).toBe(781);
    const settle = async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    };
    const quickTimers = () => {
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
    };
    const one = [{ id: "walk" }];
    for (const seq of seqs) {
      log = [];
      timers = quickTimers();
      local = createAtom({ running: [] });
      busy = new Set();
      const reg = registry(one, { walk: mod("walk", log, { bodies: ["walk"] }) });
      const host = createHost({
        registry: async () => reg,
        local,
        makeApi: (rec) => ({ api: { id: rec.id, signal: rec.signal }, release: () => {} }),
        busy: (id) => busy.has(id),
        setTimer: timers.setTimeout,
        clearTimer: timers.clearTimeout,
      });
      const lines = (k) => log.filter((l) => l === `${k}:walk`).length;
      host.sync(doc());
      await settle();
      let atFocus = true;
      let due = false; // out and idle, and its moment to stop has come
      for (const e of seq) {
        const where = seq.join(",") || "(none)";
        const was = { creates: lines("create"), disposes: lines("dispose"), running: lines("create") > lines("dispose") };
        const moved = (e === "in") !== atFocus && (e === "in" || e === "out");
        if (e === "in" || e === "out") {
          atFocus = e === "in";
          host.setGeneral(atFocus);
          await settle();
        } else if (e === "busy") busy.add("walk");
        else if (e === "idle") busy.delete("walk");
        else await timers.advance(BUSY_RECHECK_MS);
        const free = !atFocus && !busy.has("walk");
        if (!free) due = false;
        // (out again while out is no move: the view says so on every relink)
        else if ((e === "out" && moved) || e === "recheck") due = true;
        const running = lines("create") > lines("dispose");
        expect(lines("create") - lines("dispose"), where).toBeLessThanOrEqual(1);
        if (atFocus) {
          expect([where, running, host.collect("bodies").length, host.offering().length]).toEqual([where, true, 1, 1]);
          // started only if it had stopped
          expect(lines("create") - was.creates, where).toBe(was.running ? 0 : 1);
        } else expect([where, host.collect("bodies").length, host.offering().length]).toEqual([where, 0, 0]);
        if (lines("dispose") > was.disposes) expect([where, atFocus, busy.has("walk")]).toEqual([where, false, false]);
        if (due) expect([where, running]).toEqual([where, false]);
      }
      host.dispose();
    }
  }, 120_000);
});
