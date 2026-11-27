// The case tool in a page (happy-dom), over the fake repo: the person's
// paths to what the agent's tools do (src/agent-tools.test.js) go through
// the same model, so they agree: the speed is typed in its unit and stays the
// boat's speed when the unit changes, "Float at" floats at the trim shown,
// Run and a sweep make runs at the speeds shown, and each part says whether
// it's a closed shell. The task client is a stand-in, registered as an
// installed Tasks package would be; with none registered, the tool says it
// needs that package and carries on once it is there.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { FakeRepo } from "../../probes/fake-repo.js";
import { encodeGLB } from "../glb.js";
import { boxTriangles } from "../test/box.js";
import { initCase, CASE_TYPE } from "../protocol.js";
import { installTasks, standInTasks } from "../test/tasks-stand-in.js";
import { defaultSetup, waterProperties } from "../setup.js";
import CaseTool from "./case-tool.js";

const toGltf = (tris) => Float32Array.from(tris, (_, i) => (i % 3 === 0 ? tris[i] : i % 3 === 1 ? tris[i + 1] : -tris[i - 1]));
const cabin = Float64Array.from(boxTriangles({ open: true }), (v, i) => (i % 3 === 0 ? v * 0.5 + 1 : i % 3 === 1 ? v * 0.6 : v * 0.5 + 0.75));
const glb = encodeGLB({ meshes: [{ name: "Hull", positions: toGltf(boxTriangles()) }, { name: "Cabin", positions: toGltf(cabin) }] });
const RHO = waterProperties("salt", 15).rho;

const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
};

let repo, handle, server, el, dispose, tasks;
beforeEach(async () => {
  // a machine serving the queue, as the task client hears it
  tasks = installTasks(standInTasks({ pools: [{ name: "Test machine", slots: 2, busy: 0 }] }));
  repo = new FakeRepo();
  const hull = repo.add({ "@patchwork": { type: "file" }, name: "box.glb", extension: "glb", content: glb });
  server = repo.add({ title: "Test queue", jobs: {} });
  const doc = { "@patchwork": { type: CASE_TYPE } };
  initCase(doc, defaultSetup());
  doc.hull = { url: hull.url };
  doc.server = server.url;
  handle = repo.add(doc);
  handle.repo = repo;
  el = document.createElement("div");
  document.body.append(el);
  dispose = CaseTool(handle, el);
  // the hull is read and measured (prepare waits 120 ms)
  await until(() => el.querySelector(".run")?.disabled === false);
});
afterEach(() => {
  dispose?.();
  el.remove();
  getRegistry("patchwork:library").unregister("tasks-next");
});

const $ = (s) => el.querySelector(s);
const set = (sel, value) => {
  const input = $(sel);
  input.value = String(value);
  input.dispatchEvent(new Event("change"));
};

describe("the speed in the case tool", () => {
  it("shows the stored speed in its own unit, and stores what's typed with that unit", () => {
    expect($('[data-k="speed"]').value).toBe("6");
    expect($('[data-k="speed-unit"]').value).toBe("kn");
    set('[data-k="speed"]', 8);
    expect(handle.doc().setup.speed).toEqual({ value: 8, unit: "kn" });
    expect($(".run").textContent).toBe("Run at 8 kn");
  });
  it("keeps the boat's speed when the unit changes", () => {
    set('[data-k="speed"]', 8);
    set('[data-k="speed-unit"]', "m/s");
    expect(handle.doc().setup.speed).toEqual({ value: 4.115556, unit: "m/s" });
    expect($('[data-k="speed"]').value).toBe("4.116");
    set('[data-k="speed-unit"]', "kn");
    expect(handle.doc().setup.speed.value).toBeCloseTo(8, 5);
  });
  it("says when the stored setup doesn't read as written, and fixes it on the next change", () => {
    handle.change((d) => (d.setup.speed = 8));
    expect($(".setup-problems").hidden).toBe(false);
    expect($(".setup-problems").textContent).toContain("setup.speed is 8, which isn't a speed with a unit; it reads as 6 kn");
    set('[data-k="temperature"]', 12);
    expect(handle.doc().setup.speed).toEqual({ value: 6, unit: "kn" });
    expect($(".setup-problems").hidden).toBe(true);
  });
});

describe("floating in the case tool", () => {
  it("floats at a mass at the trim shown, and says so", () => {
    set('[data-k="trim"]', 8);
    $(".float-mass").value = String(2.5 * RHO);
    $(".float-go").click();
    expect(handle.doc().setup.attitude.trim).toBe(8);
    expect(handle.doc().setup.attitude.sinkage).toBeCloseTo(0.125 * Math.cos((8 * Math.PI) / 180), 4);
    expect($(".float-why").textContent).toMatch(/floats at sinkage 0\.12\d+ m with trim 8° and heel 0°: change either and float again/);
  });
  it("says how sinkage is measured", async () => {
    await until(() => $(".model-figures").textContent.includes("measured at x = 2.000 m"));
  });
});

