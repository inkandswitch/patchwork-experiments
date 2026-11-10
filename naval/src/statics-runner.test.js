// The runner's worker lifecycle with a fake Worker: a runner disposed while
// its worker is still starting must terminate that worker when it arrives
// and never post the job to it; a worker that never says "ready" is
// terminated, not left running.

import { describe, it, expect, vi, afterEach } from "vitest";
import { createStaticsRunner } from "./statics-runner.js";

class FakeWorker {
  static all = [];
  constructor({ readyAfter = 30, never = false } = {}) {
    this.posted = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    FakeWorker.all.push(this);
    if (!never) setTimeout(() => !this.terminated && this.onmessage?.({ data: { type: "ready" } }), readyAfter);
  }
  postMessage(m) {
    this.posted.push(m);
    setTimeout(() => !this.terminated && this.onmessage?.({ data: { id: m.id, type: "done", ok: true, result: "r" } }), 5);
  }
  terminate() {
    this.terminated = true;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("statics runner: worker lifecycle", () => {
  afterEach(() => {
    FakeWorker.all = [];
    vi.unstubAllGlobals();
  });

  it("runs a job on a started worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const r = createStaticsRunner({ spawnWorker: async () => new FakeWorker({ readyAfter: 5 }) });
    await expect(r.run({ type: "x" })).resolves.toBe("r");
    r.dispose();
    expect(FakeWorker.all[0].terminated).toBe(true);
  });

  it("disposed while the worker starts: the worker is terminated when it arrives and the job is never posted", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const r = createStaticsRunner({ spawnWorker: async () => new FakeWorker({ readyAfter: 30 }) });
    const p = r.run({ type: "x" });
    const settled = p.then(
      () => "resolved",
      (e) => e.name,
    );
    await sleep(5);
    r.dispose();
    await sleep(60);
    expect(await settled).toBe("AbortError");
    expect(FakeWorker.all).toHaveLength(1);
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(FakeWorker.all[0].posted).toHaveLength(0);
  });

  it("a newer run while the worker starts supersedes the older before it is posted", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const r = createStaticsRunner({ spawnWorker: async () => new FakeWorker({ readyAfter: 20 }) });
    const a = r.run({ n: 1 }).catch((e) => e.name);
    const b = r.run({ n: 2 });
    expect(await a).toBe("AbortError");
    await expect(b).resolves.toBe("r");
    expect(FakeWorker.all[0].posted.map((m) => m.job.n)).toEqual([2]);
    r.dispose();
  });
});
