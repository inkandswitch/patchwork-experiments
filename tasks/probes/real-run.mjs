// Run a PUBLISHED copy of this package in the REAL Patchwork, the way a
// person's browser runs it: a fresh profile (cdp.mjs) installs it from its
// automerge url through module settings, makes the profile's own queue with
// the asker's client (`ownQueue`, which asks the site's own tool-storage
// provider for the task storage and serves that queue alone), mounts the
// titlebar badge (which starts the page's pool host), and asks that queue
// for tasks through the client (src/task-client.js, bundled here and put on
// the page).
//
// NOT RUN YET. It needs a published copy of the package, and only the
// integrator publishes. probes/browser-run.mjs proves the same pool on this
// machine against the built package, with two to five tabs; this one adds
// what only the real site has: its own Repo and import map, and code kept in
// automerge, fetched through the site's service worker and run.
//
//   (in tasks/) /Users/pvh/dev/pwx-one/tools/slot.sh chrome -- \
//     node probes/real-run.mjs <automerge:package url> [--wait 180] [--shell https://…/] [--debug]
//
// Nothing here is written anywhere a person would see: the account, its
// module settings and the queue all belong to the throwaway profile.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { browser, checklist } from "./cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [pkg] = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
if (!/^automerge:\w+$/.test(pkg ?? "")) {
  console.error("usage: node probes/real-run.mjs <automerge:package url> [--wait 180] [--shell https://…/] [--debug]");
  process.exit(2);
}
const WAIT = Number(arg("--wait", 180));
const SHELL = arg("--shell", "https://patchwork.inkandswitch.com/");
const GRACE_MS = 5_000;
const J = JSON.stringify;

