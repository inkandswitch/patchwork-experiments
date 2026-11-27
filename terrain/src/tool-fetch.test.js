// The Terrain tool's Fetch data, through the task client's doWork, watchWork,
// stopWork and inSamePackage (a stand-in registered as the library
// "tasks-next": the real client's own tests are the tasks package's), on a
// page with the stand-in Repo: what it says where the Tasks package is not
// installed and that it carries on when it arrives, what it asks for and
// under which key, what a person sees while it waits for and runs on their
// own machines, Cancel, a rejection shown as written, a fetch already under
// way being shown instead of offered again, and where the task's code is.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { FakeRepo } from "./test/fake-repo.js";
import { terrainDoc } from "./test/fixture.js";
import { fetchSpec, fetchKey } from "./fetch-spec.js";
import { MOVED, STAGES } from "./fetch-task.js";

const calls = { doWork: [], watch: [], stop: [] };
const PKG = "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P";
const client = {
  // a package's file, by the package's url, for a module loaded from https://site.example/<package>/…
  inSamePackage: (here, path) => (here.startsWith("https://site.example/") ? `/${encodeURIComponent(PKG)}/${path}` : null),
  doWork: (repo, request, options) =>
    new Promise((resolve, reject) => {
      calls.doWork.push({ repo, request, options, resolve, reject });
      options.signal?.addEventListener("abort", () => reject(new Error("The task was cancelled")));
    }),
  watchWork: (repo, key, onChange) => {
    const call = { repo, key, onChange, stopped: false };
    calls.watch.push(call);
    return () => (call.stopped = true);
  },
  stopWork: async (repo, key) => {
    calls.stop.push({ repo, key });
    return true;
  },
};
const libraries = getRegistry("patchwork:library");
const installTasks = () => libraries.register({ type: "patchwork:library", id: "tasks-next", name: "Tasks client (stand-in)", load: async () => client }, "https://site.example/tasks/dist/index.js");

const { default: TerrainTool, fetchTaskUrl, NOT_FROM_A_PACKAGE, NO_TASKS } = await import("./tool.js");

const TASK = "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P";
const view = (more) => ({ key: "k", state: "running", taskUrl: TASK, importUrl: "x", input: null, progress: null, logs: [], result: undefined, error: null, runs: [], ...more });
const lines = (...messages) => messages.map((message) => ({ timestampMillis: 0, message }));
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  calls.doWork.length = calls.watch.length = calls.stop.length = 0;
  installTasks();
  // the map is drawn on a canvas, which this page has no 2D context for
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ data: { set() {} } }) });
});
afterEach(() => {
  document.body.innerHTML = "";
  libraries.remove("tasks-next");
});

/** The tool mounted on a Terrain doc with no data, once it has the task client. */
async function mounted(Tool = TerrainTool) {
  const repo = new FakeRepo();
  const doc = terrainDoc();
  doc.data = null;
  const handle = repo.add(doc);
  const element = document.createElement("div");
  element.repo = repo;
  document.body.append(element);
  const unmount = Tool(handle, element);
  const $ = (s) => element.querySelector(s);
  await settle();
  return { repo, handle, element, unmount, $, fetchButton: $(".fetch"), cancelButton: $(".cancel") };
}

