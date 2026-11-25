// The TTS import tool's drop, through the task system's doWork, watchWork
// and stopWork (stood in for: their own tests are the tasks package's), on a page with
// the stand-in Repo: what a drop keeps and asks for, under which key; what
// a person sees while it runs here or on their own machines; Cancel; closing
// the tool; an import asked from elsewhere followed and not offered again;
// an import that nothing is doing shown as interrupted, with the drop zone
// and Import again; and where the task's code is.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { FakeRepo } from "../test/fake-repo.js";
import { source } from "./importer.js";
import { TtsImportDatatype } from "./datatype.js";
import { importAsk, importRequest } from "./request.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { LINES } from "./status.js";

const calls = vi.hoisted(() => ({ doWork: [], watch: [], stop: [] }));
vi.mock("../kit/task-client.js", async (importOriginal) => ({
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

const { default: TtsImportTool, importTaskUrl, callHere } = await import("./tool.js");

// the tiny fixture mod (fixtures/tiny-mod) as sources; test/fixture.js finds it by import.meta.url, which this page's environment does not give as a file
const FIXTURE = join(process.cwd(), "fixtures/tiny-mod");
function fixtureSources({ without = [] } = {}) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (!without.some((w) => p.includes(w)) && name !== "README.md") out.push(source(relative(FIXTURE, p), statSync(p).size, async () => new Uint8Array(readFileSync(p))));
    }
  };
  walk(FIXTURE);
  return out;
}

const TASK = "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P";
const view = (more) => ({ key: "k", state: "running", taskUrl: null, importUrl: "x", input: null, progress: null, logs: [], result: undefined, error: null, runs: [], ...more });
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  calls.doWork.length = calls.watch.length = calls.stop.length = 0;
});
afterEach(() => {
  document.body.innerHTML = "";
});

/** The tool mounted on an import doc (with `seed`). */
function mounted({ seed = {} } = {}) {
  const repo = new FakeRepo();
  const doc = { "@patchwork": { type: "tts-import" } };
  TtsImportDatatype.init(doc);
  const handle = repo.add({ ...doc, ...seed });
  const element = document.createElement("div");
  element.repo = repo;
  document.body.append(element);
  const unmount = TtsImportTool(handle, element);
  const $ = (s) => element.querySelector(s);
  const text = () => element.querySelector(".tts-import").textContent;
  return { repo, handle, element, unmount, $, text };
}

/** The fixture mod dropped on the tool, as files with their folder paths. */
function drop(element, { without = [] } = {}) {
  const files = fixtureSources({ without }).map((s) => {
    const f = new File([readFileSync(`${FIXTURE}/${s.path}`)], s.path.split("/").pop());
    Object.defineProperty(f, "webkitRelativePath", { value: s.path });
    return f;
  });
  const e = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], items: [], files } });
  element.querySelector(".tts-import").dispatchEvent(e);
}

