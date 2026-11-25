// The agent's tools over a fake repo: a GLB model of three parts (a closed
// box hull, an open cabin above the water, a water plane), a task queue a
// fake machine says it serves, and the finite cases each tool decides: units, floating, sweeps, the
// results table, and every refusal.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FakeRepo } from "../probes/fake-repo.js";
import { encodeGLB } from "./glb.js";
import { boxTriangles } from "./test/box.js";
import { newRun, CASE_TYPE, RUN_TYPE } from "./protocol.js";
import { setPackageUrl, RUN_CODE } from "./run-tasks.js";
import { taskState, allHeard } from "./task-rules.js";
import { defaultSetup, normalizeSetup, waterProperties, G, KNOT } from "./setup.js";
import { caseTool, setupTool, runTool, resultsTool, stopTool, setupPatch, STATUS_PATH, MAX_PARTS } from "./agent-tools.js";
import { AGENT_TOOLS } from "./agent-meta.js";
import { plugins } from "./index.js";
import { resultsTable, runFigures, weightOf, MAX_ROWS, MAX_ERROR } from "./results.js";
import { floatAt, hullModel, readHull, parseMass, sinkageMeaning } from "./case-model.js";

// ---------------------------------------------------------------- fixtures

/** Floating-frame triangles → glTF positions (Y up): (x, y, z) → (x, z, −y), as the reader undoes. */
const toGltf = (tris) => {
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    out[i] = tris[i];
    out[i + 1] = tris[i + 2];
    out[i + 2] = -tris[i + 1];
  }
  return out;
};
const shift = (tris, [dx, dy, dz], [sx, sy, sz] = [1, 1, 1]) => Float64Array.from(tris, (v, i) => (i % 3 === 0 ? v * sx + dx : i % 3 === 1 ? v * sy + dy : v * sz + dz));
// a cabin: the open-bow box (one opening of 4 edges), half as long and wide, sitting on the deck
const cabin = shift(boxTriangles({ open: true }), [1, 0, 0.75], [0.5, 0.6, 0.5]);
// a water plane 100 m across at z = 0 (two triangles)
const water = Float64Array.from([-50, -50, 0, 50, -50, 0, 50, 50, 0, -50, -50, 0, 50, 50, 0, -50, 50, 0]);
const glb = encodeGLB({
  meshes: [
    { name: "Hull", positions: toGltf(boxTriangles()) },
    { name: "Cabin", positions: toGltf(cabin) },
    { name: "Water", positions: toGltf(water) },
  ],
});

const RHO = waterProperties("salt", 15).rho;
const SESSION = "automerge:session";

const PACKAGE = "automerge:openfoamTestPackage";
let repo, ctx, hullUrl, server, folder, beating;
/** A machine serving the queue says so every so often (task-client.js's `served` hears it). */
function serveQueue({ name = "Test machine", slots = 1, busy = 0 } = {}) {
  let seq = 0;
  const beat = () => server.hear({ type: "serving", pool: "pool-1", name, slots, busy, from: "test-pool", seq: seq++ });
  beat();
  clearInterval(beating);
  beating = setInterval(beat, 50);
}
afterEach(() => clearInterval(beating));
beforeEach(() => {
  setPackageUrl(PACKAGE);
  repo = new FakeRepo();
  // the fake repo records each change's options, to check the messages
  const add = repo.add.bind(repo);
  repo.add = (doc, url) => {
    const h = add(doc, url);
    const change = h.change.bind(h);
    h.messages = [];
    h.change = (fn, opts) => {
      h.messages.push(opts?.message ?? null);
      change(fn);
    };
    return h;
  };
  ctx = { repo, sessionUrl: SESSION };
  hullUrl = repo.add({ "@patchwork": { type: "file" }, name: "box.glb", extension: "glb", content: glb }).url;
  server = repo.add({ title: "Test queue", jobs: {} });
  serveQueue();
  folder = repo.add({ "@patchwork": { type: "folder" }, title: "Work", docs: [] });
});

const text = (r) => (typeof r === "string" ? r : r.text);
async function newCase(more = {}) {
  const r = await caseTool.execute({ title: "Box", hull: hullUrl, server: server.url, ...more }, ctx);
  return { url: r.doc.url, handle: await repo.find(r.doc.url), text: r.text };
}

// ---------------------------------------------------------------- metadata

