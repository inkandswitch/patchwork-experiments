import { describe, it, expect, vi } from "vitest";
import { FakeRepo, fakeTimers, flush } from "./test/fake-repo.js";
import { createDependencyWatcher } from "./deps.js";
import { dependenciesOf } from "./build.js";

describe("dependency watcher", () => {
  it("subscribes to exactly the listed docs and reports their heads", async () => {
    const repo = new FakeRepo();
    const timers = fakeTimers();
    const a = repo.add({ n: 1 });
    const b = repo.add({ n: 2 });
    const onChange = vi.fn();
    const w = createDependencyWatcher({ repo, onChange, timers, now: timers.now });
    expect(w.set([a.url, b.url])).toBe(true);
    expect(w.snapshot()).toEqual({ [a.url]: [], [b.url]: [] }); // not loaded yet
    expect(w.pendingSince()).toBe(0);
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

  it("retries a doc it can't load, with backoff, without counting it as pending", async () => {
    const repo = new FakeRepo();
    const timers = fakeTimers();
    const onChange = vi.fn();
    const w = createDependencyWatcher({ repo, onChange, timers, now: timers.now });
    w.set(["automerge:later"]);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(w.pendingSince()).toBeNull();
    expect(timers.pendingDelays()).toEqual([1000]);
    await timers.advance(1000);
    expect(timers.pendingDelays()).toEqual([2000]);
    const h = repo.add({ n: 1 }, "automerge:later");
    await timers.advance(2000);
    expect(w.snapshot()).toEqual({ "automerge:later": h.heads() });
    expect(timers.pendingDelays()).toEqual([]);
    w.set([]);
    expect(h.listenerCount("change")).toBe(0);
  });

  it("dropping a doc mid-retry cancels the retry", async () => {
    const repo = new FakeRepo();
    const timers = fakeTimers();
    const w = createDependencyWatcher({ repo, onChange: () => {}, timers, now: timers.now });
    w.set(["automerge:gone"]);
    await flush();
    w.set([]);
    expect(timers.pendingDelays()).toEqual([]);
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