describe("Fetch data", () => {
  it("where the Tasks package is not installed, says so, asks and follows nothing, and carries on when it arrives", async () => {
    libraries.remove("tasks-next");
    const { $, fetchButton } = await mounted();
    expect($(".where").hidden).toBe(false);
    expect($(".where").textContent).toBe(NO_TASKS);
    expect(fetchButton.disabled).toBe(true);
    fetchButton.click();
    await settle();
    expect(calls.doWork).toHaveLength(0);
    expect(calls.watch).toHaveLength(0);
    installTasks();
    await settle();
    expect($(".where").hidden).toBe(true);
    expect(fetchButton.disabled).toBe(false);
    expect(calls.watch).toHaveLength(1);
    fetchButton.click();
    await settle();
    expect(calls.doWork).toHaveLength(1);
  });

  it("asks doWork for this package's fetch task, with the doc's url as input, under the doc's key", async () => {
    const { repo, handle, fetchButton } = await mounted();
    fetchButton.click();
    await settle();
    expect(calls.doWork).toHaveLength(1);
    const { request, repo: asked } = calls.doWork[0];
    expect(asked).toBe(repo);
    const spec = fetchSpec(handle.doc());
    expect(request).toEqual({ importUrl: fetchTaskUrl(client), input: { terrain: handle.url, spec }, key: fetchKey(handle.url, spec) });
    expect(request.importUrl).toMatch(/\/src\/fetch-task\.js$/);
  });

  it("asked of the person's own queue: shows its log and stage, says closing this does not stop it, offers Cancel, and when done shows the last line", async () => {
    const { $, fetchButton, cancelButton } = await mounted();
    expect(cancelButton.hidden).toBe(true);
    fetchButton.click();
    await settle();
    const { options, resolve } = calls.doWork[0];
    options.onProgress(view({ progress: STAGES.fetching, logs: lines("Asking NCEI for 65 × 65 heights…") }));
    expect(fetchButton.disabled).toBe(true);
    expect(fetchButton.textContent).toBe("Fetching…");
    expect(cancelButton.hidden).toBe(false);
    expect($(".where").hidden).toBe(false);
    expect($(".where").textContent).toBe(`${STAGES.fetching} On your own machines: closing this does not stop it.`);
    expect($(".log").textContent).toBe("Asking NCEI for 65 × 65 heights…");
    options.onProgress(view({ state: "succeeded", logs: lines("Asking NCEI for 65 × 65 heights…", "Storing…", "Done: 2 coastline ways") }));
    resolve({ stored: true, message: "Done: 2 coastline ways" });
    await settle();
    expect($(".log").textContent).toBe("Asking NCEI for 65 × 65 heights…\nStoring…\nDone: 2 coastline ways");
    expect($(".where").hidden).toBe(true);
    expect(cancelButton.hidden).toBe(true);
    expect(fetchButton.disabled).toBe(false);
  });

  it("waiting: says it waits for one of the person's machines", async () => {
    const { $, fetchButton } = await mounted();
    fetchButton.click();
    await settle();
    calls.doWork[0].options.onProgress(view({ state: "waiting" }));
    expect($(".where").textContent).toBe("Waiting for one of your machines to take it up… On your own machines: closing this does not stop it.");
  });

  it("a rejection of doWork (no queue could be had) is shown as written, and nothing is under way", async () => {
    const { $, fetchButton, cancelButton } = await mounted();
    fetchButton.click();
    await settle();
    calls.doWork[0].reject(new Error("This page has nowhere to keep your task queues, so nothing was changed."));
    await settle();
    expect($(".log").textContent).toBe("This page has nowhere to keep your task queues, so nothing was changed.");
    expect($(".log").dataset.state).toBe("error");
    expect(cancelButton.hidden).toBe(true);
    expect(fetchButton.disabled).toBe(false);
  });

  it("a copy not loaded from a package (built, served from anywhere else): Fetch data says it cannot be asked of the queue, and asks nothing", async () => {
    vi.stubEnv("PROD", true);
    vi.resetModules();
    try {
      const { default: BuiltTool } = await import("./tool.js");
      const { $, fetchButton } = await mounted(BuiltTool);
      fetchButton.click();
      await settle();
      expect(calls.doWork).toHaveLength(0);
      expect($(".log").textContent).toBe(NOT_FROM_A_PACKAGE);
      expect($(".log").dataset.state).toBe("error");
      expect(fetchButton.disabled).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("Cancel aborts the work's signal, and the tool says it stopped", async () => {
    const { $, fetchButton, cancelButton } = await mounted();
    fetchButton.click();
    await settle();
    cancelButton.click();
    expect(calls.doWork[0].options.signal.aborted).toBe(true);
    await settle();
    expect($(".log").textContent).toBe("Stopped.");
    expect($(".log").dataset.state).toBe("error");
    expect(cancelButton.hidden).toBe(true);
  });

  it("stopped from another page (its task ended cancelled): says it stopped, in words a person reads", async () => {
    const { $, fetchButton } = await mounted();
    fetchButton.click();
    await settle();
    calls.doWork[0].options.onProgress(view({ state: "cancelled" }));
    calls.doWork[0].reject(new Error("The task was cancelled"));
    await settle();
    expect($(".log").textContent).toBe("Stopped.");
  });

  it("a fetch that failed shows its message", async () => {
    const { $, fetchButton } = await mounted();
    fetchButton.click();
    await settle();
    calls.doWork[0].reject(new Error("NCEI answered 500"));
    await settle();
    expect($(".log").textContent).toBe("NCEI answered 500");
    expect($(".log").dataset.state).toBe("error");
  });

  it("a fetch whose frame moved meanwhile shows that nothing was stored", async () => {
    const { $, fetchButton } = await mounted();
    fetchButton.click();
    await settle();
    calls.doWork[0].resolve({ stored: false, message: MOVED });
    await settle();
    expect($(".log").textContent).toBe(MOVED);
  });

  it("pressing Fetch again while it runs asks nothing more", async () => {
    const { fetchButton } = await mounted();
    fetchButton.click();
    await settle();
    fetchButton.disabled = false;
    fetchButton.click();
    await settle();
    expect(calls.doWork).toHaveLength(1);
  });

  it("closing the tool leaves the fetch going: it is on the person's queue, asked or still being asked", async () => {
    const asking = await mounted();
    asking.fetchButton.click();
    await settle();
    asking.unmount();
    expect(calls.doWork[0].options.signal.aborted).toBe(false);

    const asked = await mounted();
    asked.fetchButton.click();
    await settle();
    calls.doWork[1].options.onProgress(view({}));
    asked.unmount();
    expect(calls.doWork[1].options.signal.aborted).toBe(false);
  });
});

describe("a fetch already under way", () => {
  it("is followed under this doc's key with watchWork from the start, shown instead of offered again, and Cancel stops it by its key", async () => {
    const { repo, handle, $, fetchButton, cancelButton } = await mounted();
    expect(calls.watch).toHaveLength(1);
    const key = fetchKey(handle.url, fetchSpec(handle.doc()));
    expect(calls.watch[0]).toMatchObject({ repo, key });
    calls.watch[0].onChange(view({ key, state: "missing", taskUrl: null }));
    expect(fetchButton.disabled).toBe(false);
    calls.watch[0].onChange(view({ key, taskUrl: "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P", progress: STAGES.fetching, logs: lines("Asking NCEI for 65 × 65 heights…") }));
    expect(fetchButton.disabled).toBe(true);
    expect(cancelButton.hidden).toBe(false);
    expect($(".where").textContent).toBe(`${STAGES.fetching} On your own machines: closing this does not stop it.`);
    expect($(".log").textContent).toBe("Asking NCEI for 65 × 65 heights…");
    cancelButton.click();
    expect(calls.stop).toEqual([{ repo, key }]);
    calls.watch[0].onChange(view({ key, state: "cancelled", taskUrl: "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P" }));
    expect(fetchButton.disabled).toBe(false);
    expect(cancelButton.hidden).toBe(true);
  });

  it("follows the key the doc names now: a changed frame is another fetch, and a change elsewhere in the doc is not", async () => {
    const { handle } = await mounted();
    await settle();
    handle.change((d) => (d.title = "Renamed"));
    await settle();
    expect(calls.watch).toHaveLength(1);
    handle.change((d) => (d.grid.x0 += 8));
    await settle();
    expect(calls.watch).toHaveLength(2);
    expect(calls.watch[0].stopped).toBe(true);
    expect(calls.watch[1].key).toBe(fetchKey(handle.url, fetchSpec(handle.doc())));
  });

  it("a fetch this tool started is shown from its own progress, not twice", async () => {
    const { $, fetchButton } = await mounted();
    await settle();
    fetchButton.click();
    await settle();
    calls.doWork[0].options.onProgress(view({ taskUrl: "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P", logs: lines("mine") }));
    calls.watch[0].onChange(view({ taskUrl: "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P", logs: lines("seen by the watcher") }));
    expect($(".log").textContent).toBe("mine");
  });

  it("a doc whose data does not say what it was fetched for, with credits at its root, reads as having no data", async () => {
    const repo = new FakeRepo();
    const doc = terrainDoc();
    expect(doc.data.request).toBeUndefined();
    expect(doc.sources).toBeTruthy();
    const handle = repo.add(doc);
    const element = document.createElement("div");
    element.repo = repo;
    document.body.append(element);
    const unmount = TerrainTool(handle, element);
    const $ = (s) => element.querySelector(s);
    expect($(".status").textContent).toMatch(/^No data yet\./);
    expect($(".status").dataset.state).toBe("");
    expect($(".fetch").textContent).toBe("Fetch data");
    expect($(".empty").hidden).toBe(false);
    expect($(".attribution").textContent).toBe("");
    unmount();
  });

  it("closing the tool stops following", async () => {
    const { unmount } = await mounted();
    await settle();
    unmount();
    expect(calls.watch[0].stopped).toBe(true);
  });
});

describe("where the fetch task's code is (the client's inSamePackage stood in for)", () => {
  const inPackage = (path) => `https://site.example/${encodeURIComponent(PKG)}/${path}`;
  it("built, in a package: the package's dist/fetch-task.js, as inSamePackage names it", () => {
    expect(fetchTaskUrl(client, inPackage("dist/assets/tool-1234.js"), true)).toBe(`/${encodeURIComponent(PKG)}/dist/fetch-task.js`);
  });
  it("unbuilt, in a package: its src/fetch-task.js", () => {
    expect(fetchTaskUrl(client, inPackage("src/tool.js"), false)).toBe(`/${encodeURIComponent(PKG)}/src/fetch-task.js`);
  });
  it("unbuilt, anywhere else: the file beside this one", () => {
    expect(fetchTaskUrl(client, "file:///x/terrain/src/tool.js", false)).toBe("file:///x/terrain/src/fetch-task.js");
    expect(fetchTaskUrl(client, "http://localhost:5173/src/tool.js", false)).toBe("http://localhost:5173/src/fetch-task.js");
  });
  it("built, not in a package: unknown, so Fetch data cannot be asked", () => {
    expect(fetchTaskUrl(client, "http://localhost:4173/dist/assets/tool-1234.js", true)).toBeNull();
  });
});
