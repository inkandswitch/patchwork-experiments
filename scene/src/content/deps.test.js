import { describe, it, expect, vi } from "vitest";
import { FakeRepo, flush } from "../test/fake-repo.js";
import { createDependencyWatcher } from "./deps.js";
import { dependenciesOf } from "./build.js";
import { manualTime } from "../stage/time.js";

const stepped = () => manualTime({ frameMs: 50, yieldTo: () => new Promise((r) => setImmediate(r)) });

describe("dependency watcher", () => {
  it("subscribes to exactly the listed docs and reports their heads", async () => {
    const repo = new FakeRepo();
    const time = stepped();
    const a = repo.add({ n: 1 });
    const b = repo.add({ n: 2 });
    const onChange = vi.fn();
    const w = createDependencyWatcher({ repo, time, onChange });
    expect(w.set([a.url, b.url])).toBe(true);
    expect(w.snapshot()).toEqual({ [a.url]: [], [b.url]: [] }); // not loaded yet
    expect(w.pendingSince()).toBe(time.now());
    await flush();
    expect(w.pendingSince()).toBeNull();
    expect(w.snapshot()).toEqual({ [a.url]: a.heads(), [b.url]: b.heads() });
    expect(onChange).toHaveBeenCalledTimes(2);
    a.change((d) => (d.n = 3));
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(w.set([b.url, a.url])).toBe(false);
    expect(w.set([b.url])).toBe(true);
    expect(a.listenerCount("change")).toBe(0);
    expect(b.listenerCount("change")).toBe(1);
    w.dispose();
    expect(b.listenerCount("change")).toBe(0);
  });

  it("retries a doc it can't load, not counting it as pending, and picks it up when it appears; dropped, it stops", async () => {
    const repo = new FakeRepo();
    const time = stepped();
    const onChange = vi.fn();
    const w = createDependencyWatcher({ repo, time, onChange });
    w.set(["automerge:later"]);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(w.pendingSince()).toBeNull();
    expect(w.failed("automerge:later")).toBe(true);
    await time.advance(3000);
    const h = repo.add({ n: 1 }, "automerge:later");
    await time.advance(30_000);
    expect(w.snapshot()).toEqual({ "automerge:later": h.heads() });
    w.set([]);
    expect(h.listenerCount("change")).toBe(0);
    w.set(["automerge:gone"]);
    await flush();
    w.set([]);
    expect(time.pending().timers).toBe(0);
  });
});

describe("dependenciesOf", () => {
  it("dedupes, sorts, drops junk and the source itself", () => {
    const impl = { dependencies: () => ["automerge:b", "automerge:a", "automerge:b", "", null, 3, "automerge:self"] };
    expect(dependenciesOf(impl, {}, "automerge:self")).toEqual(["automerge:a", "automerge:b"]);
    expect(dependenciesOf({}, {})).toEqual([]);
    expect(dependenciesOf({ dependencies: () => "automerge:x" }, {})).toEqual([]);
    expect(dependenciesOf(impl, null)).toEqual([]);
  });
});
