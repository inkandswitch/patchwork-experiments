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
    { id: "select", activities: ["edit"] },
    { id: "outline", requires: ["sidebar"], activities: ["edit"] },
    { id: "sidebar", activities: ["edit"] },
    { id: "walk", activities: ["play"] },
    { id: "switch", always: true },
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
    local = createAtom({ activity: null, running: [] });
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
    expect(ids()).toEqual(["zones:objects", "select:general", "outline:general", "sidebar:general", "switch:general"]);
    release();
    await flush();
    expect(ids()).toEqual(["seats:scene", "zones:objects", "select:general", "outline:general", "sidebar:general", "switch:general"]);
    expect(host.instances().map((r) => r.id)).toEqual(["seats", "zones", "select", "outline", "sidebar", "switch"]);
    // started out of order
    expect(log.filter((l) => l.startsWith("create")).at(-1)).toBe("create:seats");
  });

  it("collects a field from every running extension, in running order", async () => {
    const { host } = make({ instances: { select: { commands: ["s"] }, switch: { commands: ["k"] }, outline: { panels: [1] } } });
    host.sync(doc());
    await flush();
    expect(host.collect("commands")).toEqual([
      { id: "select", value: ["s"] },
      { id: "switch", value: ["k"] },
    ]);
    expect(host.inputOf("select")).toBeUndefined();
    expect(host.instanceOf("nope")).toBeNull();
  });

  it("stops at once what this viewer's switch of activity leaves out: signal aborted, then release, then dispose", async () => {
    const { host } = make();
    host.sync(doc());
    await flush();
    log.length = 0;
    local.swap((m) => ({ ...m, activity: "play" }));
    host.sync(doc());
    expect(log.filter((l) => !l.startsWith("create"))).toEqual(["release:select:aborted", "dispose:select", "release:outline:aborted", "dispose:outline", "release:sidebar:aborted", "dispose:sidebar"]);
    await flush();
    expect(ids()).toEqual(["walk:general", "switch:general"]);
    expect(local.get().activities).toEqual({ current: "play", available: ["edit", "play"] });
  });

  it("joining starts this viewer where the doc says, and a later change to that doesn't move them", async () => {
    const { host } = make();
    host.sync(doc({ view: { activity: "play" } }));
    await flush();
    expect(local.get().activity).toBe("play");
    expect(local.get().activities.current).toBe("play");
    expect(ids()).toEqual(["walk:general", "switch:general"]);
    host.sync(doc({ view: { activity: "edit" } }));
    await flush();
    expect(local.get().activity).toBe("play");
    expect(ids()).toEqual(["walk:general", "switch:general"]);
  });

  it("no doc yet (no view): nothing is chosen for the viewer until there is one", async () => {
    const { host } = make();
    host.sync({});
    await flush();
    expect(local.get().activity).toBeNull();
    host.sync(doc());
    expect(local.get().activity).toBe("edit");
  });

  it("an activity the scene doesn't offer runs as edit, and the choice is kept for when it does", async () => {
    const play = metas.find((m) => m.id === "walk");
    play.traits = ["walkable"];
    try {
      const { host } = make();
      local.swap((m) => ({ ...m, activity: "play" }));
      host.sync(doc());
      await flush();
      expect(local.get().activities).toEqual({ current: "edit", available: ["edit"] });
      expect(ids()).toContain("select:general");
      // a trait arrives that offers play: this viewer was always going there
      host.sync(doc({ traits: { walkable: {} } }));
      await flush();
      expect(local.get().activities).toEqual({ current: "play", available: ["edit", "play"] });
      // the doc sent the editing parts away, so they linger as any would
      expect(host.lingering("select")).toBe(true);
      await timers.advance(LINGER_MS);
      expect(ids()).toEqual(["walk:scene", "switch:general"]);
    } finally {
      delete play.traits;
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

  it("keeps lingering while something it requires is busy (the hand carrying the table's card)", async () => {
    const seats = metas.find((m) => m.id === "seats");
    seats.requires = ["sidebar"];
    try {
      const { host } = make();
      host.sync(doc({ traits: { seats: {} } }));
      await flush();
      host.sync(doc());
      busy.add("sidebar");
      await timers.advance(LINGER_MS + BUSY_RECHECK_MS * 3);
      expect(log).not.toContain("dispose:seats");
      busy.delete("sidebar");
      await timers.advance(BUSY_RECHECK_MS);
      expect(log).toContain("dispose:seats");
    } finally {
      delete seats.requires;
    }
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
    metas.push({ id: "late", always: true });
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
    expect(log.filter((l) => l.startsWith("dispose"))).toEqual(["dispose:switch", "dispose:sidebar", "dispose:outline", "dispose:select"]);
  });
});