describe("parts in the case tool", () => {
  it("says, once the list is opened, which parts are closed shells", async () => {
    const box = $(".hull-parts");
    expect(box.textContent).toContain("Hull: 1 of 2 parts");
    expect(box.textContent).not.toContain("closed");
    box.querySelector("details").open = true;
    box.querySelector("details").dispatchEvent(new Event("toggle"));
    await until(() => box.textContent.includes("4 open edges"));
    expect(box.textContent).toMatch(/Hull\s*12 triangles · 4\.00 × 1\.00 × 1\.00 m · meets the water · closed/);
    expect(box.textContent).toMatch(/Cabin\s*10 triangles · 2\.00 × 0\.60 × 0\.50 m · above the water · 4 open edges/);
  });
});

describe("running from the case tool", () => {
  it("Run makes a run at the speed shown", async () => {
    set('[data-k="speed"]', 7.5);
    $(".run").click();
    await until(() => handle.doc().runs.length === 1);
    const run = (await repo.find(handle.doc().runs[0])).doc();
    expect(run.setup.speed).toEqual({ value: 7.5, unit: "kn" });
    // asked of the case's queue, keyed by the run, naming this package's run code from where the model was loaded
    const runUrl = handle.doc().runs[0];
    await until(() => repo.handles.get(runUrl).doc().task);
    expect(tasks.asked).toEqual([{ queueUrl: server.url, importUrl: `/${encodeURIComponent("automerge:openfoamTestPackage")}/daemon/run-task.mjs`, input: { run: runUrl }, key: runUrl }]);
    expect(tasks.froms.at(-1)).toMatch(/\/src\/case-model\.js$/);
  });
  it("shows who serves the queue, heard", async () => {
    await until(() => /served by Test machine/.test($(".server-box").textContent));
    expect($(".server-box").textContent).toContain("Test queue");
    expect($(".server-box").textContent).toContain("idle");
  });
  it("Cancel on a waiting run cancels its task; the run reads cancelled though its doc still says queued", async () => {
    $(".run").click();
    await until(() => handle.doc().runs.length === 1 && repo.handles.get(handle.doc().runs[0]).doc().task);
    const runUrl = handle.doc().runs[0];
    await until(() => !el.querySelector(".live-host .cancel").hidden);
    el.querySelector(".live-host .cancel").click();
    await until(() => tasks.stops.length === 1);
    expect(tasks.stops).toEqual([runUrl]);
    expect(repo.handles.get(runUrl).doc().status).toBe("queued");
    // the views read it from the task: it is finished, cancelled before it started
    await until(() => /cancelled/.test($(".runs-table").textContent));
    expect($(".running-sum").textContent).toBe("nothing running");
  });
  it("a sweep's speeds are in the unit shown", async () => {
    set('[data-k="speed-unit"]', "m/s");
    expect($(".sweep").placeholder).toBe("speeds in m/s, e.g. 4, 5, 6, 7");
    $(".sweep").value = "3, 4";
    $(".run-sweep").click();
    await until(() => handle.doc().runs.length === 2);
    const speeds = await Promise.all(handle.doc().runs.map(async (u) => (await repo.find(u)).doc().setup.speed));
    expect(speeds).toEqual([
      { value: 3, unit: "m/s" },
      { value: 4, unit: "m/s" },
    ]);
  });
});

describe("without the Tasks package", () => {
  it("says the tool needs it and does nothing else; once it is installed, the tool carries on", async () => {
    getRegistry("patchwork:library").unregister("tasks-next");
    const other = document.createElement("div");
    const close = CaseTool(handle, other);
    expect(other.textContent).toBe("OpenFOAM needs the Tasks package, which is not installed here.");
    expect(other.querySelector(".openfoam")).toBeNull();
    installTasks(tasks);
    await until(() => other.querySelector(".openfoam .run"));
    expect(other.textContent).not.toContain("needs the Tasks package");
    close();
    expect(other.childNodes.length).toBe(0);
  });
  it("closed before the package arrives, mounts nothing when it does", async () => {
    getRegistry("patchwork:library").unregister("tasks-next");
    const other = document.createElement("div");
    CaseTool(handle, other)();
    installTasks(tasks);
    await new Promise((r) => setTimeout(r, 30));
    expect(other.childNodes.length).toBe(0);
  });
});