describe("dropping a mod", () => {
  it("keeps the save and its files as file docs, asks for them on the doc, and asks doWork for this package's import task under the doc's key", async () => {
    const { repo, handle, element } = mounted();
    drop(element);
    await settle();
    const request = handle.doc().request;
    expect(request.files.map((f) => f.path)[0]).toBe("Workshop/1234567890.json");
    expect(request.files).toHaveLength(9);
    for (const f of request.files) expect(repo.handles.get(f.url).doc()["@patchwork"].type).toBe("file");
    expect(request.settings).toEqual(DEFAULT_SETTINGS);
    expect(request).toEqual(await importRequest(request.files, DEFAULT_SETTINGS));
    expect(calls.doWork).toHaveLength(1);
    const { input, key } = importAsk(handle.url, request);
    expect(calls.doWork[0].repo).toBe(repo);
    expect(calls.doWork[0].request).toEqual({ importUrl: importTaskUrl(), input, key });
    expect(calls.doWork[0].request.importUrl).toMatch(/\/src\/tts\/import-task\.js$/);
    // nothing on the doc says it is importing: only the request, and later the outcome
    expect(handle.doc().imported).toBeNull();
    expect(Object.keys(handle.doc()).sort()).toEqual(["@patchwork", "games", "imported", "request", "settings", "title"]);
  });

  it("done in this page: shows the stage, says it runs here, offers Cancel and no drop zone; when the outcome comes, the report", async () => {
    const { handle, element, $, text } = mounted();
    drop(element);
    await settle();
    const { options, resolve } = calls.doWork[0];
    options.onProgress(view({ progress: { phase: "Storing assets", done: 3, total: 8 } }));
    expect($(".progress .phase").textContent).toBe("Storing assets: 3 of 8");
    expect($(".where").textContent).toBe("In this page: closing it stops the import.");
    expect($("button.cancel")).toBeTruthy();
    expect($(".drop")).toBeNull();
    expect($(".pill").textContent).toBe("importing");
    // the work writes its outcome, and ends
    const report = { mod: { saveName: "Tiny Test Mod", objects: 17 }, counts: { assets: {} }, assets: {}, warnings: [] };
    handle.change((d) => (d.imported = { id: d.request.id, gameUrl: "automerge:game", report }));
    options.onProgress(view({ state: "succeeded", result: { imported: true, gameUrl: "automerge:game", message: "Imported" } }));
    resolve({ imported: true, gameUrl: "automerge:game", message: "Imported" });
    await settle();
    expect($(".pill").textContent).toBe("imported");
    expect(text()).toContain("Tiny Test Mod");
    expect($("button.primary").textContent).toBe("Open the game");
    expect($(".drop")).toBeTruthy();
    expect($(".progress")).toBeNull();
  });

  it("asked of the person's own queue: says closing this does not stop it, and that it waits for a machine", async () => {
    const { element, $ } = mounted();
    drop(element);
    await settle();
    calls.doWork[0].options.onProgress(view({ taskUrl: TASK, state: "waiting" }));
    expect($(".progress .phase").textContent).toBe(LINES.waiting);
    expect($(".where").textContent).toBe("On your own machines: closing this does not stop it.");
    calls.doWork[0].options.onProgress(view({ taskUrl: TASK, progress: { phase: "Translating the game", done: 0, total: 0 } }));
    expect($(".progress .phase").textContent).toBe("Translating the game");
  });

  it("Cancel aborts the work's signal; the tool says it stopped and offers the drop zone and Import again", async () => {
    const { element, $ } = mounted();
    drop(element);
    await settle();
    calls.doWork[0].options.onProgress(view({}));
    $("button.cancel").click();
    expect(calls.doWork[0].options.signal.aborted).toBe(true);
    await settle();
    expect($(".pill").textContent).toBe("stopped");
    expect($(".note").textContent).toBe(LINES.stopped);
    expect($(".drop")).toBeTruthy();
    expect($("button.again").textContent).toBe("Import again");
  });

  it("stopped from another page (its task ended cancelled): says it stopped", async () => {
    const { element, $ } = mounted();
    drop(element);
    await settle();
    calls.doWork[0].options.onProgress(view({ taskUrl: TASK, state: "cancelled" }));
    calls.doWork[0].reject(new Error("The task was cancelled"));
    await settle();
    expect($(".note").textContent).toBe(LINES.stopped);
  });

  it("an import that failed shows its message", async () => {
    const { element, $ } = mounted();
    drop(element);
    await settle();
    calls.doWork[0].options.onProgress(view({ state: "failed", error: "A file kept from the drop could not be opened: drop the mod again." }));
    calls.doWork[0].reject(new Error("A file kept from the drop could not be opened: drop the mod again."));
    await settle();
    expect($(".error").textContent).toBe("A file kept from the drop could not be opened: drop the mod again.");
    expect($(".drop")).toBeTruthy();
  });

  it("a drop with no save keeps nothing, asks nothing, and says what to drop", async () => {
    const { repo, handle, element, $ } = mounted();
    drop(element, { without: [".json"] });
    await settle();
    expect($(".error").textContent).toMatch(/^No Tabletop Simulator save found/);
    expect(handle.doc().request).toBeNull();
    expect(repo.created).toEqual([]);
    expect(calls.doWork).toEqual([]);
  });

  it("a drop while it imports asks nothing more", async () => {
    const { element } = mounted();
    drop(element);
    await settle();
    drop(element);
    await settle();
    expect(calls.doWork).toHaveLength(1);
  });

  it("closing the tool stops work done in this page, and leaves work on the person's queue going", async () => {
    const here = mounted();
    drop(here.element);
    await settle();
    here.unmount();
    expect(calls.doWork[0].options.signal.aborted).toBe(true);

    const asked = mounted();
    drop(asked.element);
    await settle();
    calls.doWork[1].options.onProgress(view({ taskUrl: TASK }));
    asked.unmount();
    expect(calls.doWork[1].options.signal.aborted).toBe(false);
  });
});

