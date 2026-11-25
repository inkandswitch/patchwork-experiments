// Run a PUBLISHED copy of this package in the REAL Patchwork, the way a
// person's browser runs it, in a fresh profile (cdp.mjs): the package is
// installed from its automerge url through the profile's module settings;
// mounted where no tool-storage provider is above it, Make my queue says
// plainly that nothing was changed; then what a frame mounts of it is mounted
// inside the site's own tool-storage provider (a `patchwork-view` of
// `patchwork-tool-storage-provider` on the account, as the frames mount it):
// its background component, which starts the page's pool host (and, with no
// queue served yet, no pool worker), and its badge, whose Make my queue makes
// the profile's own queue. That queue is then asked for tasks through the
// client (src/task-client.js, bundled here and put on the page), from this
// tab's tasks Repo and from the site's own.
//
// What only the real site has, and this checks: the site's Repo (a keyhive
// one) beside the task system's plain ones; its import map; code kept in
// automerge fetched through its service worker, in the pool worker and its
// run workers alike (every dedicated worker is attached over CDP, to see
// where it loaded from and when it ended); and its sync server, by which
// what a run worker writes reaches the page.
//
//   (in tasks/) /Users/pvh/dev/pwx-one/tools/slot.sh chrome -- \
//     node probes/real-run.mjs <automerge:package url> [--wait 180] [--shell https://…/] [--debug]
//
// Nothing here is written anywhere a person would see: the account, its
// module settings and the queue all belong to the throwaway profile.
//
// What counts as an error of the task system, any one of which fails the
// run: in a worker, every uncaught exception and console error of a worker
// loaded from the package (the pool worker, the run workers) or started by
// one, whatever it says, since nothing else runs there; in the page, an
// uncaught exception or console error with a stack frame in one of the
// package's files or in this probe's copy of the client, or whose text begins
// with "tasks:" or "pool:", which every line the package logs begins with.
// The page's other errors are the site's, and only recorded.
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
const PKG_ID = pkg.slice("automerge:".length);

// The asker's client, as one script that leaves it on `window.taskClient`.
// Named, so that its frames in a stack say they are the task system's.
const CLIENT_URL = "probe-task-client.js";
const client =
  (
    await build({
      entryPoints: [resolve(HERE, "../src/task-client.js")],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "taskClient",
      platform: "browser",
      target: "es2022",
    })
  ).outputFiles[0].text + `\n//# sourceURL=${CLIENT_URL}`;

