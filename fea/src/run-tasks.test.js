// Asking for a run and stopping it through the task kit, over a fake repo:
// what the task and the queue hold after each, asking twice, cancelling a
// run that waits, one whose queue no longer lists it, and one already ended;
// reading a run's task; hearing who serves a queue; the queue as people see it.

import { FakeRepo } from "./test/fake-repo.js";
import { newRun } from "./protocol.js";
import { normalizeSetup } from "./setup.js";
import { askRun, cancelRun, lookAtTask, hearServing, queueCounts, aheadOf, servedBy, isQueue, runCodeUrl, setPackageUrl, RUN_CODE } from "./run-tasks.js";
import { taskState, allHeard, BEAT_MS } from "./task-rules.js";

const PACKAGE = "automerge:feaTestPackageAbc";
let repo, queue;
beforeEach(() => {
  setPackageUrl(PACKAGE);
  repo = new FakeRepo();
  queue = repo.add({ title: "Q", jobs: {} });
});
const newRunDoc = () => repo.add(newRun({ studyUrl: "automerge:s", serverUrl: queue.url, setup: normalizeSetup(null), part: {}, now: 1 }));

describe("the run's code", () => {
  it("is this package's daemon/run-task.mjs, named by the package's url", () => {
    expect(runCodeUrl()).toBe(`/${encodeURIComponent(PACKAGE)}/${RUN_CODE}`);
  });
  it("can't be named by a copy not loaded from its package and not told it", () => {
    setPackageUrl(null);
    expect(() => runCodeUrl()).toThrow(/wasn't loaded from its package/);
  });
});

describe("asking", () => {
  it("lists a task keyed by the run doc's url, with the run as its input, and the run doc keeps the task's url", async () => {
    const run = newRunDoc();
    const taskUrl = await askRun(repo, queue.url, run, { message: "why" });
    expect(Object.keys(queue.doc().jobs)).toEqual([run.url]);
    expect(queue.doc().jobs[run.url]).toMatchObject({ taskUrl, package: PACKAGE });
    expect((await repo.find(taskUrl)).doc()).toEqual({ importUrl: runCodeUrl(), input: { run: run.url }, key: run.url, runs: [] });
    expect(run.doc().task).toBe(taskUrl);
    expect(run.messages).toEqual(["why"]);
  });
  it("asking twice for one run is asking once", async () => {
    const run = newRunDoc();
    const first = await askRun(repo, queue.url, run);
    const again = await askRun(repo, queue.url, run);
    expect(again).toBe(first);
    expect(Object.keys(queue.doc().jobs)).toEqual([run.url]);
  });
});

describe("stopping", () => {
  it("a waiting run: a stop is recorded in its task, the queue no longer lists it, and the run doc isn't written", async () => {
    const run = newRunDoc();
    const taskUrl = await askRun(repo, queue.url, run);
    const before = JSON.stringify(run.doc());
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(true);
    const task = (await repo.find(taskUrl)).doc();
    expect(task.runs).toEqual([{ id: expect.any(String), start: expect.any(Number), end: expect.any(Number), status: "cancelled" }]);
    expect(taskState(task, allHeard)).toBe("cancelled");
    expect(queue.doc().jobs).toEqual({});
    expect(JSON.stringify(run.doc())).toBe(before);
    expect(await lookAtTask(repo, run.doc())).toEqual({ state: "cancelled", error: null, runs: task.runs });
  });
  it("a running run: the stop follows its run in the list, and the task reads stopping while that run is heard", async () => {
    const run = newRunDoc();
    const taskUrl = await askRun(repo, queue.url, run);
    const task = await repo.find(taskUrl);
    task.change((d) => d.runs.push({ id: "r1", pool: "p", start: 1 }));
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(true);
    expect(task.doc().runs.map((r) => r.status ?? "open")).toEqual(["open", "cancelled"]);
    expect(taskState(task.doc(), allHeard)).toBe("stopping");
  });
  it("cancelling twice records one stop; the second finds nothing to cancel", async () => {
    const run = newRunDoc();
    const taskUrl = await askRun(repo, queue.url, run);
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(true);
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(false);
    expect((await repo.find(taskUrl)).doc().runs).toHaveLength(1);
  });
  it("a run whose task has ended (the queue still lists it) is not stopped, and the entry goes", async () => {
    const run = newRunDoc();
    const taskUrl = await askRun(repo, queue.url, run);
    const task = await repo.find(taskUrl);
    task.change((d) => d.runs.push({ id: "r1", pool: "p", start: 1, end: 2, status: "succeeded", result: { status: "done" }, logs: [] }));
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(false);
    expect(task.doc().runs).toHaveLength(1);
    expect(queue.doc().jobs).toEqual({});
  });
  it("a run its queue no longer lists, or one that names no queue: nothing to cancel", async () => {
    const run = newRunDoc();
    await askRun(repo, queue.url, run);
    queue.change((d) => delete d.jobs[run.url]);
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(false);
    expect(await cancelRun(repo, { ...run.doc(), server: null }, run.url)).toBe(false);
  });
});

describe("reading a run's task", () => {
  it("one look, with every open run counted as going on, and the task's runs", async () => {
    const run = newRunDoc();
    expect(await lookAtTask(repo, run.doc())).toBeNull(); // names no task yet
    const taskUrl = await askRun(repo, queue.url, run);
    expect(await lookAtTask(repo, run.doc())).toEqual({ state: "waiting", error: null, runs: [] });
    const task = await repo.find(taskUrl);
    task.change((d) => d.runs.push({ id: "r1", pool: "p", start: 1 }));
    expect(await lookAtTask(repo, run.doc())).toEqual({ state: "running", error: null, runs: [{ id: "r1", pool: "p", start: 1 }] });
    task.change((d) => (d.runs[0] = { id: "r1", pool: "p", start: 1, end: 2, status: "failed", logs: [{ timestampMillis: 2, message: "why" }] }));
    expect(await lookAtTask(repo, run.doc())).toMatchObject({ state: "failed", error: "why" });
  });
  it("null for a task that can't be read here, or a document that isn't a task", async () => {
    const run = newRunDoc();
    expect(await lookAtTask(repo, { ...run.doc(), task: "automerge:nothingHereAtAllAbc" })).toBeNull();
    expect(await lookAtTask(repo, { ...run.doc(), task: queue.url })).toBeNull();
  });
});

describe("who serves a queue", () => {
  const beat = (seq, o = {}) => queue.hear({ type: "serving", pool: "pool-1", name: "Mac", slots: 2, busy: 0, from: "a-pool", seq, ...o });
  it("heard as soon as a machine says so", async () => {
    const t0 = Date.now();
    const heard = hearServing(repo, queue.url, 3_000);
    // said once the listener has found the queue's document, as a machine's next beat would be
    await new Promise((r) => setTimeout(r, 20));
    beat(0);
    expect(await heard).toEqual([{ pool: "pool-1", name: "Mac", slots: 2, busy: 0 }]);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
  it("nobody, after a little over one beat of silence", async () => {
    const t0 = Date.now();
    expect(await hearServing(repo, queue.url)).toEqual([]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(BEAT_MS);
  });
  it("for people: who, and how many at once; nobody is null", () => {
    expect(servedBy([])).toBeNull();
    expect(servedBy([{ name: "Mac", slots: 1 }])).toBe("Mac");
    expect(servedBy([{ name: "", slots: 3 }, { name: "Box", slots: 1 }])).toBe("a machine (3 at once), Box");
  });
});

describe("the queue as people see it", () => {
  const jobs = (...keys) => ({ jobs: Object.fromEntries(keys.map((k, i) => [k, { taskUrl: `automerge:t${k}`, askedAt: i, package: null }])) });
  it("running is what its machines say they are busy with, never more than it lists", () => {
    expect(queueCounts(jobs("a", "b", "c"), [{ busy: 1, slots: 2 }])).toEqual({ listed: 3, running: 1, waiting: 2, slots: 2 });
    expect(queueCounts(jobs("a"), [{ busy: 3, slots: 4 }])).toEqual({ listed: 1, running: 1, waiting: 0, slots: 4 });
    expect(queueCounts(jobs(), [])).toEqual({ listed: 0, running: 0, waiting: 0, slots: 0 });
    expect(queueCounts(undefined, [])).toEqual({ listed: 0, running: 0, waiting: 0, slots: 0 });
  });
  it("how many were asked for before a run, or null when it isn't listed", () => {
    expect(aheadOf(jobs("a", "b", "c"), "c")).toBe(2);
    expect(aheadOf(jobs("a", "b", "c"), "a")).toBe(0);
    expect(aheadOf(jobs("a"), "z")).toBeNull();
  });
  it("a task queue is a document with jobs", () => {
    expect(isQueue({ jobs: {} })).toBe(true);
    expect(isQueue({ "@patchwork": { type: "fea-run" } })).toBe(false);
    expect(isQueue(null)).toBe(false);
  });
});