describe("an import asked earlier", () => {
  let request;
  beforeAll(async () => {
    request = await importRequest([{ path: "Workshop/1.json", url: "automerge:f", size: 1 }], DEFAULT_SETTINGS);
  });

  it("with no outcome and no work known under its key (watchWork says missing): interrupted, with the drop zone and Import again", async () => {
    const { handle, $ } = mounted({ seed: { request } });
    expect(calls.watch).toHaveLength(1);
    calls.watch[0].onChange(view({ key: importAsk(handle.url, request).key, state: "missing" }));
    await settle();
    expect($(".pill").textContent).toBe("interrupted");
    expect($(".note").textContent).toBe(LINES.interrupted);
    expect($(".drop")).toBeTruthy();
    $("button.again").click();
    await settle();
    // the same files with the same settings: the same request, under the same key
    expect(calls.doWork).toHaveLength(1);
    expect(calls.doWork[0].request.key).toBe(importAsk(calls.doWork[0].request.input.import, request).key);
    expect(calls.doWork[0].request.input.request).toEqual(request);
  });

  it("is followed under its key with watchWork: shown, not offered again, and Cancel stops it by its key", async () => {
    const { repo, handle, $ } = mounted({ seed: { request } });
    // still finding out (watchWork reports within the lapse): neither offered nor said to be interrupted
    expect($(".pill").textContent).toBe("…");
    expect($(".drop")).toBeNull();
    await settle();
    expect(calls.watch).toHaveLength(1);
    const { key } = importAsk(handle.url, request);
    expect(calls.watch[0]).toMatchObject({ repo, key });
    calls.watch[0].onChange(view({ key, taskUrl: TASK, progress: { phase: "Finding assets", done: 2, total: 9 } }));
    expect($(".pill").textContent).toBe("importing");
    expect($(".drop")).toBeNull();
    expect($(".progress .phase").textContent).toBe("Finding assets: 2 of 9");
    expect($(".where").textContent).toBe("On your own machines: closing this does not stop it.");
    $("button.cancel").click();
    expect(calls.stop).toEqual([{ repo, key }]);
    calls.watch[0].onChange(view({ key, state: "cancelled", taskUrl: TASK }));
    expect($(".pill").textContent).toBe("stopped");
    expect($(".drop")).toBeTruthy();
  });

  it("work followed under its key that comes to be known no more (missing, as when the person's queue changes): interrupted, not the old view", async () => {
    const { handle, $ } = mounted({ seed: { request } });
    await settle();
    calls.watch[0].onChange(view({ key: importAsk(handle.url, request).key, taskUrl: TASK }));
    expect($(".pill").textContent).toBe("importing");
    calls.watch[0].onChange(view({ key: importAsk(handle.url, request).key, state: "missing" }));
    expect($(".pill").textContent).toBe("interrupted");
  });

  it("whose key names no task on the person's queue: interrupted", async () => {
    const { handle, $ } = mounted({ seed: { request } });
    await settle();
    calls.watch[0].onChange(view({ key: importAsk(handle.url, request).key, state: "missing" }));
    expect($(".pill").textContent).toBe("interrupted");
  });

  it("a drop made here is shown from its own progress, and the followed key changes with the request", async () => {
    const { handle, element, $ } = mounted();
    await settle();
    expect(calls.watch).toEqual([]);
    drop(element);
    await settle();
    expect(calls.watch).toHaveLength(1);
    expect(calls.watch[0].key).toBe(importAsk(handle.url, handle.doc().request).key);
    calls.doWork[0].options.onProgress(view({ taskUrl: TASK, progress: { phase: "mine", done: 0, total: 0 } }));
    calls.watch[0].onChange(view({ taskUrl: TASK, progress: { phase: "seen by the watcher", done: 0, total: 0 } }));
    expect($(".progress .phase").textContent).toBe("mine");
  });

  it("closing the tool stops following", async () => {
    const { unmount } = mounted({ seed: { request } });
    await settle();
    unmount();
    expect(calls.watch[0].stopped).toBe(true);
  });

  it("done, with other settings now: offers Import again with these settings, with the kept files", async () => {
    const { handle, $ } = mounted({ seed: { request, imported: { id: request.id, gameUrl: "automerge:g", report: { mod: {}, counts: {} } }, games: ["automerge:g"] } });
    await settle();
    expect($("button.again")).toBeNull();
    handle.change((d) => (d.settings.includeContents = false));
    await settle();
    $("button.again").click();
    await settle();
    expect(calls.doWork[0].request.input.request).toEqual(await importRequest(request.files, { ...DEFAULT_SETTINGS, includeContents: false }));
    expect(handle.doc().request.settings.includeContents).toBe(false);
  });
});