describe("the plugin entries", () => {
  it("are registered by the package, once each, with JSON-only metadata", () => {
    const ids = plugins.filter((p) => p.type === "agent:tool").map((p) => p.id);
    expect(ids).toEqual(["openfoam_case", "openfoam_setup", "openfoam_run", "openfoam_results", "openfoam_stop"]);
    for (const p of AGENT_TOOLS) {
      const { load, ...meta } = p;
      expect(() => structuredClone(meta)).not.toThrow();
      expect(typeof load).toBe("function");
      expect(["host", "worker"]).toContain(p.where);
      expect(["read", "edit"]).toContain(p.risk);
      expect(p.description.length).toBeGreaterThan(80);
    }
  });
  it("load executors with execute and summarize", async () => {
    for (const p of AGENT_TOOLS) {
      const t = await p.load();
      expect(typeof t.execute).toBe("function");
      expect(typeof t.summarize).toBe("function");
      expect(typeof t.summarize({})).toBe("string");
    }
  });
  it("declare every input the executors read", () => {
    const read = {
      openfoam_case: ["case", "folder", "title", "hull", "parts", "bow", "server", "reread"],
      openfoam_setup: ["case", "analysis", "speed", "attitude", "float", "water", "temperature", "mesh", "iterations", "stop", "domain", "cores", "keep_volume", "start_from"],
      openfoam_run: ["case", "speeds"],
      openfoam_results: ["runs", "case"],
      openfoam_stop: ["runs", "keep"],
    };
    for (const p of AGENT_TOOLS) expect(Object.keys(p.input_schema.properties).sort()).toEqual([...read[p.id]].sort());
  });
});

// ---------------------------------------------------------------- the case

