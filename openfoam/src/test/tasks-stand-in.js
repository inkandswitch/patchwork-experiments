// A stand-in for the task client, the Tasks package's library `tasks-next`,
// for this package's tests: what this package calls of it, each as plainly
// as the tests need, recording what it is asked. The real client is the tasks
// package's own to test; this package's probes (net-run, volume-run, ui-run)
// run against its build.
//
//   pools        the machines heard serving every queue (`served`, `hearServing`)
//   packageUrl   the package `inSamePackage` names, or null for none
//   asked, stops, froms   what was asked, cancelled, and inSamePackage's `from`s

import { getRegistry } from "@inkandswitch/patchwork-plugins";

export function standInTasks({ packageUrl = "automerge:openfoamTestPackage", pools = [] } = {}) {
  const watchers = new Map(); // key → its onChanges
  const ended = new Set(); // keys cancelled
  const tasks = {
    packageUrl,
    pools,
    asked: [],
    stops: [],
    froms: [],
    BEAT_MS: 50,
    STOP_REASONS: ["cancelled", "stopping", "yielded"],
    isRunEnded: (status) => ["done", "failed", "cancelled"].includes(status),
    isQueue: (doc) => !!doc?.jobs,
    findWhenThere: (repo, url) => repo.find(url),
    inSamePackage(from, path) {
      tasks.froms.push(from);
      return tasks.packageUrl ? `/${encodeURIComponent(tasks.packageUrl)}/${path}` : null;
    },
    async ask(repo, queueUrl, a) {
      const task = await repo.create2({ ...a, runs: [] });
      (await repo.find(queueUrl)).change((q) => void (q.jobs[a.key] = { taskUrl: task.url }));
      tasks.asked.push({ queueUrl, ...a });
      return { key: a.key, taskUrl: task.url };
    },
    async cancelRun(repo, run, url) {
      tasks.stops.push(url);
      const queue = await repo.find(run.server);
      if (!queue.doc().jobs[url]) return false;
      queue.change((q) => void delete q.jobs[url]);
      ended.add(url);
      for (const on of watchers.get(url) ?? []) on({ state: "cancelled", error: null, runs: [] });
      return true;
    },
    lookAtTask: async (repo, run) => ({ state: ended.has((await repo.find(run.task)).doc().key) ? "cancelled" : "waiting", error: null, runs: [] }),
    shownRun: (run, task) => (task?.state === "cancelled" ? { status: "cancelled", error: null, note: null } : { status: run?.status ?? "queued", error: run?.error ?? null, note: null }),
    watch(repo, queueUrl, key, onChange) {
      if (!watchers.has(key)) watchers.set(key, new Set());
      watchers.get(key).add(onChange);
      queueMicrotask(() => onChange({ state: ended.has(key) ? "cancelled" : "waiting", error: null, runs: [] }));
      return () => watchers.get(key).delete(onChange);
    },
    served(repo, queueUrl, onChange) {
      queueMicrotask(() => onChange(tasks.pools));
      return () => {};
    },
    hearServing: async () => tasks.pools,
    servedBy: (list) => (list.length ? list.map((p) => p.name).join(", ") : null),
    queueCounts(doc, list) {
      const listed = Object.keys(doc?.jobs ?? {}).length;
      const running = Math.min(listed, list.reduce((n, p) => n + (p.busy || 0), 0));
      return { listed, running, waiting: listed - running, slots: list.reduce((n, p) => n + (p.slots || 0), 0) };
    },
    aheadOf: () => null,
    markStopped: (run, reason) => void (run.stoppedFor = reason),
    markInterrupted: (run) => void (run.interrupted = true),
    makeRunTask: (o) => async (input, ctx) => ({ made: o, input, ctx }),
  };
  return tasks;
}

/** Registers a stand-in as the registry's `tasks-next`, as an installed Tasks package would be. */
export function installTasks(tasks = standInTasks()) {
  getRegistry("patchwork:library").register({ type: "patchwork:library", id: "tasks-next", name: "Tasks client (stand-in)", load: async () => tasks });
  return tasks;
}
