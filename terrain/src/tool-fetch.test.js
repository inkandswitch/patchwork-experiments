// The Terrain tool's Fetch data, through the task system's doWork, watchWork
// and stopWork (stood in for: their own tests are the tasks package's), on a
// page with the stand-in Repo: what it asks for and under which key, what a
// person sees while it runs here or on their own machines, Cancel, a fetch
// already under way being shown instead of offered again, and where the
// task's code is.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeRepo } from "./test/fake-repo.js";
import { terrainDoc } from "./test/fixture.js";
import { fetchSpec, fetchKey } from "./fetch-spec.js";
import { MOVED, STAGES } from "./fetch-task.js";

const calls = vi.hoisted(() => ({ doWork: [], watch: [], stop: [] }));
vi.mock("./task-client.js", async (importOriginal) => ({
  ...(await importOriginal()),
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
}));

const { default: TerrainTool, fetchTaskUrl } = await import("./tool.js");

const view = (more) => ({ key: "k", state: "running", taskUrl: null, importUrl: "x", input: null, progress: null, logs: [], result: undefined, error: null, runs: [], ...more });
const lines = (...messages) => messages.map((message) => ({ timestampMillis: 0, message }));
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  calls.doWork.length = calls.watch.length = calls.stop.length = 0;
  // the map is drawn on a canvas, which this page has no 2D context for
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ data: { set() {} } }) });
});
afterEach(() => {
  document.body.innerHTML = "";
});

/** The tool mounted on a Terrain doc with no data. */
function mounted() {
  const repo = new FakeRepo();
  const doc = terrainDoc();
  doc.data = null;
  const handle = repo.add(doc);
  const element = document.createElement("div");
  element.repo = repo;
  document.body.append(element);
  const unmount = TerrainTool(handle, element);
  const $ = (s) => element.querySelector(s);
  return { repo, handle, element, unmount, $, fetchButton: $(".fetch"), cancelButton: $(".cancel") };
}

