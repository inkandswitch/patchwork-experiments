import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAtom } from "./atom.js";
import { createHost, mergeOrder, LINGER_MS, BUSY_RECHECK_MS } from "./host.js";
import { fakeTimers, flush } from "../test/fake-repo.js";
import { PACKAGE_FIND_MS } from "./packages.js";
import { PluginRegistry } from "@inkandswitch/patchwork-plugins";

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
    { id: "solo", traits: ["solo"] },
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
    const { host } = make({ delays: { solo: slow } });
    host.sync(doc({ traits: { solo: {} }, objects: { c: { traits: { zone: {} } } } }));
    await flush();
    // solo is still loading: nothing after it is made yet (a provider is up before what asks for it)
    expect(ids()).toEqual([]);
    release();
    await flush();
    expect(ids()).toEqual(["solo:scene", "select:scene", "outline:scene", "inspector:scene", "clock:scene", "zones:objects"]);
    expect(host.instances().map((r) => r.id)).toEqual(["solo", "select", "outline", "inspector", "clock", "zones"]);
    expect(log.filter((l) => l.startsWith("create"))).toEqual(["solo", "select", "outline", "inspector", "clock", "zones"].map((id) => `create:${id}`));
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
    host.sync(doc({ traits: { solo: {} } }));
    await flush();
    log.length = 0;
    const i = metas.findIndex((m) => m.id === "inspector");
    const [gone] = metas.splice(i, 1);
    try {
      reg.changed();
      expect(log).toEqual(["release:inspector:aborted", "dispose:inspector"]);
      host.sync(doc());
      expect(host.lingering("solo")).toBe(true);
      expect(log).not.toContain("dispose:solo");
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

  // Providers first, by construction: every registration order of two
  // providers (B uses A's service at create) and two consumers (each uses
  // one at create) runs A, B, then the consumers in registry order, and
  // every create finds its service. A service an instance offers but its
  // metadata doesn't declare is never handed out.
  it("over every registration order of {A, B uses A, C uses A, D uses B}: providers first, every create's use finds its service", async () => {
    const ms = [
      { id: "A", traits: ["*"], provides: ["a"] },
      { id: "B", traits: ["*"], provides: ["b"], uses: ["a"] },
      { id: "C", traits: ["*"] },
      { id: "D", traits: ["*"] },
    ];
    const needs = { B: "a", C: "a", D: "b" };
    const perms = (xs) => (xs.length ? xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])) : [[]]);
    let n = 0;
    for (const order of perms(ms)) {
      const found = {};
      let host;
      const mods = Object.fromEntries(
        ms.map((m) => [m.id, { create: (api) => ((found[m.id] = needs[m.id] ? api.use(needs[m.id]) : "-"), { provides: { [m.provides?.[0] ?? "z"]: (c) => ({ by: m.id, for: c.id }) } }) }]),
      );
      host = createHost({ registry: async () => registry(order, mods), makeApi: (rec) => ({ api: { use: (k) => host.use(k, rec) }, release: () => {} }) });
      host.sync(doc());
      await flush();
      const ran = host.running().map((r) => r.id);
      const where = order.map((m) => m.id).join("");
      expect(ran, where).toEqual(["A", "B", ...order.map((m) => m.id).filter((id) => "CD".includes(id))]);
      expect(found, where).toEqual({ A: "-", B: { by: "A", for: "B" }, C: { by: "A", for: "C" }, D: { by: "B", for: "D" } });
      expect(host.use("z", { id: "x" }), where).toBeNull(); // C's and D's, undeclared
      host.dispose();
      n++;
    }
    expect(n).toBe(24);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("“C”: its metadata and instance differ on providing “z”"));
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
    const one = [{ id: "solo", traits: ["solo"] }];
    for (const seq of seqs) {
      log = [];
      timers = quickTimers();
      local = createAtom({ running: [] });
      busy = new Set();
      const reg = registry(one, { solo: mod("solo", log) });
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
      const lines = (k) => log.filter((l) => l === `${k}:solo`).length;
      host.sync(doc({ traits: { solo: {} } }));
      await settle();
      for (const e of seq) {
        const stoppedBefore = lines("dispose");
        if (e === "want" || e === "unwant") {
          if (wanted !== (e === "want")) since = e === "unwant" ? t : null;
          wanted = e === "want";
          host.sync(doc(wanted ? { traits: { solo: {} } } : {}));
          await settle();
        } else if (e === "busy") busy.add("solo");
        else if (e === "idle") busy.delete("solo");
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
          expect(busy.has("solo"), where).toBe(false);
          expect(t - since, where).toBeGreaterThanOrEqual(LINGER_MS);
        }
        if (!wanted && !busy.has("solo") && since != null && t - since >= LINGER_MS + BUSY_RECHECK_MS && e !== "idle") {
          // (idle just now: its recheck is still to come)
          expect(running, where).toBe(false);
        }
      }
      host.dispose();
    }
  }, 120_000);
});