describe("where the import task's code is", () => {
  const PKG = "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P";
  const inPackage = (path) => `https://site.example/${encodeURIComponent(`${PKG}#abc`)}/${path}`;
  it("built, in a package: the package's dist/import-task.js, by the package's url and its heads, with no origin", () => {
    expect(importTaskUrl(inPackage("dist/assets/tool-1234.js"), true)).toBe(`/${encodeURIComponent(`${PKG}#abc`)}/dist/import-task.js`);
  });
  it("unbuilt, in a package: its src/tts/import-task.js", () => {
    expect(importTaskUrl(inPackage("src/tts/tool.js"), false)).toBe(`/${encodeURIComponent(`${PKG}#abc`)}/src/tts/import-task.js`);
  });
  it("unbuilt, anywhere else: the file beside this one", () => {
    expect(importTaskUrl("file:///x/tabletop/src/tts/tool.js", false)).toBe("file:///x/tabletop/src/tts/import-task.js");
  });
  it("built, not in a package: unknown, so the tool calls it itself", () => {
    expect(importTaskUrl("http://localhost:4173/dist/assets/tool-1234.js", true)).toBeNull();
  });
});

describe("called here, with no url to import it by", () => {
  async function askedRepo() {
    const repo = new FakeRepo();
    const { storeDropped } = await import("./dropped.js");
    const files = await storeDropped(repo, fixtureSources());
    const request = await importRequest(files, DEFAULT_SETTINGS);
    const doc = repo.add({ "@patchwork": { type: "tts-import" }, title: "TTS import", settings: { ...DEFAULT_SETTINGS }, request, imported: null, games: [] });
    return { repo, doc, ...importAsk(doc.url, request) };
  }

  it("imports, with the views doWork gives for work done here", async () => {
    const { repo, doc, input, key } = await askedRepo();
    const views = [];
    const result = await callHere(repo, input, key, { onProgress: (v) => views.push(v), signal: new AbortController().signal });
    expect(result.imported).toBe(true);
    expect(doc.doc().imported.gameUrl).toBe(result.gameUrl);
    expect(views.at(-1)).toMatchObject({ key, state: "succeeded", taskUrl: null, result });
    expect(views.some((v) => v.progress?.phase === "Storing assets")).toBe(true);
    expect(Object.keys(views[0]).sort()).toEqual(["error", "importUrl", "input", "key", "logs", "progress", "result", "runs", "state", "taskUrl"]);
  });

  it("stopped: the last view says cancelled, and nothing is written", async () => {
    const { repo, doc, input, key } = await askedRepo();
    const views = [];
    const controller = new AbortController();
    controller.abort("cancelled");
    await expect(callHere(repo, input, key, { onProgress: (v) => views.push(v), signal: controller.signal })).rejects.toThrow("The task was cancelled");
    expect(views.at(-1).state).toBe("cancelled");
    expect(doc.doc().imported).toBeNull();
  });
});