const b = await browser({ root: HERE, port: Number(arg("--port", 4987)), cdp: Number(arg("--cdp", 9987)), page: "/cdp.mjs", timeout: (WAIT + 300) * 1000 });
const list = checklist();
const { check } = list;
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${ms} ms`)), ms))]);
const js = (expr, what = "the page", ms = 60_000) => within(ms, b.js(expr), what);
const report = { package: pkg };

/** Whether a script's url (or a text naming one) is one of the package's files, as the site serves them, or this probe's copy of the client. */
const ofPackage = (url) => typeof url === "string" && (url.includes(`automerge%3A${PKG_ID}`) || url.includes(`automerge:${PKG_ID}`) || url.includes(CLIENT_URL));

// Every dedicated worker the page starts, and the workers they start: where
// each loaded from, which worker started it, and when it ended (its session
// detached). The errors of the task system's workers, and of the page.
const workers = new Map();
const workerErrors = []; // of the task system's workers
const otherWorkerErrors = [];
const pageErrors = []; // the task system's, in the page
const otherPageErrors = [];
/** Whether the worker of this session is the task system's: loaded from the package, or started by a worker that is. */
const ofTaskSystem = (sessionId) => {
  const w = workers.get(sessionId);
  return !!w && (ofPackage(w.url) || (!!w.parent && ofTaskSystem(w.parent)));
};
/** An uncaught exception or console error: its text, and the urls of its stack's frames; null for any other message. */
const errorOf = (m) => {
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails ?? {};
    const text = d.exception?.description ?? d.text ?? "";
    return { text, urls: [d.url, ...(d.stackTrace?.callFrames ?? []).map((f) => f.url)] };
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    const text = m.params.args.map((a) => a.value ?? a.description).join(" ");
    return { text, urls: (m.params.stackTrace?.callFrames ?? []).map((f) => f.url) };
  }
  return null;
};
b.on((m) => {
  if (m.method === "Target.attachedToTarget" && m.params.targetInfo.type === "worker") {
    const { sessionId, targetInfo } = m.params;
    workers.set(sessionId, { url: targetInfo.url, at: Date.now(), gone: null, parent: m.sessionId ?? null });
    b.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
    b.send("Runtime.enable", {}, sessionId).catch(() => {});
  }
  if (m.method === "Target.detachedFromTarget" && workers.has(m.params.sessionId)) workers.get(m.params.sessionId).gone = Date.now();
  const error = errorOf(m);
  if (!error) return;
  if (m.sessionId) {
    if (!workers.has(m.sessionId)) return;
    const line = `${workers.get(m.sessionId).url.split("/").at(-1)}: ${error.text}`.slice(0, 300);
    (ofTaskSystem(m.sessionId) ? workerErrors : otherWorkerErrors).push(line);
  } else {
    // A stack's frames, or the stack written out in an exception's text, or the package's own prefix.
    const ours = error.urls.some(ofPackage) || ofPackage(error.text) || /^(tasks|pool): /.test(error.text);
    (ours ? pageErrors : otherPageErrors).push(error.text.slice(0, 300));
  }
});
const kind = (url) => (/pool-worker-[\w-]+\.js/.test(url) ? "pool" : /run-worker-entry-[\w-]+\.js/.test(url) ? "run" : "other");
const live = (k) => [...workers.values()].filter((w) => kind(w.url) === k && !w.gone);

/** Runs `body` in the page with C (the client), T (this tab's tasks Repo), site (the site's own Repo) and Q (the queue's url). */
const call = (body, what, ms = 60_000) =>
  js(`(async () => { const C = window.taskClient; const T = await window.patchworkTasks.repo; const site = window.repo; const Q = window.__probe.queueUrl; ${body} })()`, what, ms);
const status = () => js("Object.values(window.patchworkTasks?.poolHosts ?? {})[0]?.status() ?? null");
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round = (x) => Math.round(x);
/** One part of the probe: a throw fails it alone, so that what comes after is still looked at. */
const part = async (name, body) => {
  try {
    await body();
  } catch (err) {
    check(name, false, String(err?.stack ?? err).slice(0, 600));
  }
};
const REGISTRY = `(await import("@inkandswitch/patchwork-plugins"))`;

try {
  await b.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await b.send("Page.navigate", { url: SHELL });
  // Booted is not enough: the frame mounts a moment later, and only then are its providers there.
  const booted = await b.waitFor("!!window.repo && !!window.accountDocHandle", 90_000, 500);
  const framed = booted && (await b.waitFor(`!!document.querySelector('#root patchwork-view[component="patchwork-tool-storage-provider"]')`, 60_000, 250));
  report.site = await js(`(async () => {
    const P = ${REGISTRY};
    const account = window.accountDocHandle.doc();
    const ms = account.moduleSettingsUrl ? (await window.repo.find(account.moduleSettingsUrl)).doc() : null;
    return {
      frame: document.getElementById("root")?.getAttribute("tool-id") ?? null,
      providers: [...document.querySelectorAll("#root patchwork-view[component]")].map((v) => v.getAttribute("component")),
      storageProviderRegistered: P.getRegistry("patchwork:component").all().some((p) => p.id === "patchwork-tool-storage-provider"),
      backgroundComponents: P.getRegistry("patchwork:component").all().filter((p) => p.tags?.includes("background")).map((p) => p.id),
      modules: ms?.modules ?? null,
      toolStorage: Object.keys(account.toolStorage ?? {}),
      siteRepo: window.repo.constructor?.name ?? null,
      keyhive: !!window.hive,
    };
  })()`);
  check("the shell booted, and its frame mounts the site's tool-storage provider", booted && framed, report.site);
  await js(client, "the client");
  const accountUrl = await js("window.accountDocHandle.url");

  // The package, installed as module settings install it, from its automerge url.
  await part("the package installs from its automerge url: its plugins are registered", async () => {
    const before = await js(`(async () => {
      const account = window.accountDocHandle.doc();
      const ms = await window.repo.find(account.moduleSettingsUrl);
      ms.change((d) => { if (!d.modules) d.modules = []; if (!d.modules.includes(${J(pkg)})) d.modules.push(${J(pkg)}); });
      return ms.doc().modules;
    })()`);
    const t0 = Date.now();
    const registered = await b.waitFor(`(async () => { const P = ${REGISTRY}; return ["task-pool-next", "task-titlebar-next", "task-queue-next-browser"].every((id) => [...P.getRegistry("patchwork:component").all(), ...P.getRegistry("patchwork:tool").all()].some((p) => p.id === id)); })()`, 90_000, 500);
    report.install = {
      modules: before,
      registeredAfterMs: Date.now() - t0,
      loadedFrom: await js(`performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes(${J(PKG_ID)})).map((n) => new URL(n).pathname).slice(0, 12)`),
    };
    check("the package installs from its automerge url: its plugins are registered", registered && report.install.loadedFrom.length > 0, report.install);
    // What the site's own frame does with the package: whether it mounts the
    // background component (a frame published since the component was added
    // does), and the badge in its tray, with what it says. Recorded, not
    // checked, since this probe mounts both either way.
    await new Promise((r) => setTimeout(r, 3000));
    report.site.frameStartsPool = await js(`(() => {
      const tray = document.querySelector('#root patchwork-view[component="task-tray-next"]');
      const said = tray?.querySelector(".task-titlebar");
      return {
        mounted: !!document.querySelector('#root patchwork-view[component="task-pool-next"]'),
        hosts: Object.keys(window.patchworkTasks?.poolHosts ?? {}).length,
        trayBadge: tray ? { text: said?.textContent ?? null, title: said?.title ?? null } : null,
      };
    })()`);
  });

  // A page with no tool-storage provider above the badge: Make my queue says so, and changes nothing.
  await part("with no tool-storage provider above it, Make my queue says plainly that nothing was changed", async () => {
    await js(`(() => {
      const v = document.createElement("patchwork-view");
      v.id = "probe-bare";
      v.setAttribute("tool-id", "task-titlebar-next");
      v.setAttribute("doc-url", ${J(accountUrl)});
      (document.querySelector("repo-provider") ?? document.body).appendChild(v);
    })()`);
    const offered = await b.waitFor(`!!document.querySelector('#probe-bare button[data-offer="make"]')`, 30_000, 250);
    await js(`document.querySelector('#probe-bare button[data-offer="make"]')?.click()`);
    const t0 = Date.now();
    const said = await b.waitFor(`document.querySelector('#probe-bare [role="alert"]')?.textContent ?? false`, 15_000, 200);
    const out = { offered, said, after: Date.now() - t0, storage: await js(`window.taskClient.storageUrlOf(window.accountDocHandle.doc())`), stillOffered: await js(`!!document.querySelector('#probe-bare button[data-offer="make"]:not([disabled])')`) };
    report.noProvider = out;
    await js(`document.querySelector("#probe-bare")?.remove()`);
    check(
      "with no tool-storage provider above it, Make my queue says plainly that nothing was changed",
      offered && said === "This page has nowhere to keep your task queues, so nothing was changed." && out.storage === null && out.stillOffered,
      out,
    );
  });

  // What a frame mounts of the package, inside the site's tool-storage
  // provider as the frames mount it: the background component and the badge.
  // Make my queue, pressed in that badge, makes the profile's own queue.
  await part("Make my queue, under the site's tool-storage provider, makes the profile's own queue, served alone", async () => {
    await js(`(() => {
      const providers = document.createElement("patchwork-view");
      providers.id = "probe-providers";
      providers.setAttribute("component", "patchwork-tool-storage-provider");
      providers.setAttribute("doc-url", ${J(accountUrl)});
      providers.style.display = "contents";
      const pool = document.createElement("patchwork-view");
      pool.id = "probe-pool";
      pool.setAttribute("component", "task-pool-next");
      pool.style.display = "contents";
      const badge = document.createElement("patchwork-view");
      badge.id = "probe-badge";
      badge.setAttribute("tool-id", "task-titlebar-next");
      badge.setAttribute("doc-url", ${J(accountUrl)});
      providers.append(pool, badge);
      (document.querySelector("repo-provider") ?? document.body).appendChild(providers);
    })()`);
    const offered = await b.waitFor(`!!document.querySelector('#probe-badge button[data-offer="make"]')`, 30_000, 250);
    const storageBefore = await js(`window.taskClient.storageUrlOf(window.accountDocHandle.doc())`);
    // Before the queue is made the account serves nothing, so the background
    // component, mounted, asks for no lock and starts no pool worker.
    const idle = await b.waitFor("Object.values(window.patchworkTasks?.poolHosts ?? {})[0]?.status().state === 'serves nothing'", 15_000, 250);
    const idleOut = {
      host: await status(),
      poolWorkers: live("pool").length,
      lock: await js(`navigator.locks.query().then((q) => [...q.held, ...q.pending].filter((l) => l.name === "patchwork-tasks-pool").length)`),
    };
    report.servingNothing = idleOut;
    check(
      "serving nothing, the background component asks for no lock and starts no pool worker, and its host says it serves nothing",
      !!idle && storageBefore === null && idleOut.poolWorkers === 0 && idleOut.lock === 0,
      idleOut,
    );
    await js(`document.querySelector('#probe-badge button[data-offer="make"]')?.click()`);
    const t0 = Date.now();
    const made = await b.waitFor(`(async () => { const C = window.taskClient; const s = C.storageUrlOf(window.accountDocHandle.doc()); if (!s) return false; return C.ownQueueOf((await window.repo.find(s)).doc()) ?? false; })()`, 30_000, 250);
    const setup = await js(`(async () => {
      const C = window.taskClient;
      const storageUrl = C.storageUrlOf(window.accountDocHandle.doc());
      const storage = storageUrl ? (await window.repo.find(storageUrl)).doc() : null;
      const queueUrl = storage ? C.ownQueueOf(storage) : null;
      window.__probe = { queueUrl, storageUrl };
      return { queueUrl, storageUrl, served: C.servedOf(storage), problem: document.querySelector('#probe-badge [role="alert"]')?.textContent ?? null };
    })()`);
    Object.assign(report, setup, { madeAfterMs: Date.now() - t0 });
    check(
      "Make my queue, under the site's tool-storage provider, makes the profile's own queue, served alone",
      offered && storageBefore === null && !!made && /^automerge:/.test(setup.storageUrl ?? "") && J(setup.served) === J({ [setup.queueUrl]: true }),
      { offered, storageBefore, ...setup },
    );
  });
  if (!report.queueUrl) throw new Error("no queue was made, so nothing can be asked");

  await part("the background component starts this tab's pool, in a worker loaded from the package through the service worker", async () => {
    const started = await b.waitFor("Object.values(window.patchworkTasks?.poolHosts ?? {})[0]?.status().state === 'running'", 60_000, 250);
    report.pool = await status();
    report.poolWorkers = live("pool").map((w) => new URL(w.url).pathname);
    check(
      "the background component starts this tab's pool, in a worker loaded from the package through the service worker",
      !!started && report.poolWorkers.length === 1 && report.poolWorkers[0].startsWith(`/automerge%3A${PKG_ID}`) && report.poolWorkers[0].includes("/dist/assets/"),
      { pool: report.pool, poolWorkers: report.poolWorkers, all: [...workers.values()].map((w) => w.url) },
    );
  });

  // The queue browser: this package's tool, opened as any document is.
  await part("the queue browser opens the queue, and says this tab runs the pool", async () => {
    await js(`location.hash = "#doc=" + window.__probe.queueUrl`);
    const opened = await b.waitFor(`/Serving it/i.test(document.body.innerText)`, 60_000, 500);
    const here = await b.waitFor(`(() => { const el = document.querySelector(".tq-pool-here"); return el?.dataset.poolState === "running" ? el.textContent : false; })()`, 15_000, 250);
    check("the queue browser opens the queue, and says this tab runs the pool", opened && typeof here === "string" && /This tab runs this browser's pool/.test(here), { opened, here });
  });

  // 1. a do-nothing task, ask to result: from this tab's tasks Repo, and from the site's own.
  await part("a do-nothing task, ten in a row, from this tab's tasks Repo", async () => {
    const NOOP = J(`data:text/javascript,${encodeURIComponent("export default () => 1;")}`);
    const times = await call(`
      const out = { tasks: [], site: [], errors: {} };
      const once = (repo) => Promise.race([C.run(repo, Q, { importUrl: ${NOOP} }), new Promise((_, no) => setTimeout(() => no(new Error("no result in 30 s")), 30000))]);
      for (const [name, repo] of [["tasks", T], ["site", site]]) {
        for (let i = 0; i < 11; i++) {
          const t0 = performance.now();
          try { await once(repo); out[name].push(performance.now() - t0); } catch (e) { out.errors[name] = String(e.message ?? e); break; }
        }
        out[name].shift(); // the first may start a run worker
      }
      return out;`, "ten do-nothing tasks from each Repo", 200_000);
    const stat = (xs) => (xs.length ? { n: xs.length, median: round(median(xs)), worst: round(Math.max(...xs)), all: xs.map(round) } : { n: 0 });
    report.latency = { tasksRepo: stat(times.tasks), siteRepo: stat(times.site), errors: times.errors };
    check("a do-nothing task, ten in a row, from this tab's tasks Repo", times.tasks.length === 10, report.latency);
    check("a do-nothing task, ten in a row, asked through the site's own Repo (as every ordinary tool asks)", times.site.length === 10, report.latency);
    report.runWorkers = [...workers.values()].filter((w) => kind(w.url) === "run").map((w) => new URL(w.url).pathname);
    check(
      "run workers load from the package through the service worker",
      report.runWorkers.length > 0 && report.runWorkers.every((p) => p.startsWith(`/automerge%3A${PKG_ID}`) && p.includes("/dist/assets/")),
      report.runWorkers,
    );
  });

  // 2. code kept in automerge: fetched through the site's service worker and run; its progress and log heard
  await part("the package's own task module (dist/tasks/wait.js) runs; progress and log heard; the record keeps the log", async () => {
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
    check("the package's own task module (dist/tasks/wait.js) runs; progress and log heard; the record keeps the log", out.result === "kept" && out.progress >= 5 && out.heardLog && J(out.runs) === J(["succeeded"]) && out.kept.length > 0, out);
  });

  // 3. a throwing task fails once
  await part("a throwing task fails once", async () => {
    const out = await call(`
      let last;
      const error = await C.run(T, Q, { importUrl: ${J(`/${encodeURIComponent(pkg)}/dist/tasks/wait.js`)}, input: { ms: 50, fail: true } }, (v) => (last = v)).then(() => null, (e) => e.message);
      await new Promise((r) => setTimeout(r, 3000));
      return { error, state: last.state, runs: last.runs.map((r) => r.status) };`, "a task that fails");
    check("a throwing task fails once", out.error === "asked to fail" && J(out.runs) === J(["failed"]), out);
  });

  // 4. a spinning task, cancelled: stopping, then cancelled; its run worker ended; the next task runs
  await part("a spinning task cancelled: stopping then cancelled; its run worker ended within the grace; the next task runs", async () => {
    const SPIN = J(`data:text/javascript,${encodeURIComponent("export default () => { for (;;) {} };")}`);
    await call(`
      const { key } = await C.ask(T, Q, { importUrl: ${SPIN} });
      window.__spin = { key, states: [] };
      window.__spin.stop = C.watch(T, Q, key, (v) => { if (window.__spin.states.at(-1) !== v.state) window.__spin.states.push(v.state); });
      while (!window.__spin.states.includes("running")) await new Promise((r) => setTimeout(r, 50));`, "a spinning task starts");
    const runningBefore = live("run").length;
    const t0 = Date.now();
    await call(`await C.cancel(T, Q, window.__spin.key);`, "cancel");
    const cancelled = await b.waitFor(`window.__spin.states.at(-1) === "cancelled"`, GRACE_MS + 10_000, 100);
    while (live("run").length >= runningBefore && Date.now() - t0 < GRACE_MS + 6_000) await new Promise((r) => setTimeout(r, 100));
    const ended = [...workers.values()].filter((w) => kind(w.url) === "run" && w.gone && w.gone >= t0).map((w) => w.gone - t0);
    const out = { states: await js("window.__spin.states"), cancelled: !!cancelled, runningBefore, runningAfter: live("run").length, workerEndedAfterMs: ended };
    await js("window.__spin.stop()");
    out.next = await call(`return await C.run(T, Q, { importUrl: ${J(`data:text/javascript,${encodeURIComponent("export default () => 2;")}`)} });`, "the next task");
    check(
      "a spinning task cancelled: stopping then cancelled; its run worker ended within the grace; the next task runs",
      out.states.includes("stopping") && out.cancelled && ended.length >= 1 && Math.min(...ended) <= GRACE_MS + 3_000 && out.next === 2,
      out,
    );
  });

  // 5. whose code this browser runs from the queue: only this package's, then any again (written to the task storage, as the queue browser's control writes it)
  await part("told to run only this package's code, the pool leaves a data: URL waiting, and runs it once told it may", async () => {
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
      const afterwards = await Promise.race([
        new Promise((r) => { const stop = C.watch(T, Q, key, (v) => { if (v.state === "succeeded") { stop(); r(v.result); } }); }),
        new Promise((r) => setTimeout(() => r("not run in 30 s"), 30000)),
      ]);
      return { fromPackage, runsWhileRefused: waiting, afterwards };`, "what the pool accepts", 90_000);
    check("told to run only this package's code, the pool leaves a data: URL waiting, and runs it once told it may", out.fromPackage === "accepted" && out.runsWhileRefused === 0 && out.afterwards === "ran", out);
  });

  // 6. served() lists this browser's pool; the queue browser marks it; the badge says what the pool is doing
  await part("served() lists this browser's pool with its name and slots", async () => {
    const pools = await call(`return await new Promise((r) => { let pools = []; const stop = C.served(T, Q, (p) => (pools = p)); setTimeout(() => (stop(), r(pools)), 5000); });`, "served");
    const id = await js("localStorage.getItem('patchwork-tasks-pool-id')");
    const mine = pools.find((p) => p.pool === id);
    check("served() lists this browser's pool with its name and slots", !!mine && / \(\w{4}\)$/.test(mine.name) && mine.slots >= 1, pools);
    check("the queue browser marks this browser's pool", await b.waitFor("/this browser/.test(document.body.innerText)", 10_000, 250));
    const badge = await b.waitFor(`(() => { const el = document.querySelector('#probe-badge button[data-pool-state]'); return el && /listed · (served here|\\d+ running here)/.test(el.textContent) ? { text: el.textContent, state: el.dataset.poolState, title: el.title } : false; })()`, 10_000, 250);
    check("the badge says how many tasks the queue lists and that this tab serves it", !!badge && badge.state === "running", badge);
  });

  // 7. a document a task writes through ctx.repo reaches the page. A browser's
  // run worker keeps its documents in a database of its own, so this goes by
  // the sync server, to this tab's tasks Repo and to the site's own alike; and
  // the run says it ended only once the server had what it wrote, so its log
  // says nothing of documents left behind.
  await part("a document a task writes through ctx.repo reaches the page by the sync server: this tab's tasks Repo and the site's Repo both have it", async () => {
    const WRITES = J(`data:text/javascript,${encodeURIComponent("export default async (input, ctx) => { const doc = ctx.repo.create({ wrote: input.tag }); doc.change((d) => { d.changed = true; }); return doc.url; };")}`);
    const runWorkersBefore = new Set([...workers.keys()]);
    // Two at once, so that one of them runs in a run worker started for it,
    // whose Repo is still making its first connection as the run ends.
    const out = await call(`
      const one = async (tag) => {
        const t0 = performance.now();
        let last;
        const url = await C.run(T, Q, { importUrl: ${WRITES}, input: { tag } }, (v) => (last = v));
        const ran = performance.now() - t0;
        // How long after the task ended the document, as written, is had through \`repo\`; null if not within 30 s.
        const arrives = async (repo) => {
          const s = performance.now();
          while (performance.now() - s < 30000) {
            const doc = await Promise.race([repo.find(url).then((h) => h.doc(), () => null), new Promise((r) => setTimeout(() => r(null), 5000))]);
            if (doc?.wrote === tag && doc.changed === true) return Math.round(performance.now() - s);
            await new Promise((r) => setTimeout(r, 500));
          }
          return null;
        };
        return { url, ran: Math.round(ran), runLog: (last?.runs?.at(-1)?.logs ?? []).map((l) => l.message), tasksRepo: await arrives(T), siteRepo: await arrives(site) };
      };
      return await Promise.all([one("seven"), one("eight")]);`, "documents tasks write", 120_000);
    const inNewRunWorker = [...workers.entries()].some(([id, w]) => kind(w.url) === "run" && !runWorkersBefore.has(id));
    report.writes = { runs: out, inNewRunWorker };
    check(
      "a document a task writes through ctx.repo reaches the page by the sync server: this tab's tasks Repo and the site's Repo both have it",
      out.every((o) => typeof o.url === "string" && o.url.startsWith("automerge:") && o.tasksRepo !== null && o.siteRepo !== null),
      report.writes,
    );
    // A run worker says nothing in the log only when the sync server has
    // acknowledged what its run wrote: not connected, a Repo that cannot say
    // what the server holds, and half a minute without the acknowledgement
    // each leave a line (run-worker.ts).
    check(
      "the run workers waited for the sync server's acknowledgement, one of them started for its run: their logs say nothing was left behind",
      inNewRunWorker && out.every((o) => !o.runLog.some((m) => /sync server/.test(m))),
      report.writes,
    );
  });

  // 8. a tool in the page: doWork asks the person's own queue, watchWork follows it, stopWork stops it
  await part("doWork from the page asks the person's own queue (watchWork follows it there), and stopWork stops it", async () => {
    const out = await js(`(async () => {
      const C = window.taskClient;
      const site = window.repo;
      const importUrl = location.origin + "/" + encodeURIComponent(${J(pkg)}) + "/dist/tasks/wait.js";
      const follow = (key) => { const states = []; const stop = C.watchWork(site, key, (v) => { if (states.at(-1) !== v.state) states.push(v.state); }); return { states, stop }; };
      const settle = (p, ms) => Promise.race([p.then((value) => ({ value }), (e) => ({ error: e.message })), new Promise((r) => setTimeout(() => r({ error: "no answer in " + ms + " ms" }), ms))]);

      const key = "probe-do-" + Date.now();
      const watched = follow(key);
      const heard = [];
      const done = await settle(C.doWork(site, { importUrl, input: { ms: 1500, value: "done" }, key }, { onProgress: (v) => heard.push(v.state) }), 30000);
      await new Promise((r) => setTimeout(r, 1000));
      watched.stop();

      const key2 = "probe-stop-" + Date.now();
      const watched2 = follow(key2);
      const long = settle(C.doWork(site, { importUrl, input: { ms: 20000, value: "late" }, key: key2 }), 40000);
      const t0 = Date.now();
      while (!watched2.states.includes("running") && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
      const stopped = await C.stopWork(site, key2);
      const ended = await long;
      await new Promise((r) => setTimeout(r, 1000));
      watched2.stop();
      return { done, heard: [...new Set(heard)], watched: watched.states, stopped, ended, watched2: watched2.states };
    })()`, "doWork, watchWork and stopWork", 90_000);
    report.work = out;
    check(
      "doWork from the page asks the person's own queue (watchWork follows it there), and stopWork stops it",
      out.done.value === "done" && out.heard.includes("running") && out.watched.includes("running") && out.watched.includes("succeeded") &&
        out.stopped === true && typeof out.ended.error === "string" && out.watched2.includes("running") && out.watched2.at(-1) === "cancelled",
      out,
    );
  });
} catch (err) {
  check("probe ran", false, String(err?.stack ?? err));
}
check("no errors from the task system in the page", pageErrors.length === 0, pageErrors.slice(0, 10));
check("no errors in the task system's workers (the pool worker, the run workers, and any they start)", workerErrors.length === 0, workerErrors.slice(0, 10));
report.otherErrors = { page: otherPageErrors.slice(0, 20), workers: otherWorkerErrors.slice(0, 20) };
report.workers = [...workers.values()].map((w) => ({ path: new URL(w.url).pathname.split("/").slice(-1)[0], kind: kind(w.url), lived: w.gone ? w.gone - w.at : null }));
if (process.argv.includes("--debug")) report.pageLogs = b.logs.filter((l) => /task|pool|worker|module|error|exception/i.test(l)).slice(-80).map((l) => l.slice(0, 300));
console.log(J({ ...report, checks: list.checks, details: list.details }, null, 2));
b.stop(list.failed ? 1 : 0);