describe("a provider whose module never arrives", () => {
  it("counts as failed after the packages' load timeout: what waits on it starts, and finds no service", async () => {
    const [t, log, metas] = [quickTimers(), [], [{ id: "svc", traits: ["*"], provides: ["svc"] }, { id: "user", traits: ["*"] }]];
    let got;
    const mods = { svc: mod("svc", log, { provides: { svc: () => ({}) } }), user: mod("user", log, (api) => ((got = api.use("svc")), {})) };
    const host = createHost({ registry: () => registry(metas, mods, { svc: new Promise(() => {}) }), makeApi: (rec) => ({ api: { use: (n) => host.use(n, rec) }, release() {} }), setTimer: t.setTimeout, clearTimer: t.clearTimeout });
    host.sync({});
    await settle();
    await t.advance(PACKAGE_FIND_MS - 1);
    expect(log).toEqual([]);
    await t.advance(1);
    expect([log, got, host.failed()]).toEqual([["create:user"], null, ["svc"]]);
    await host.providersStarted();
  });
});

describe("a package loaded at an old version first (the module watcher registers it again at each version it loads)", () => {
  // A package published against an older kernel: its create watches
  // `api.presence`, which the kernel doesn't have. A view that loaded that
  // copy from its cache before a sync brought the new one fails to start it
  // (TypeError: … reading 'watch').
  const oldModule = { create: (api) => (api.presence.watch(() => {}), {}) };
  const newModule = (log) => mod("solo", log, (api) => (api.channel.watch(() => {}), {}));
  const OLD = "automerge:pkg#old";
  const NEW = "automerge:pkg#new";
  function make(log) {
    const metas = [{ id: "solo", traits: ["solo"], importUrl: OLD }];
    const mods = { solo: oldModule };
    const reg = registry(metas, mods);
    const host = createHost({ registry: async () => reg, makeApi: () => ({ api: { channel: Object.freeze({ watch: () => () => {} }) }, release() {} }) });
    const reregister = (importUrl, module) => {
      metas[0] = { ...metas[0], importUrl };
      mods.solo = module;
      reg.changed();
    };
    return { host, reregister };
  }
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("fails to start as it did, then starts once its plugin is registered from the new version", async () => {
    const log = [];
    const { host, reregister } = make(log);
    host.sync({ traits: { solo: {} } });
    await flush();
    expect(host.failed()).toEqual(["solo"]);
    expect(String(console.warn.mock.calls.find((c) => /failed to start/.test(c[0]))?.[1])).toMatch(/TypeError: .*reading 'watch'/);
    reregister(NEW, newModule(log));
    await flush();
    expect([host.failed(), host.instances().map((r) => r.id), log]).toEqual([[], ["solo"], ["create:solo"]]);
  });

  it("a failed one isn't tried again for anything but a new registration: a doc change, or the same one again, leaves it failed", async () => {
    const log = [];
    const { host, reregister } = make(log);
    host.sync({ traits: { solo: {} } });
    await flush();
    host.sync({ traits: { solo: {} }, title: "changed" });
    reregister(OLD, oldModule);
    await flush();
    expect([host.failed(), console.warn.mock.calls.filter((c) => /failed to start/.test(c[0])).length]).toEqual([["solo"], 1]);
  });
});