// The asker's client, as one script that leaves it on `window.taskClient`.
const client = (
  await build({
    entryPoints: [resolve(HERE, "../src/task-client.js")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "taskClient",
    platform: "browser",
    target: "es2022",
  })
).outputFiles[0].text;

const b = await browser({ root: HERE, port: Number(arg("--port", 4987)), cdp: Number(arg("--cdp", 9987)), page: "/cdp.mjs", timeout: (WAIT + 240) * 1000 });
const list = checklist();
const { check } = list;
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${ms} ms`)), ms))]);
const js = (expr, what = "the page", ms = 60_000) => within(ms, b.js(expr), what);
const report = { package: pkg };

/** Runs `body` in the page with C (the client), T (this tab's tasks Repo), site (the site's own Repo) and Q (the queue's url). */
const call = (body, what, ms = 60_000) =>
  js(`(async () => { const C = window.taskClient; const T = await window.patchworkTasks.repo; const site = window.repo; const Q = window.__probe.queueUrl; ${body} })()`, what, ms);
const status = () => js("Object.values(window.patchworkTasks?.poolHosts ?? {})[0]?.status() ?? null");
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

try {
  await b.send("Page.navigate", { url: SHELL });
  check("the shell booted", await b.waitFor("!!window.repo && !!window.accountDocHandle", 90_000, 500));
  await js(client, "the client");

  // The profile's own queue, made by the client through the site's own
  // tool-storage provider (asked from the provider's element, as a tool
  // under it would ask), the only queue its account serves; then the package.
  const setup = await js(`(async () => {
    const C = window.taskClient;
    const account = window.accountDocHandle;
    const before = C.storageUrlOf(account.doc());
    const element = document.querySelector('patchwork-view[component="patchwork-tool-storage-provider"]');
    if (!element) return { error: "the frame has no tool-storage provider" };
    const queueUrl = await C.ownQueue(window.repo, element);
    const storageUrl = C.storageUrlOf(account.doc());
    const storage = (await window.repo.find(storageUrl)).doc();
    const msUrl = account.doc().moduleSettingsUrl;
    const ms = msUrl ? await window.repo.find(msUrl) : null;
    ms?.change((d) => { if (!d.modules) d.modules = []; if (!d.modules.includes(${J(pkg)})) d.modules.push(${J(pkg)}); });
    window.__probe = { queueUrl, storageUrl };
    return { storageBefore: before, queueUrl, storageUrl, own: C.ownQueueOf(storage), served: C.servedOf(storage), modules: ms?.doc().modules ?? null };
  })()`);
  Object.assign(report, setup);
  check(
    "a fresh account names no task storage; ownQueue makes it through the site's provider, and it serves the new queue alone, as the account's own",
    setup.storageBefore === null && /^automerge:/.test(setup.storageUrl ?? "") && setup.own === setup.queueUrl && J(setup.served) === J({ [setup.queueUrl]: true }),
    setup,
  );
  check("the package is in this profile's module settings", setup.modules?.includes(pkg), setup);

  // Open the queue (its browser is this package's tool), then put the badge up as a frame would.
  const MOUNT = `(() => {
    if (!document.querySelector("#probe-badge")) {
      const v = document.createElement("patchwork-view");
      v.id = "probe-badge";
      v.setAttribute("tool-id", "task-titlebar-next");
      v.setAttribute("doc-url", window.__probe.queueUrl);
      (document.querySelector("repo-provider") ?? document.body).appendChild(v);
    }
    return true;
  })()`;
  const open = async () => {
    await js(`location.hash = "#doc=" + window.__probe.queueUrl`);
    return b.waitFor(`/Serving it/i.test(document.body.innerText)`, 60_000, 500);
  };
  let opened = await open();
  // A shell that reads module settings only as it starts needs starting once more.
  if (!opened) {
    report.reloadedToLoadPackage = true;
    await b.send("Page.reload");
    await b.waitFor("!!window.repo && !!window.accountDocHandle", 60_000, 500);
    await js(`window.__probe = { queueUrl: ${J(setup.queueUrl)}, storageUrl: ${J(setup.storageUrl)} }`);
    opened = await open();
  }
  check("the queue browser is this package's", opened);
  await js(MOUNT);
  const started = await b.waitFor("Object.values(window.patchworkTasks?.poolHosts ?? {})[0]?.status().state === 'running'", 60_000, 250);
  report.pool = await status();
  check("this tab runs the browser's pool", !!started, report.pool);
  await js(client, "the client");

  // 1. a do-nothing task, ask to result: from this tab's tasks Repo, and from the site's own
  {
    const NOOP = J(`data:text/javascript,${encodeURIComponent("export default () => 1;")}`);
    const times = await call(`
      const out = { tasks: [], site: [] };
      for (const [repo, into] of [[T, out.tasks], [site, out.site]]) {
        for (let i = 0; i < 11; i++) { const t0 = performance.now(); await C.run(repo, Q, { importUrl: ${NOOP} }); into.push(performance.now() - t0); }
        into.shift(); // the first starts a run worker
      }
      return out;`, "ten do-nothing tasks", 180_000);
    report.latency = { tasksRepo: { median: median(times.tasks), worst: Math.max(...times.tasks) }, siteRepo: { median: median(times.site), worst: Math.max(...times.site) } };
    check("a do-nothing task, ten in a row, from either Repo", times.tasks.length === 10 && times.site.length === 10, report.latency);
  }

  // 2. code kept in automerge: fetched through the site's service worker and run; its progress and log heard
  {
    const WAIT_TASK = J(`/${encodeURIComponent(pkg)}/dist/tasks/wait.js`);
    const out = await call(`
      const seen = [];
      const result = await C.run(T, Q, { importUrl: ${WAIT_TASK}, input: { ms: 2500, value: "kept" } }, (view) => seen.push([view.state, view.progress, view.logs.length, view.runs]));
      const last = seen.at(-1);
      return {
        result,
        progress: [...new Set(seen.filter(([s, p]) => s === "running" && typeof p === "number").map(([, p]) => p))].length,
        heardLog: seen.some(([s, , n]) => s === "running" && n > 0),
        runs: last[3].map((r) => r.status),
        kept: (last[3][0]?.logs ?? []).map((l) => l.message),
      };`, "the package's own task");
    check("code kept in automerge is fetched through the service worker and run; progress and log heard; the record keeps the log", out.result === "kept" && out.progress >= 5 && out.heardLog && J(out.runs) === J(["succeeded"]) && out.kept.length > 0, out);
  }

  // 3. a throwing task fails once
  {
    const out = await call(`
      let last;
      const error = await C.run(T, Q, { importUrl: ${J(`/${encodeURIComponent(pkg)}/dist/tasks/wait.js`)}, input: { ms: 50, fail: true } }, (v) => (last = v)).then(() => null, (e) => e.message);
      await new Promise((r) => setTimeout(r, 3000));
      return { error, state: last.state, runs: last.runs.map((r) => r.status) };`, "a task that fails");
    check("a throwing task fails once", out.error === "asked to fail" && J(out.runs) === J(["failed"]), out);
  }

  // 4. a spinning task, cancelled: stopping, then cancelled; the pool's slot free again; the next task runs
  {
    const SPIN = J(`data:text/javascript,${encodeURIComponent("export default () => { for (;;) {} };")}`);
    const out = await call(`
      const states = [];
      const { key } = await C.ask(T, Q, { importUrl: ${SPIN} });
      let cancelled;
      const over = new Promise((r) => (cancelled = r));
      const stop = C.watch(T, Q, key, (v) => { if (states.at(-1) !== v.state) states.push(v.state); if (v.state === "cancelled") cancelled(); });
      while (!states.includes("running")) await new Promise((r) => setTimeout(r, 50));
      const t0 = Date.now();
      await C.cancel(T, Q, key);
      await over;
      const host = Object.values(window.patchworkTasks.poolHosts)[0];
      while (host.status().busy > 0 && Date.now() - t0 < ${GRACE_MS + 6_000}) await new Promise((r) => setTimeout(r, 100));
      const freeAfter = Date.now() - t0;
      stop();
      const next = await C.run(T, Q, { importUrl: ${J(`data:text/javascript,${encodeURIComponent("export default () => 2;")}`)} });
      return { states, freeAfter, next };`, "a spinning task", 60_000);
    // the busy count is polled every beat, so the bound here is a beat looser than browser-run's (which watches the worker itself go)
    check("a spinning task cancelled: stopping then cancelled; its slot is free again; the next task runs", out.states.includes("stopping") && out.states.at(-1) === "cancelled" && out.freeAfter <= GRACE_MS + 3_000 + 2_000 && out.next === 2, out);
  }

  // 5. whose code this browser runs from the queue: only this package's, then any again (written to the task storage, as the queue browser's control writes it)
  {
    const out = await call(`
      const storage = await site.find(window.__probe.storageUrl);
      const data = "data:text/javascript," + encodeURIComponent("export default () => 'ran'");
      storage.change((d) => C.setServed(d, Q, { packages: [${J(pkg)}] }));
      await new Promise((r) => setTimeout(r, 2000));
      const { key } = await C.ask(T, Q, { importUrl: data });
      const fromPackage = await C.run(T, Q, { importUrl: ${J(`/${encodeURIComponent(pkg)}/dist/tasks/wait.js`)}, input: { ms: 100, value: "accepted" } });
      await new Promise((r) => setTimeout(r, 3000));
      const waiting = (await T.find((await T.find(Q)).doc().jobs[key].taskUrl)).doc().runs.length;
      storage.change((d) => C.setServed(d, Q, true));
      const afterwards = await new Promise((r) => { const stop = C.watch(T, Q, key, (v) => { if (v.state === "succeeded") { stop(); r(v.result); } }); });
      return { fromPackage, runsWhileRefused: waiting, afterwards };`, "what the pool accepts", 90_000);
    check("told to run only this package's code, the pool leaves a data: URL waiting, and runs it once told it may", out.fromPackage === "accepted" && out.runsWhileRefused === 0 && out.afterwards === "ran", out);
  }

  // 6. served() lists this browser's pool; the queue browser marks it
  {
    const pools = await call(`return await new Promise((r) => { let pools = []; const stop = C.served(T, Q, (p) => (pools = p)); setTimeout(() => (stop(), r(pools)), 5000); });`, "served");
    const id = await js("localStorage.getItem('patchwork-tasks-pool-id')");
    const mine = pools.find((p) => p.pool === id);
    check("served() lists this browser's pool with its name and slots", !!mine && / \(\w{4}\)$/.test(mine.name) && mine.slots >= 1, pools);
    check("the queue browser marks this browser's pool", await b.waitFor("/this browser/.test(document.body.innerText)", 10_000, 250));
  }

  // 7. a document a task writes through ctx.repo reaches the page. A browser's
  // run worker keeps its documents in a database of its own, so this goes by
  // the sync server, to this tab's tasks Repo and to the site's own alike
  // (browser-run.mjs has no server, and cannot show it).
  {
    const WRITES = J(`data:text/javascript,${encodeURIComponent("export default async (input, ctx) => { const doc = ctx.repo.create({ wrote: input.tag }); doc.change((d) => { d.changed = true; }); await ctx.repo.flush(); return doc.url; };")}`);
    const out = await call(`
      const t0 = performance.now();
      const url = await C.run(T, Q, { importUrl: ${WRITES}, input: { tag: "seven" } });
      const ran = performance.now() - t0;
      // How long after the task ended the document, as written, is had through \`repo\`; null if not within 30 s.
      const arrives = async (repo) => {
        const s = performance.now();
        while (performance.now() - s < 30000) {
          const doc = await Promise.race([repo.find(url).then((h) => h.doc(), () => null), new Promise((r) => setTimeout(() => r(null), 5000))]);
          if (doc?.wrote === "seven" && doc.changed === true) return performance.now() - s;
          await new Promise((r) => setTimeout(r, 500));
        }
        return null;
      };
      return { url, ran, tasksRepo: await arrives(T), siteRepo: await arrives(site) };`, "a document a task writes", 120_000);
    check(
      "a document a task writes through ctx.repo reaches the page by the sync server: this tab's tasks Repo and the site's Repo both have it",
      typeof out.url === "string" && out.url.startsWith("automerge:") && out.tasksRepo !== null && out.siteRepo !== null,
      out,
    );
  }
} catch (err) {
  check("probe ran", false, String(err?.stack ?? err));
}
const pageErrors = b.logs.filter((l) => /^(error|exception)/i.test(l) && /task/i.test(l));
check("no page errors from the task system", pageErrors.length === 0, pageErrors.slice(0, 10));
if (process.argv.includes("--debug")) report.pageLogs = b.logs.filter((l) => /task|pool|worker|module|error|exception/i.test(l)).slice(-60).map((l) => l.slice(0, 300));
console.log(J({ ...report, checks: list.checks, details: list.details }, null, 2));
b.stop(list.failed ? 1 : 0);
