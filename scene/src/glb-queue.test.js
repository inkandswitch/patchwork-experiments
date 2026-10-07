import { describe, it, expect } from "vitest";
import { createGLBQueue, QUEUE_LIMITS } from "./glb-queue.js";
import { FakeRepo, fakeTimers, flush } from "./test/fake-repo.js";
import { fileBytes } from "./file-content.js";

const bytes = (n) => new Uint8Array([n]);

/** find() calls that resolve only when the test says so. */
function gatedFinds(repo) {
  const waiting = [];
  const calls = [];
  return {
    calls,
    waiting,
    find(url) {
      calls.push(url);
      return new Promise((resolve, reject) => waiting.push({ url, go: () => repo.find(url).then(resolve, reject) }));
    },
    async release(n = Infinity) {
      for (let i = 0; i < n && waiting.length; i++) await waiting.shift().go();
      await flush();
    },
  };
}

function setup({ gated = true, parse } = {}) {
  const repo = new FakeRepo();
  const timers = fakeTimers();
  const gate = gatedFinds(repo);
  const parsed = [];
  const states = [];
  let parsing = 0;
  let maxParsing = 0;
  const queue = createGLBQueue({
    find: gated ? gate.find : (u) => repo.find(u),
    read: (h) => fileBytes(h.doc()),
    parse:
      parse ??
      (async (id, b) => {
        parsing++;
        maxParsing = Math.max(maxParsing, parsing);
        await Promise.resolve();
        parsing--;
        parsed.push([id, b[0]]);
      }),
    onState: (id, s) => states.push([id, s.phase]),
    timers,
    yieldToMain: () => Promise.resolve(),
  });
  const file = (n) => repo.add({ "@patchwork": { type: "file" }, name: `${n}.glb`, extension: "glb", content: bytes(n) });
  return { repo, timers, gate, queue, parsed, states, file, maxParsing: () => maxParsing };
}

describe("glb queue", () => {
  it("keeps at most 4 finds in flight and parses one at a time", async () => {
    const t = setup();
    const files = Array.from({ length: 10 }, (_, i) => t.file(i));
    files.forEach((f, i) => t.queue.ensure(`o${i}`, f.url, 0));
    await flush();
    expect(t.gate.calls.length).toBe(QUEUE_LIMITS.maxFinds);
    await t.gate.release(1);
    expect(t.gate.calls.length).toBe(5);
    while (t.gate.waiting.length) await t.gate.release();
    await flush();
    expect(t.parsed.length).toBe(10);
    expect(t.maxParsing()).toBe(1);
    expect(t.queue.stats().maxFindsInFlight).toBe(4);
    expect(t.queue.stats().maxParsesInFlight).toBe(1);
    expect(t.queue.pending()).toBe(0);
    expect(t.queue.state("o3").phase).toBe("ready");
  });

  it("takes the highest priority first, and a raised priority jumps the line", async () => {
    const t = setup();
    const files = Array.from({ length: 8 }, (_, i) => t.file(i));
    files.forEach((f, i) => t.queue.ensure(`o${i}`, f.url, i)); // o7 biggest
    await flush();
    // all ensured in one go: the four biggest start first, not the first four
    expect(t.gate.calls).toEqual([files[7].url, files[6].url, files[5].url, files[4].url]);
    t.queue.setPriority("o1", 100);
    await t.gate.release(1);
    expect(t.gate.calls.at(-1)).toBe(files[1].url);
  });

  it("fetches nothing it wasn't asked for, and forgets what's cancelled before it started", async () => {
    const t = setup();
    const a = t.file(1);
    const b = t.file(2);
    const c = t.file(3);
    const d = t.file(4);
    const e = t.file(5);
    for (const [i, f] of [a, b, c, d, e].entries()) t.queue.ensure(`o${i}`, f.url);
    await flush();
    expect(t.queue.cancel("o4")).toBe(true); // still queued: gone
    expect(t.queue.cancel("o0")).toBe(false); // already finding: finishes
    while (t.gate.waiting.length) await t.gate.release();
    expect(t.gate.calls).not.toContain(e.url);
    expect(t.queue.has("o4")).toBe(false);
  });

  it("retries a failed find with backoff (1 s doubling, capped at 30 s)", async () => {
    const t = setup({ gated: false });
    t.queue.ensure("o", "automerge:missing");
    await flush();
    expect(t.queue.state("o").phase).toBe("error");
    expect(t.timers.pendingDelays()).toEqual([1000]);
    await t.timers.advance(1000);
    expect(t.timers.pendingDelays()).toEqual([2000]);
    for (let i = 0; i < 8; i++) await t.timers.advance(t.timers.pendingDelays()[0]);
    expect(t.timers.pendingDelays()).toEqual([30000]);
    // it appears
    t.repo.add({ "@patchwork": { type: "file" }, content: bytes(9) }, "automerge:missing");
    await t.timers.advance(30000);
    expect(t.queue.state("o").phase).toBe("ready");
    expect(t.parsed).toEqual([["o", 9]]);
  });

  it("subscribes to the source only once loaded, re-parses on change, unsubscribes on remove", async () => {
    const t = setup();
    const f = t.file(1);
    t.queue.ensure("o", f.url);
    await flush();
    expect(f.listenerCount("change")).toBe(0); // finding: not subscribed yet
    await t.gate.release();
    expect(t.queue.state("o").phase).toBe("ready");
    expect(f.listenerCount("change")).toBe(1);
    expect(t.queue.subscriptions()).toBe(1);
    f.change((d) => (d.content = bytes(2)));
    await flush();
    expect(t.parsed).toEqual([["o", 1], ["o", 2]]);
    t.queue.remove("o");
    expect(f.listenerCount("change")).toBe(0);
    expect(t.queue.subscriptions()).toBe(0);
  });

  it("reports a parse failure without retrying, and a new url starts over", async () => {
    const t = setup({
      gated: false,
      parse: async (id, b) => {
        if (b[0] === 1) throw new Error("not a GLB");
      },
    });
    const bad = t.file(1);
    const good = t.file(2);
    t.queue.ensure("o", bad.url);
    await flush();
    expect(t.queue.state("o")).toMatchObject({ phase: "error", error: "not a GLB" });
    expect(t.timers.pendingDelays()).toEqual([]);
    t.queue.ensure("o", good.url);
    await flush();
    expect(t.queue.state("o").phase).toBe("ready");
    expect(bad.listenerCount("change")).toBe(0);
  });

  it("dispose drops every subscription", async () => {
    const t = setup({ gated: false });
    const fs = [t.file(1), t.file(2)];
    fs.forEach((f, i) => t.queue.ensure(`o${i}`, f.url));
    await flush();
    t.queue.dispose();
    for (const f of fs) expect(f.listenerCount("change")).toBe(0);
  });
});