describe("a plugin registered again while it loads (Patchwork's own registry)", () => {
  // Two installed packages registering one plugin id (a retired package and
  // the one that took its plugin over). The registry's load(id) resolves to
  // nothing when the id is registered again mid-load: that is not the
  // plugin's own failure.
  const OLD = "automerge:pkg-old#retired";
  const NEW = "automerge:pkg-new#1";
  const NEWER = "automerge:pkg-new#2";
  function make() {
    const reg = new PluginRegistry();
    const log = [];
    const imports = new Map(); // importUrl → each registration's import, to settle
    const register = (importUrl, module = mod(`t.shared@${importUrl.split(":")[1]}`, log)) => {
      let resolve;
      const loaded = new Promise((r) => (resolve = r));
      imports.set(importUrl, [...(imports.get(importUrl) ?? []), () => resolve(module)]);
      reg.register({ type: "scene:extension", id: "t.shared", name: "Shared", traits: ["t.shared"], load: () => loaded }, importUrl);
    };
    const host = createHost({ registry: async () => reg, makeApi: () => ({ api: {}, release() {} }) });
    const arrive = async (importUrl) => (imports.get(importUrl).forEach((settle) => settle()), flush());
    return { host, log, register, arrive };
  }
  const failures = () => console.warn.mock.calls.filter((c) => /failed to start/.test(c[0])).map((c) => String(c[1]));
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  const throws = { create: () => { throw new TypeError("written against another kernel"); } };
  // [what, steps, failures, what was created]; a step registers, syncs the doc, flushes, or settles one import
  const ROWS = [
    ["another package's mid-load, the old import settling after", [["register", OLD], "sync", ["register", NEW], ["arrive", OLD], "starting", ["arrive", NEW]], 0, ["create:t.shared@pkg-new#1"]],
    ["another package's mid-load, the old import settling last", [["register", OLD], "sync", ["register", NEW], ["arrive", NEW], ["arrive", OLD]], 0, ["create:t.shared@pkg-new#1"]],
    ["failed, restarted for a new registration, and that load overtaken again", [["register", OLD, throws], "sync", ["arrive", OLD], "failed", ["register", NEW], "flush", ["register", NEWER], ["arrive", NEW], ["arrive", NEWER]], 1, ["create:t.shared@pkg-new#2"]],
    ["the same source again mid-load", [["register", NEW], "sync", ["register", NEW, "again"], ["arrive", NEW]], 0, ["create:t.shared@again"]],
  ];
  it("the newest registration starts and nothing else fails: another package's or the same one's, its old import settling first or last, fresh or after a failure", async () => {
    for (const [what, steps, failed, created] of ROWS) {
      console.warn.mockClear();
      const { host, log, register, arrive } = make();
      for (const step of steps) {
        if (step === "sync") host.sync({ traits: { "t.shared": {} } }), await flush();
        else if (step === "flush") await flush();
        // (mid-way: still starting, nothing failed; or the plugin's own failure, failed)
        else if (step === "starting") expect([what, failures(), host.failed(), host.starting()]).toEqual([what, [], [], true]);
        else if (step === "failed") expect([what, host.failed()]).toEqual([what, ["t.shared"]]);
        else if (step[0] === "register") register(step[1], step[2] === "again" ? mod("t.shared@again", log) : step[2]);
        else await arrive(step[1]);
      }
      expect([what, failures().length, host.failed(), host.instances().map((r) => r.id), log]).toEqual([what, failed, [], ["t.shared"], created]);
    }
  });
});