describe("Fetch data", () => {
  it("asks doWork for this package's fetch task, with the doc's url as input, under the doc's key", async () => {
    const { repo, handle, fetchButton } = mounted();
    fetchButton.click();
    await settle();
    expect(calls.doWork).toHaveLength(1);
    const { request, repo: asked } = calls.doWork[0];
    expect(asked).toBe(repo);
    const spec = fetchSpec(handle.doc());
    expect(request).toEqual({ importUrl: fetchTaskUrl(), input: { terrain: handle.url, spec }, key: fetchKey(handle.url, spec) });
    expect(request.importUrl).toMatch(/\/src\/fetch-task\.js$/);
  });

  it("done in this page: shows its log and stage, says it is running here, offers Cancel, and when done shows the last line", async () => {
    const { $, fetchButton, cancelButton } = mounted();
    expect(cancelButton.hidden).toBe(true);
    fetchButton.click();
    await settle();
    const { options, resolve } = calls.doWork[0];
    options.onProgress(view({ progress: STAGES.fetching, logs: lines("Asking NCEI for 65 × 65 heights…") }));
    expect(fetchButton.disabled).toBe(true);
    expect(fetchButton.textContent).toBe("Fetching…");
    expect(cancelButton.hidden).toBe(false);
    expect($(".where").hidden).toBe(false);
    expect($(".where").textContent).toBe(`${STAGES.fetching} In this page: closing it stops the fetch.`);
    expect($(".log").textContent).toBe("Asking NCEI for 65 × 65 heights…");
    options.onProgress(view({ state: "succeeded", logs: lines("Asking NCEI for 65 × 65 heights…", "Storing…", "Done: 2 coastline ways") }));
    resolve({ stored: true, message: "Done: 2 coastline ways" });
    await settle();
    expect($(".log").textContent).toBe("Asking NCEI for 65 × 65 heights…\nStoring…\nDone: 2 coastline ways");
    expect($(".where").hidden).toBe(true);
    expect(cancelButton.hidden).toBe(true);
    expect(fetchButton.disabled).toBe(false);
  });

  it("asked of the person's own queue: says closing this does not stop it", async () => {
    const { $, fetchButton } = mounted();
    fetchButton.click();
    await settle();
    calls.doWork[0].options.onProgress(view({ taskUrl: "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P", progress: STAGES.storing }));
    expect($(".where").textContent).toBe(`${STAGES.storing} On your own machines: closing this does not stop it.`);
    calls.doWork[0].options.onProgress(view({ taskUrl: "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P", state: "waiting" }));
    expect($(".where").textContent).toBe("Waiting for one of your machines to take it up… On your own machines: closing this does not stop it.");
  });

  it("Cancel aborts the work's signal, and the tool says it stopped", async () => {
    const { $, fetchButton, cancelButton } = mounted();
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
    const { $, fetchButton } = mounted();
    fetchButton.click();
    await settle();
    calls.doWork[0].options.onProgress(view({ taskUrl: "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P", state: "cancelled" }));
    calls.doWork[0].reject(new Error("The task was cancelled"));
    await settle();
    expect($(".log").textContent).toBe("Stopped.");
  });

  it("a fetch that failed shows its message", async () => {
    const { $, fetchButton } = mounted();
    fetchButton.click();
    await settle();
    calls.doWork[0].reject(new Error("NCEI answered 500"));
    await settle();
    expect($(".log").textContent).toBe("NCEI answered 500");
    expect($(".log").dataset.state).toBe("error");
  });

  it("a fetch whose frame moved meanwhile shows that nothing was stored", async () => {
    const { $, fetchButton } = mounted();
    fetchButton.click();
    await settle();
    calls.doWork[0].resolve({ stored: false, message: MOVED });
    await settle();
    expect($(".log").textContent).toBe(MOVED);
  });

  it("pressing Fetch again while it runs asks nothing more", async () => {
    const { fetchButton } = mounted();
    fetchButton.click();
    await settle();
    fetchButton.disabled = false;
    fetchButton.click();
    await settle();
    expect(calls.doWork).toHaveLength(1);
  });

  it("closing the tool stops work done in this page, and leaves work on the person's queue going", async () => {
    const here = mounted();
    here.fetchButton.click();
    await settle();
    here.unmount();
    expect(calls.doWork[0].options.signal.aborted).toBe(true);

    const asked = mounted();
    asked.fetchButton.click();
    await settle();
    calls.doWork[1].options.onProgress(view({ taskUrl: "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P" }));
    asked.unmount();
    expect(calls.doWork[1].options.signal.aborted).toBe(false);
  });
});

describe("a fetch already under way", () => {
  it("is followed under this doc's key with watchWork from the start, shown instead of offered again, and Cancel stops it by its key", async () => {
    const { repo, handle, $, fetchButton, cancelButton } = mounted();
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
    const { handle } = mounted();
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
    const { $, fetchButton } = mounted();
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
    const { unmount } = mounted();
    await settle();
    unmount();
    expect(calls.watch[0].stopped).toBe(true);
  });
});

describe("where the fetch task's code is", () => {
  const PKG = "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P";
  const inPackage = (path) => `https://site.example/${encodeURIComponent(`${PKG}#abc`)}/${path}`;
  it("built, in a package: the package's dist/fetch-task.js, by the package's url and its heads, with no origin", () => {
    expect(fetchTaskUrl(inPackage("dist/assets/tool-1234.js"), true)).toBe(`/${encodeURIComponent(`${PKG}#abc`)}/dist/fetch-task.js`);
  });
  it("unbuilt, in a package: its src/fetch-task.js", () => {
    expect(fetchTaskUrl(inPackage("src/tool.js"), false)).toBe(`/${encodeURIComponent(`${PKG}#abc`)}/src/fetch-task.js`);
  });
  it("unbuilt, anywhere else: the file beside this one", () => {
    expect(fetchTaskUrl("file:///x/terrain/src/tool.js", false)).toBe("file:///x/terrain/src/fetch-task.js");
    expect(fetchTaskUrl("http://localhost:5173/src/tool.js", false)).toBe("http://localhost:5173/src/fetch-task.js");
  });
  it("built, not in a package: unknown, so the tool does the work itself", () => {
    expect(fetchTaskUrl("http://localhost:4173/dist/assets/tool-1234.js", true)).toBeNull();
  });
});
