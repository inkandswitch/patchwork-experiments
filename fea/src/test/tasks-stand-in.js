// A stand-in for the Tasks package's client (the library tasks-next) in this
// package's tests, over a FakeRepo: what this package calls of it, each as
// plainly as it can be, and what it was asked, kept for a test to read. The
// real client is tested in the Tasks package; the probes run this package
// against its real build.

const ENDED = ["done", "failed", "cancelled"];

export function standIn() {
  const t = {
    /** the package inSamePackage names; null: code not loaded from a package */
    packageUrl: "automerge:feaTestPackageAbc",
    /** the machines heard serving any queue */
    pools: [],
    /** each ask, with its queue; the module urls inSamePackage was given; the runs cancelled */
    asked: [],
    from: [],
    cancelled: [],
    BEAT_MS: 2000,
    STOP_REASONS: ["cancelled", "stopping", "yielded"],
    isRunEnded: (status) => ENDED.includes(status),
    findWhenThere: (repo, url) => repo.find(url),
    isQueue: (doc) => !!doc?.jobs,
    hearServing: async () => t.pools,
    servedBy: (pools) => (pools.length ? pools.map((p) => p.name).join(", ") : null),
    queueCounts(queue, pools) {
      const listed = Object.keys(queue?.jobs ?? {}).length;
      const running = Math.min(listed, pools.reduce((n, p) => n + (p.busy ?? 0), 0));
      return { listed, running, waiting: listed - running };
    },
    inSamePackage(from, path) {
      t.from.push(from);
      return t.packageUrl && `/${encodeURIComponent(t.packageUrl)}/${path}`;
    },
    /** lists the ask in its queue's `jobs` under the run's url, with a task doc `{ state, error }` of its own, whose url the run doc keeps */
    async askRun(repo, queueUrl, run, importUrl, options) {
      t.asked.push({ queueUrl, importUrl, input: { run: run.url }, key: run.url });
      const task = repo.add({ state: "waiting", error: null });
      (await repo.find(queueUrl)).change((q) => void (q.jobs[run.url] = { taskUrl: task.url }));
      run.change((d) => void (d.task = task.url), options);
      return task.url;
    },
    /** takes the run off its queue and its task says cancelled; false where the queue doesn't list it */
    async cancelRun(repo, run, runUrl) {
      const queue = await repo.find(run.server);
      if (!queue.doc().jobs[runUrl]) return false;
      t.cancelled.push(runUrl);
      queue.change((q) => void delete q.jobs[runUrl]);
      (await repo.find(run.task)).change((d) => void (d.state = "cancelled"));
      return true;
    },
    lookAtTask: async (repo, run) => (run?.task ? (await repo.find(run.task)).doc() : null),
    /** the task's ending where it failed or was cancelled and the run doc hasn't ended; else the run doc's */
    shownRun: (run, task) =>
      !ENDED.includes(run?.status) && ["failed", "cancelled"].includes(task?.state)
        ? { status: task.state, error: task.error ?? null, note: null }
        : { status: run?.status ?? "queued", error: run?.error ?? null, note: null },
    /** writes the reason, as `stopped`, to the run doc */
    markStopped: (run, reason) => void (run.stopped = reason),
    /** a task's code that answers with what it was made of and given */
    makeRunTask: (made) => async (input, ctx) => ({ made, input, ctx }),
  };
  return t;
}