describe("openfoam_case", () => {
  it("makes a case, files it, links the hull and server, and keeps the hull with it", async () => {
    const r = await caseTool.execute({ title: "Box", folder: folder.url, hull: hullUrl, server: server.url }, ctx);
    expect(r.doc).toEqual({ url: expect.any(String), name: "Box", kind: CASE_TYPE });
    const d = (await repo.find(r.doc.url)).doc();
    expect(d["@patchwork"].type).toBe(CASE_TYPE);
    expect(d.title).toBe("Box");
    expect(d.hull.url).toBe(hullUrl);
    expect(d.hull.stash).toMatch(/^automerge:/);
    expect(d.server).toBe(server.url);
    expect(folder.doc().docs).toEqual([{ name: "Box", type: CASE_TYPE, url: r.doc.url }]);
    expect(folder.messages).toEqual([`agent ${SESSION}: file the OpenFOAM case “Box”`]);
    expect(r.text).toMatch(/^Done: made the case “Box”; filed it in automerge:\S+; linked the hull automerge:\S+; server automerge:\S+; kept the hull's chosen parts with the case\./);
  });
  it("reports every part's extent and whether it is closed, the floating, the setup and readiness", async () => {
    const { text: t } = await newCase();
    expect(t).toContain("parts: 1 of 3 chosen as the hull (the default: what meets the water)");
    expect(t).toContain("[x] Hull — 12 triangles; x 0…4, y -0.5…0.5, z -0.5…0.5; closed");
    expect(t).toContain("[ ] Cabin — 10 triangles; x 1…3, y -0.3…0.3, z 0.5…1; 4 open edges");
    expect(t).toContain("[ ] Water — 2 triangles; x -50…50, y -50…50, z 0…0; water plane");
    expect(t).toContain("waterline at model z = 0 m (the water plane “Water”)");
    expect(t).toContain(`displaces ${((2 * RHO) / 1000).toFixed(3)} t (2.000 m³ of seawater at 15 °C); draft 0.5 m, waterline 4 × 1 m, wetted area 9.00 m²`);
    expect(t).toContain("The hull is one closed shell.");
    expect(t).toContain("measured at x = 2.000 m");
    expect(t).toContain("Setup: Double body (no waves) · 6 kn (3.087 m/s) · coarse mesh");
    expect(t).toContain("Server: “Test queue”");
    expect(t).toContain("served by Test machine; nothing running.");
    expect(t).toMatch(/Ready: openfoam_run \{ case \} asks for a run at 6 kn/);
  });
  it("after the hull is kept, reads only the kept copy, which knows every part but holds the chosen ones", async () => {
    const { url } = await newCase();
    const t = text(await caseTool.execute({ case: url }, ctx));
    expect(t).toContain("kept with the case");
    expect(t).toContain("[ ] Cabin — 10 triangles; x 1…3, y -0.3…0.3, z 0.5…1; not checked: not held here");
  });
  it("chooses parts by name, reading the original once for a part the kept copy lacks", async () => {
    const { url, handle } = await newCase();
    const before = handle.doc().hull.stash;
    const t = text(await caseTool.execute({ case: url, parts: ["Hull", "Cabin"] }, ctx));
    expect(handle.doc().hull.parts).toEqual(["Hull", "Cabin"]);
    expect(handle.doc().hull.stash).not.toBe(before);
    expect(t).toContain("parts: 2 of 3 chosen as the hull.");
    expect(t).toContain("[x] Cabin");
    // back to the default: the kept copy covers it, so nothing new is kept
    const kept = handle.doc().hull.stash;
    await caseTool.execute({ case: url, parts: "default" }, ctx);
    expect(handle.doc().hull.parts).toBeUndefined();
    expect(handle.doc().hull.stash).toBe(kept);
  });
  it("refuses an unknown part, naming the parts there are, and writes nothing", async () => {
    const { url, handle } = await newCase();
    const before = JSON.stringify(handle.doc());
    await expect(caseTool.execute({ case: url, parts: ["Hull", "Keel"] }, ctx)).rejects.toThrow('No part named "Keel" in “box.glb”. Its parts: "Hull", "Cabin", "Water".');
    expect(JSON.stringify(handle.doc())).toBe(before);
  });
  it("turns the bow, and says nothing changed when nothing did", async () => {
    const { url, handle } = await newCase();
    await caseTool.execute({ case: url, bow: "-x" }, ctx);
    expect(handle.doc().hull.bow).toBe("-x");
    expect(handle.messages.at(-1)).toBe(`agent ${SESSION}: bow -x`);
    const n = handle.messages.length;
    const t = text(await caseTool.execute({ case: url, bow: "-x" }, ctx));
    expect(handle.messages.length).toBe(n);
    expect(t).toMatch(/^OpenFOAM case “Box”/);
    await expect(caseTool.execute({ case: url, bow: "x" }, ctx)).rejects.toThrow('`bow` is "+x" or "-x"');
  });
  it("refuses what isn't a case, a server or a URL", async () => {
    await expect(caseTool.execute({ case: hullUrl }, ctx)).rejects.toThrow(/is a file document, not an OpenFOAM case\. openfoam_case makes one\./);
    await expect(caseTool.execute({ case: "nonsense" }, ctx)).rejects.toThrow(/`case` "nonsense" isn't an automerge: URL/);
    const { url } = await newCase();
    await expect(caseTool.execute({ case: url, server: hullUrl }, ctx)).rejects.toThrow(/`server` automerge:\S+: that link isn't a task queue/);
    await expect(caseTool.execute({ case: url, parts: [] }, ctx)).rejects.toThrow(/`parts` is a list of part names/);
  });
  it("says what's missing before a run can be asked for", async () => {
    const r = await caseTool.execute({ title: "Empty" }, ctx);
    expect(r.text).toContain("Hull: none linked.");
    expect(r.text).toContain("Not ready to run: Link a hull first.");
  });
});

// ---------------------------------------------------------------- the setup

describe("openfoam_setup: the speed is one value with its unit", () => {
  it("stores 8 kn as 8 kn, and runs at 8 kn", async () => {
    const { url, handle } = await newCase();
    const t = await setupTool.execute({ case: url, speed: "8 kn" }, ctx);
    expect(handle.doc().setup.speed).toEqual({ value: 8, unit: "kn" });
    expect(t).toContain("Setup: Double body (no waves) · 8 kn (4.116 m/s)");
    const r = await runTool.execute({ case: url }, ctx);
    const run = (await repo.find(r.made[0].url)).doc();
    expect(run.setup.speed).toEqual({ value: 8, unit: "kn" });
    expect(run.title).toContain("8 kn");
  });
  it("takes { value, unit } and m/s alike", async () => {
    const { url, handle } = await newCase();
    await setupTool.execute({ case: url, speed: { value: 4.1, unit: "m/s" } }, ctx);
    expect(handle.doc().setup.speed).toEqual({ value: 4.1, unit: "m/s" });
  });
  it("refuses a bare number, and changes nothing", async () => {
    const { url, handle } = await newCase();
    const before = JSON.stringify(handle.doc().setup);
    await expect(setupTool.execute({ case: url, speed: 8 }, ctx)).rejects.toThrow(/a bare number has no unit/);
    await expect(setupTool.execute({ case: url, speed: "8" }, ctx)).rejects.toThrow(/give a number and its unit/);
    expect(JSON.stringify(handle.doc().setup)).toBe(before);
  });
  it("reports a speed someone wrote as a bare number, and writes it as shown when asked", async () => {
    const { url, handle } = await newCase();
    handle.change((d) => (d.setup.speed = 8));
    const t = text(await caseTool.execute({ case: url }, ctx));
    expect(t).toContain("Setup as stored: setup.speed is 8, which isn't a speed with a unit; it reads as 6 kn");
    await setupTool.execute({ case: url, mesh: "coarse" }, ctx);
    expect(handle.doc().setup.speed).toEqual({ value: 6, unit: "kn" });
  });
});

describe("openfoam_setup: everything else", () => {
  it("refuses unknown and out-of-range values rather than clamping them", () => {
    expect(() => setupPatch({ analysis: "waves" })).toThrow('`analysis` is "double-body" or "free-surface", not "waves".');
    expect(() => setupPatch({ mesh: "huge" })).toThrow('`mesh` is "coarse", "medium", "fine"; not "huge".');
    expect(() => setupPatch({ attitude: { trim: 20 } })).toThrow("`attitude.trim` 20 ° is outside -10…10.");
    expect(() => setupPatch({ attitude: { roll: 2 } })).toThrow(/`attitude\.roll` isn't part of an attitude/);
    expect(() => setupPatch({ attitude: { sinkage: "1" } })).toThrow('`attitude.sinkage` must be a number (m), not "1".');
    expect(() => setupPatch({ temperature: 40 })).toThrow("`temperature` 40 °C is outside 0…30.");
    expect(() => setupPatch({ iterations: 10.5 })).toThrow("`iterations` 10.5 is outside 50…20000.");
    expect(() => setupPatch({ iterations: 100.5 })).toThrow("`iterations` is a whole number, not 100.5.");
    expect(() => setupPatch({ cores: -1 })).toThrow("`cores` -1 is outside 0…256.");
    expect(() => setupPatch({ keep_volume: "yes" })).toThrow("`keep_volume` is true or false.");
    expect(() => setupPatch({ start_from: "x" })).toThrow(/`start_from` "x" isn't an automerge: URL/);
  });
  it("maps every field to the setup it changes", () => {
    expect(setupPatch({ analysis: "free-surface", speed: "7 kn", attitude: { trim: 1 }, water: "fresh", temperature: 10, mesh: "medium", iterations: 3000, stop: "iterations", domain: "full", cores: 4, keep_volume: true, start_from: null })).toEqual({
      mode: "free-surface",
      speed: { value: 7, unit: "kn" },
      attitude: { trim: 1 },
      water: "fresh",
      temperature: 10,
      mesh: "medium",
      iterations: 3000,
      stop: "iterations",
      domain: "full",
      cores: 4,
      keepVolume: true,
      warmStart: null,
    });
  });
  it("a new analysis takes its own iterations, as in the case tool", async () => {
    const { url, handle } = await newCase();
    await setupTool.execute({ case: url, analysis: "free-surface" }, ctx);
    expect(handle.doc().setup.iterations).toBe(4000);
    expect(handle.messages.at(-1)).toBe(`agent ${SESSION}: set up the run: mode "free-surface"`);
  });
  it("starts only from a finished run", async () => {
    const { url } = await newCase();
    const q = repo.add({ ...newRun({ caseUrl: url, serverUrl: server.url, setup: defaultSetup(), hull: {}, now: 1 }) });
    await expect(setupTool.execute({ case: url, start_from: q.url }, ctx)).rejects.toThrow(/is queued; only a finished \(done\) run can start another/);
    await expect(setupTool.execute({ case: url, start_from: hullUrl }, ctx)).rejects.toThrow(/not an OpenFOAM run/);
  });
});

describe("floating", () => {
  // the box: 4 × 1 waterplane, 0.5 m draft as drawn; upright, V = m / ρ = 4 (0.5 + s)
  const massFor = (V) => V * RHO;
  it("floats at a mass: the sinkage puts the displacement there, and the report says how it's measured", async () => {
    const { url, handle } = await newCase();
    const t = await setupTool.execute({ case: url, float: { mass: `${massFor(2.5)} kg` } }, ctx);
    expect(handle.doc().setup.attitude.sinkage).toBeCloseTo(0.125, 4);
    expect(t).toMatch(/^Done: floated at 2,564\.9\d* kg: sinkage 0\.125 m at trim 0° and heel 0°\./);
    expect(t).toContain("displaces 2.565 t (2.500 m³");
    expect(t).toContain("measured at x = 2.000 m (half-way along the chosen parts' length, bow to +x) after trimming about that point; it is where the hull floats, not a change from the last sinkage");
  });
  it("floats at the trim this same call sets, not the one before", async () => {
    const { url, handle } = await newCase();
    const mass = massFor(2.5);
    await setupTool.execute({ case: url, attitude: { trim: 8 }, float: { mass: { value: mass / 1000, unit: "t" } } }, ctx);
    const a = handle.doc().setup.attitude;
    expect(a.trim).toBe(8);
    // a box trimmed t about its middle, lowered s: the draft there, measured square to its keel, is 0.5 + s / cos t,
    // so it holds 4 (0.5 + s / cos t) and floats at s = 0.125 cos t
    expect(a.sinkage).toBeCloseTo(0.125 * Math.cos((8 * Math.PI) / 180), 4);
    const c = await readHull(repo, handle.doc().hull);
    const at8 = floatAt(c, hullModel(c, handle.doc().hull), { mass, water: "salt", temperature: 15, trim: 8, heel: 0 });
    expect(a.sinkage).toBe(at8.sinkage);
    expect(Math.abs(a.sinkage - 0.125)).toBeGreaterThan(0.001);
  });
  it("is a position, not an increment: floating twice at one mass gives one sinkage", async () => {
    const { url, handle } = await newCase();
    await setupTool.execute({ case: url, float: { mass: "2500 kg" } }, ctx);
    const once = handle.doc().setup.attitude.sinkage;
    await setupTool.execute({ case: url, float: { mass: "2500 kg" } }, ctx);
    expect(handle.doc().setup.attitude.sinkage).toBe(once);
  });
  it("keeps the upright displacement when heeled", async () => {
    const { url, handle } = await newCase();
    await setupTool.execute({ case: url, attitude: { heel: 10 }, float: { keep_displacement: true } }, ctx);
    expect(handle.doc().setup.attitude.heel).toBe(10);
    expect(Number.isFinite(handle.doc().setup.attitude.sinkage)).toBe(true);
  });
  it("refuses what it can't do, and changes nothing", async () => {
    const { url, handle } = await newCase();
    const before = JSON.stringify(handle.doc().setup);
    await expect(setupTool.execute({ case: url, attitude: { sinkage: 0.1 }, float: { mass: "2500 kg" } }, ctx)).rejects.toThrow("Give `attitude.sinkage` or `float`, not both");
    await expect(setupTool.execute({ case: url, float: { mass: 2500 } }, ctx)).rejects.toThrow(/a bare number has no unit/);
    await expect(setupTool.execute({ case: url, float: {} }, ctx)).rejects.toThrow(/`float` takes one of `mass`/);
    await expect(setupTool.execute({ case: url, float: { mass: "2500 kg", keep_displacement: true } }, ctx)).rejects.toThrow(/`float` takes one of `mass`/);
    await expect(setupTool.execute({ case: url, float: { mass: "50 t" } }, ctx)).rejects.toThrow("The whole hull displaces less than 50.000 t at trim 0° and heel 0°: nothing was changed.");
    expect(JSON.stringify(handle.doc().setup)).toBe(before);
  });
  it("reads masses with their units only", () => {
    expect(parseMass("11984 kg")).toBe(11984);
    expect(parseMass("11.984 t")).toBeCloseTo(11984, 9);
    expect(parseMass({ value: 2, unit: "tonnes" })).toBe(2000);
    expect(() => parseMass("12")).toThrow(/give a number and its unit/);
    expect(() => parseMass({ value: 2, unit: "lb" })).toThrow(/unit must be kg or t/);
    expect(() => parseMass("0 kg")).toThrow(/more than zero/);
  });
  it("says how sinkage is measured", () => expect(sinkageMeaning(2)).toMatch(/^sinkage is how far the hull is lowered from as drawn .* measured at x = 2\.000 m/));
});

// ---------------------------------------------------------------- running

describe("openfoam_run", () => {
  it("asks for one run at the setup's speed, and says which path to watch", async () => {
    const { url, handle } = await newCase();
    const r = await runTool.execute({ case: url }, ctx);
    expect(r.made).toHaveLength(1);
    const runUrl = r.made[0].url;
    const run = (await repo.find(runUrl)).doc();
    expect(run["@patchwork"].type).toBe(RUN_TYPE);
    expect(run.status).toBe("queued");
    expect(run.case).toBe(url);
    expect(run.requestedBy).toBe("agent");
    expect(run.hull.source.parts).toEqual(["Hull"]);
    expect(run.hull.geometry.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(handle.doc().runs).toEqual([runUrl]);
    // asked of the case's queue as a task keyed by the run, naming this package's run code
    expect(Object.keys(server.doc().jobs)).toEqual([runUrl]);
    const entry = server.doc().jobs[runUrl];
    expect(entry.package).toBe(PACKAGE);
    expect(run.task).toBe(entry.taskUrl);
    const task = (await repo.find(entry.taskUrl)).doc();
    expect(task).toMatchObject({ importUrl: `/${encodeURIComponent(PACKAGE)}/${RUN_CODE}`, input: { run: runUrl }, key: runUrl, runs: [] });
    expect(STATUS_PATH).toEqual(["status"]);
    expect(r.text).toContain(`doc_watch { url: "${runUrl}", path: ["status"], match: "done|failed|cancelled" }`);
    expect(r.text).toContain('the small field ["status"] of its document');
    expect(r.text).toMatch(/^Asked for a run on “Test queue”: served by Test machine\./);
  });
  it("asks for a sweep, one run per speed with its unit, in order", async () => {
    const { url, handle } = await newCase();
    const r = await runTool.execute({ case: url, speeds: ["7 kn", "8 kn", { value: 4.5, unit: "m/s" }] }, ctx);
    const runs = await Promise.all(r.made.map(async (m) => (await repo.find(m.url)).doc()));
    expect(runs.map((x) => x.setup.speed)).toEqual([
      { value: 7, unit: "kn" },
      { value: 8, unit: "kn" },
      { value: 4.5, unit: "m/s" },
    ]);
    expect(handle.doc().runs).toEqual(r.made.map((m) => m.url));
    expect(Object.keys(server.doc().jobs)).toEqual(r.made.map((m) => m.url));
    for (const m of r.made) expect(r.text).toContain(`doc_watch { url: "${m.url}"`);
    // one hull, frozen once for all
    expect(new Set(runs.map((x) => x.hull.geometry.digest)).size).toBe(1);
  });
  it("refuses bad sweeps and cases that aren't ready, and asks for nothing", async () => {
    const { url, handle } = await newCase();
    await expect(runTool.execute({ case: url, speeds: [7, 8] }, ctx)).rejects.toThrow(/a bare number has no unit/);
    await expect(runTool.execute({ case: url, speeds: [] }, ctx)).rejects.toThrow(/`speeds` is a list of speeds/);
    await expect(runTool.execute({ case: url, speeds: Array(21).fill("5 kn") }, ctx)).rejects.toThrow("At most 20 runs a call; 21 were asked for.");
    handle.change((d) => (d.setup.attitude.sinkage = -5));
    await expect(runTool.execute({ case: url }, ctx)).rejects.toThrow("Can't run yet: The hull doesn't cross the waterline: set its sinkage.");
    const bare = await caseTool.execute({ title: "No server", hull: hullUrl }, ctx);
    await expect(runTool.execute({ case: bare.doc.url }, ctx)).rejects.toThrow("Can't run yet: Choose a server.");
    expect(handle.doc().runs).toEqual([]);
    expect(server.doc().jobs).toEqual({});
  });
  it("says when nobody is serving the queue: the runs wait", async () => {
    const { url } = await newCase();
    clearInterval(beating);
    const r = await runTool.execute({ case: url }, ctx);
    expect(r.text).toMatch(/NOBODY IS SERVING IT — they wait in its queue/);
  }, 10_000);
  it("says how many runs are ahead, from the queue and what its machines say they are busy with", async () => {
    const { url } = await newCase();
    await runTool.execute({ case: url, speeds: ["7 kn", "8 kn"] }, ctx);
    serveQueue({ busy: 1 });
    const r = await runTool.execute({ case: url }, ctx);
    expect(r.text).toMatch(/served by Test machine; 2 ahead of them\./);
    expect(await caseTool.execute({ case: url }, ctx)).toContain("running 1, 2 waiting.");
  });
  it("can't name the run's code outside its package without being told, and asks for nothing", async () => {
    const { url, handle } = await newCase();
    setPackageUrl(null);
    await expect(runTool.execute({ case: url }, ctx)).rejects.toThrow(/wasn't loaded from its package/);
    expect(handle.doc().runs).toEqual([]);
    expect(server.doc().jobs).toEqual({});
  });
});

// ---------------------------------------------------------------- results

const W = 2 * RHO * G;
function doneRun({ mode = "free-surface", Fz = 19000, speed = { value: 8, unit: "kn" }, stoppedBy = "settled" } = {}) {
  return {
    ...newRun({ caseUrl: "automerge:c", serverUrl: "automerge:s", setup: normalizeSetup({ mode, speed, attitude: { sinkage: 0.125, trim: 0.5, heel: 0 } }), hull: { info: { volume: 2 } }, now: 0 }),
    status: "done",
    startedAt: 0,
    finishedAt: 840_000,
    summary: { mode, rho: RHO, Rt: 3895.4, RtStd: 12.3, Rp: 2900.1, Rv: 995.2, Fz, iterations: 502, cells: 421_337, stoppedBy, settledNote: "within 1%" },
  };
}

describe("the results table", () => {
  it("weighs the hull as its displaced volume at rest, ×ρg", () => {
    expect(weightOf(doneRun()).W).toBeCloseTo(W, 6);
    expect(weightOf({ hull: {}, summary: { rho: 1 } })).toBeNull();
  });
  it("quotes a finished free-surface run in one row, with F_z against weight", () => {
    const t = resultsTable([{ url: "automerge:A", doc: doneRun() }]);
    const lines = t.split("\n");
    expect(lines[0]).toBe("| # | run | status | speed | analysis | mesh | sinkage m / trim ° / heel ° | R_T N | R_p N | R_v N | F_z N | weight N | F_z/W | convergence | cells | iterations | time |");
    expect(lines[1]).toBe("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    expect(lines[2]).toBe(`| 1 | automerge:A | done | 8 kn | free surface | coarse | 0.125 / 0.5 / 0 | 3,895 ±12 | 2,900 | 995 | 19,000 | ${Math.round(W).toLocaleString("en")} | ${(19000 / W).toFixed(3)} | settled | 421,337 | 502 | 14.0 min |`);
  });
  it("gives a double body no F_z/W (its F_z is squat suction)", () => {
    const f = runFigures(doneRun({ mode: "double-body", Fz: -800 }));
    expect(f.FzOverW).toBeNull();
    expect(f.W).toBeCloseTo(W, 6);
  });
  it("names how each run stopped", () => {
    expect(runFigures(doneRun({ stoppedBy: "residuals" })).converged).toBe("converged");
    expect(runFigures(doneRun({ stoppedBy: "settled" })).converged).toBe("settled");
    expect(runFigures(doneRun({ stoppedBy: "asked" })).converged).toBe("stopped early");
    expect(runFigures(doneRun({ stoppedBy: "iterations" })).converged).toBe("not converged");
  });
  it("lists runs that haven't finished, failed, were cancelled or can't be read, each with a line saying so", () => {
    const base = doneRun();
    const solving = { ...base, status: "solving", finishedAt: null, summary: null, progress: { iteration: 120, of: 4000 }, stages: [{ label: "Solve (interFoam, LTS)", status: "running" }] };
    const failed = { ...base, status: "failed", summary: null, error: `snappyHexMesh exited 1\n${"x".repeat(400)}`, stages: [{ label: "Mesh the hull", status: "failed" }] };
    const cancelled = { ...base, status: "cancelled", summary: null };
    const t = resultsTable([
      { url: "automerge:S", doc: solving },
      { url: "automerge:F", doc: failed },
      { url: "automerge:C", doc: cancelled },
      { url: "automerge:U", doc: null, error: "unavailable" },
    ]);
    expect(t).toContain("| 1 | automerge:S | solving 120/4000 | 8 kn | free surface | coarse | 0.125 / 0.5 / 0 | – | – | – | – | – | – | – | – | 120 | – |");
    expect(t).toContain("1. solving (Solve (interFoam, LTS)): not finished.");
    expect(t).toContain(`2. failed at “Mesh the hull”: snappyHexMesh exited 1 ${"x".repeat(MAX_ERROR - "snappyHexMesh exited 1 ".length)}…`);
    expect(t).toContain("3. cancelled.");
    expect(t).toContain("4. automerge:U: couldn't be read (unavailable)");
  });
  it("is bounded: at most MAX_ROWS rows, the rest counted", () => {
    const runs = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ url: `automerge:R${i}`, doc: doneRun() }));
    const t = resultsTable(runs);
    expect(t.split("\n").filter((l) => l.startsWith("| ") && /^\| \d+ \|/.test(l))).toHaveLength(MAX_ROWS);
    expect(t).toContain("(5 more runs not listed: pass `runs` to pick.)");
  });
  it("openfoam_results reads a case's runs, or the runs named, and marks what isn't a run", async () => {
    const { url } = await newCase();
    const r = await runTool.execute({ case: url, speeds: ["7 kn", "8 kn"] }, ctx);
    const t = await resultsTool.execute({ case: url }, ctx);
    expect(t).toMatch(/^OpenFOAM case “Box” \(automerge:\S+\): 2 runs, oldest first\./);
    expect(t).toContain(`| 1 | ${r.made[0].url} | queued | 7 kn | double body |`);
    expect(t).toContain(`| 2 | ${r.made[1].url} | queued | 8 kn | double body |`);
    const t2 = await resultsTool.execute({ runs: [r.made[1].url, hullUrl, "automerge:2xXxXxXxXxXxXxXxXxXxXxXxXxXx"] }, ctx);
    expect(t2).toContain(`| 1 | ${r.made[1].url} | queued | 8 kn |`);
    expect(t2).toContain(`2. ${hullUrl}: couldn't be read (not an OpenFOAM run (file))`);
    expect(t2).toMatch(/3\. automerge:2xXx\S+: couldn't be read \(unavailable/);
    await expect(resultsTool.execute({}, ctx)).rejects.toThrow("Pass `runs` (run URLs) or `case` (a case URL: all its runs).");
  });
});

// ---------------------------------------------------------------- stopping

describe("openfoam_stop", () => {
  it("cancels a queued run through its task, finishes a solving one by its control, and leaves finished ones be", async () => {
    const { url } = await newCase();
    const r = await runTool.execute({ case: url, speeds: ["7 kn", "8 kn"] }, ctx);
    const [a, b] = await Promise.all(r.made.map((m) => repo.find(m.url)));
    b.change((d) => (d.status = "solving"));
    const t = await stopTool.execute({ runs: [a.url, b.url], keep: true }, ctx);
    expect(t).toContain(`${a.url}: queued, not solving, so there's nothing to finish yet`);
    expect(t).toContain(`${b.url}: asked to finish now`);
    expect(a.doc().control).toEqual({ finish: false });
    expect(b.doc().control).toEqual({ finish: true });
    const taskA = await repo.find(a.doc().task);
    expect(await stopTool.execute({ runs: [a.url], keep: false }, ctx)).toMatch(/: cancelled\. If it hadn't started it never will/);
    // the task has a stop in its list and is off the queue; the run doc isn't written
    expect(taskA.doc().runs).toHaveLength(1);
    expect(taskA.doc().runs[0]).toMatchObject({ status: "cancelled" });
    expect(taskA.doc().runs[0].pool).toBeUndefined();
    expect(taskState(taskA.doc(), allHeard)).toBe("cancelled");
    expect(Object.keys(server.doc().jobs)).toEqual([b.url]);
    expect(a.doc().status).toBe("queued");
    // read from both, it is cancelled: to the results and to stop
    expect(await resultsTool.execute({ runs: [a.url] }, ctx)).toContain(`| 1 | ${a.url} | cancelled |`);
    expect(await stopTool.execute({ runs: [a.url], keep: false }, ctx)).toBe(`${a.url}: already cancelled; nothing to stop.`);
    await expect(stopTool.execute({ runs: [a.url] }, ctx)).rejects.toThrow(/`keep`: true finishes now/);
    await expect(stopTool.execute({ runs: [hullUrl], keep: false }, ctx)).rejects.toThrow(/not an OpenFOAM run/);
  });
});

// the speeds a sweep's runs were made at are the speeds asked for, in m/s too
describe("speed through to the run", () => {
  it("a run at 8 kn is at 8 × 1852/3600 m/s", async () => {
    const { metresPerSecond } = await import("./setup.js");
    expect(metresPerSecond({ value: 8, unit: "kn" })).toBeCloseTo(8 * KNOT, 12);
    expect(metresPerSecond({ value: 8, unit: "kn" })).toBeCloseTo(4.115556, 6);
  });
});
