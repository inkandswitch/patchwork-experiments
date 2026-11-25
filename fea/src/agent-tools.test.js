// The agent's tools over a fake repo: a box and a plate with a hole as GLB
// file docs, a task queue a fake machine says it serves, and the finite
// cases each tool decides: the
// face report, setting up on its face numbers, running, the results, stopping,
// and every refusal (each says what is allowed and writes nothing).

import { readFileSync } from "node:fs";
import { FakeRepo } from "./test/fake-repo.js";
import { encodeGLB } from "./glb.js";
import { box, plateWithHole } from "./test/shapes.js";
import { newRun, STUDY_TYPE, RUN_TYPE } from "./protocol.js";
import { setPackageUrl } from "./task-runs.js";
import { RUN_CODE } from "./protocol.js";
import { taskState, allHeard } from "./task-rules.js";
import { normalizeSetup, MAX_MODES } from "./setup.js";
import { unitsOf } from "./units.js";
import { MATERIALS } from "./materials.js";
import { studyTool, setupTool, runTool, resultsTool, stopTool, setupChanges, STATUS_PATH, MAX_FACES } from "./agent-tools.js";
import { AGENT_TOOLS } from "./agent-meta.js";

// ---------------------------------------------------------------- fixtures

const SESSION = "automerge:session";
const glbFile = (repo, name, tris) => repo.add({ "@patchwork": { type: "file" }, name: `${name}.glb`, extension: "glb", content: encodeGLB({ meshes: [{ name, positions: Float32Array.from(tris) }] }) });

const PACKAGE = "automerge:feaTestPackageAbc";
let repo, ctx, boxUrl, plateUrl, server, folder, beating;
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
  ctx = { repo, session: { url: SESSION, doc: () => ({}) } };
  // 100 × 20 × 10 mm, from the origin
  boxUrl = glbFile(repo, "box", box(0.1, 0.02, 0.01)).url;
  // 60 × 40 × 5 mm with a 10 mm hole through its thickness (z)
  plateUrl = glbFile(repo, "plate", plateWithHole(0.06, 0.04, 0.005, 0.005, 32)).url;
  server = repo.add({ title: "Test FEA", jobs: {} });
  serveQueue();
  folder = repo.add({ "@patchwork": { type: "folder" }, title: "Work", docs: [] });
});

/**
 * A staircase of `n` steps rising from +x towards −x, `w` long and `h` high,
 * extruded `depth` along z: a solid of 2n + 4 flat faces.
 */
function stairs(n, w, h, depth) {
  const profile = [[0, 0], [w, 0]];
  for (let k = 1; k <= n; k++) profile.push([w - ((k - 1) * w) / n, (k * h) / n], [w - (k * w) / n, (k * h) / n]);
  const out = [];
  const quad = (a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < profile.length; i++) {
    const [x0, y0] = profile[i], [x1, y1] = profile[(i + 1) % profile.length];
    quad([x0, y0, 0], [x0, y0, depth], [x1, y1, depth], [x1, y1, 0]);
  }
  // the ends, fanned from the corner at the origin (every point of a staircase sees it)
  for (let i = 1; i + 1 < profile.length; i++) {
    out.push(0, 0, depth, ...profile[i], depth, ...profile[i + 1], depth);
    out.push(0, 0, 0, ...profile[i + 1], 0, ...profile[i], 0);
  }
  return Float64Array.from(out);
}

const text = (r) => (typeof r === "string" ? r : r.text);
async function newStudy(more = {}) {
  const r = await studyTool.execute({ part: boxUrl, server: server.url, ...more }, ctx);
  return { url: r.doc.url, handle: await repo.find(r.doc.url), text: r.text };
}
/** A box held at −x (face 0) and pushed down at +x (face 5): ready to run. */
async function readyStudy() {
  const s = await newStudy();
  await setupTool.execute({ study: s.url, add_support: { faces: [0] }, add_load: { kind: "force", faces: [5], magnitude: "250 N", direction: [0, -1, 0] } }, ctx);
  return s;
}
/** Everything a refused call could have touched, to compare before and after. */
const snapshot = (...handles) => JSON.stringify({ docs: handles.map((h) => h.doc()), messages: handles.map((h) => h.messages.length), created: repo.created.length });

// ---------------------------------------------------------------- metadata

describe("the plugin entries", () => {
  it("are five, with JSON-only metadata and a loader each", async () => {
    expect(AGENT_TOOLS.map((p) => p.id)).toEqual(["fea_study", "fea_setup", "fea_run", "fea_results", "fea_stop"]);
    for (const p of AGENT_TOOLS) {
      const { load, ...meta } = p;
      expect(p.type).toBe("agent:tool");
      expect(() => structuredClone(meta)).not.toThrow();
      expect(["host", "worker"]).toContain(p.where);
      expect(["read", "edit"]).toContain(p.risk);
      expect(p.description.length).toBeGreaterThan(80);
      const t = await load();
      expect(typeof t.execute).toBe("function");
      expect(typeof t.summarize({})).toBe("string");
    }
  });
  it("import nothing (src/index.js spreads them into the worker-evaluated plugin list)", () => {
    expect(readFileSync(new URL("./agent-meta.js", import.meta.url), "utf8")).not.toMatch(/^\s*import\b/m);
  });
  it("declare every input the executors read", () => {
    const read = {
      fea_study: ["study", "folder", "title", "part", "reread", "server", "select_run", "forget_runs", "faces", "facing"],
      fea_setup: ["study", "analysis", "modes", "material", "mesh", "add_support", "update_support", "remove_support", "add_load", "update_load", "remove_load"],
      fea_run: ["study"],
      fea_results: ["runs", "study"],
      fea_stop: ["runs"],
    };
    for (const p of AGENT_TOOLS) expect(Object.keys(p.input_schema.properties).sort()).toEqual([...read[p.id]].sort());
  });
  it("list the units, materials and most modes the model takes", () => {
    const setup = AGENT_TOOLS.find((p) => p.id === "fea_setup").input_schema.properties;
    expect(setup.material.anyOf[0].enum).toEqual(MATERIALS.map((m) => m.id));
    expect(setup.modes.maximum).toBe(MAX_MODES);
    const m = setup.material.anyOf[1].properties;
    expect(m.E.anyOf[1].properties.unit.enum).toEqual(unitsOf("pressure"));
    expect(m.density.anyOf[1].properties.unit.enum).toEqual(unitsOf("density"));
    const load = setup.add_load.anyOf[0].properties;
    expect(load.magnitude.anyOf[1].properties.unit.enum).toEqual(unitsOf("force"));
    expect(load.acceleration.anyOf[1].properties.unit.enum).toEqual(unitsOf("acceleration"));
    expect(setup.mesh.properties.size.anyOf[1].properties.unit.enum).toEqual(unitsOf("length"));
  });
});

// ---------------------------------------------------------------- the study

describe("fea_study", () => {
  it("makes a study, files it, links the part and the server", async () => {
    const r = await studyTool.execute({ folder: folder.url, part: boxUrl, server: server.url }, ctx);
    expect(r.doc).toEqual({ url: expect.any(String), name: "box · FEA", kind: STUDY_TYPE });
    const d = (await repo.find(r.doc.url)).doc();
    expect(d["@patchwork"].type).toBe(STUDY_TYPE);
    expect(d.part.url).toBe(boxUrl);
    expect(d.part.kept).toMatch(/^automerge:/);
    expect(d.server).toBe(server.url);
    expect(folder.doc().docs).toEqual([{ name: "box · FEA", type: STUDY_TYPE, url: r.doc.url }]);
    expect(folder.messages).toEqual([`agent ${SESSION}: file the FEA study “box · FEA”`]);
    expect(r.text).toMatch(/^Done: made the study “box · FEA”; linked the part automerge:\S+: “box” \(GLB file\), 6 faces; server automerge:\S+; filed it in automerge:\S+\./);
  });
  it("reports the part and every face by number, as a tool produced them", async () => {
    const { text: t } = await newStudy();
    expect(t).toContain("size 100 × 20 × 10 mm (x × y × z, in the part's frame: y is up); volume 20 cm³; mass 54 g in Aluminium 6061-T6.");
    expect(t).toContain("A closed solid: it can be meshed.");
    expect(t).toContain("The model hasn't changed since it was read.");
    expect(t).toContain("6 faces (of 12 triangles), numbered when the part was read. Lengths in mm:");
    const faces = [...t.matchAll(/^ {2}face (\d+): (.*)$/gm)];
    expect(faces.map((m) => Number(m[1]))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t).toContain("face 0: flat, 20 mm × 10 mm, facing −x; area 2 cm²; centre (0, 10, 5) mm");
    expect(t).toContain("face 5: flat, 20 mm × 10 mm, facing +x; area 2 cm²; centre (100, 10, 5) mm");
    expect(t).toContain("face 4: flat, 100 mm × 10 mm, facing +y");
    expect(t).toContain("Material: Aluminium 6061-T6: E 68.9 GPa, ν 0.33, density 2700 kg/m³, yield 276 MPa.");
    expect(t).toContain("Supports: none (nothing holds the part).");
    expect(t).toContain("Server: “Test FEA”");
    expect(t).toContain("served by Test machine; nothing running.");
    expect(t).toMatch(/Not ready to run: Add a support: .*\. Add a load: /);
  });
  it("lists the curved faces, or those facing one way", async () => {
    const r = await studyTool.execute({ part: plateUrl, facing: "curved" }, ctx);
    const listed = [...r.text.matchAll(/^ {2}face (\d+): (.*)$/gm)];
    expect(listed).toHaveLength(1);
    expect(listed[0][2]).toMatch(/^round, radius 5 mm, /);
    const up = text(await studyTool.execute({ study: r.doc.url, facing: "+z" }, ctx));
    expect([...up.matchAll(/^ {2}face \d+: flat, 60 mm × 40 mm, facing \+z/gm)]).toHaveLength(1);
    await expect(studyTool.execute({ study: r.doc.url, facing: "up" }, ctx)).rejects.toThrow('`facing` is one of "+x", "-x", "+y", "-y", "+z", "-z", "curved", not "up".');
  });
  it(`lists only the largest ${MAX_FACES} faces of a part with more, and says how to get the rest`, async () => {
    // a staircase of 40 steps, 10 mm deep: a riser and a tread a step, the floor, the back wall and both ends
    const r = await studyTool.execute({ part: glbFile(repo, "stairs", stairs(40, 0.08, 0.08, 0.01)).url }, ctx);
    expect(r.text).toContain(`84 faces (of `);
    expect([...r.text.matchAll(/^ {2}face \d+:/gm)]).toHaveLength(MAX_FACES);
    expect(r.text).toContain(`listed: the largest ${MAX_FACES} of 84, by area; fea_study { study, faces: "all" } lists every one`);
    // the ends and the floor and back wall are larger than any step: they are among those listed
    expect([...r.text.matchAll(/^ {2}face \d+: flat, 80 mm × /gm)].length).toBe(4);
    const all = text(await studyTool.execute({ study: r.doc.url, faces: "all" }, ctx));
    expect([...all.matchAll(/^ {2}face \d+:/gm)]).toHaveLength(84);
  });
  it("says what is missing, and refuses what isn't a study, a server or a URL", async () => {
    const r = await studyTool.execute({ title: "Empty" }, ctx);
    expect(r.doc.name).toBe("Empty");
    expect(r.text).toContain("Part: none linked.");
    expect(r.text).toContain("Not ready to run: Link a part. Choose a server.");
    await expect(studyTool.execute({ study: boxUrl }, ctx)).rejects.toThrow(/is a file document, not an FEA study\. fea_study makes one\./);
    await expect(studyTool.execute({ study: "nonsense" }, ctx)).rejects.toThrow(/`study` "nonsense" isn't an automerge: URL/);
    const h = await repo.find(r.doc.url);
    const before = snapshot(h);
    await expect(studyTool.execute({ study: r.doc.url, server: boxUrl, title: "Renamed" }, ctx)).rejects.toThrow(/`server` automerge:\S+: that isn't an FEA server: paste the queue link the FEA host printed when it started \(daemon\/start\.sh in this package\)\./);
    const own = repo.add(newRun({ studyUrl: r.doc.url, serverUrl: server.url, setup: normalizeSetup(null), part: {}, now: 0 }));
    await expect(studyTool.execute({ study: r.doc.url, part: own.url }, ctx)).rejects.toThrow("Couldn't link " + own.url + ": That's one of this tool's own documents, not a part. Nothing was changed.");
    await expect(studyTool.execute({ study: r.doc.url, select_run: boxUrl }, ctx)).rejects.toThrow(/that run isn't one of this study's\. Its runs: none yet\./);
    expect(snapshot(h)).toBe(before);
  });
  it("makes a study whose part can't be read, and says so: the study stands, unlinked", async () => {
    const r = await studyTool.execute({ title: "Odd", part: folder.url }, ctx);
    expect(r.doc.name).toBe("Odd");
    expect(r.text).toMatch(/^Done: made the study “Odd”\.\nNot done: the part automerge:\S+ couldn't be linked: nothing loaded here reads folder documents/);
    expect((await repo.find(r.doc.url)).doc().part).toBeNull();
  });
  it("shows a run, takes runs off the list, and unlinks the part", async () => {
    const s = await readyStudy();
    const a = (await runTool.execute({ study: s.url }, ctx)).made[0].url;
    const b = (await runTool.execute({ study: s.url }, ctx)).made[0].url;
    expect(s.handle.doc().selected).toBe(b);
    await studyTool.execute({ study: s.url, select_run: a }, ctx);
    expect(s.handle.doc().selected).toBe(a);
    expect(s.handle.messages.at(-1)).toBe(`agent ${SESSION}: show the run ${a}`);
    await studyTool.execute({ study: s.url, forget_runs: [a] }, ctx);
    expect(s.handle.doc().runs).toEqual([b]);
    expect(s.handle.doc().selected).toBeNull();
    await expect(studyTool.execute({ study: s.url, forget_runs: [a] }, ctx)).rejects.toThrow(`${a} isn't one of this study's runs. Its runs: ${b}.`);
    const t = text(await studyTool.execute({ study: s.url, part: null }, ctx));
    expect(s.handle.doc().part).toBeNull();
    expect(t).toContain("Part: none linked.");
    await expect(studyTool.execute({ study: s.url, folder: folder.url }, ctx)).rejects.toThrow("`folder` files a new study: leave out `study` to make one.");
  });
  it("reads the part again, keeping the setup's faces, and names the change", async () => {
    const s = await readyStudy();
    const before = s.handle.doc().setup;
    const t = text(await studyTool.execute({ study: s.url, reread: true }, ctx));
    expect(t).toMatch(/^Done: read the part again: “box” \(GLB file\), 6 faces; 2 of the supports and loads kept their faces\./);
    expect(s.handle.doc().setup.supports).toEqual(before.supports);
    expect(s.handle.messages.at(-1)).toBe(`agent ${SESSION}: read the part again`);
  });
});

// ---------------------------------------------------------------- the setup

describe("fea_setup", () => {
  it("holds and loads the part on face numbers from the report, in one change, and then it is ready", async () => {
    const s = await newStudy();
    const n = s.handle.messages.length;
    const t = await setupTool.execute({ study: s.url, add_support: { faces: [0] }, add_load: { kind: "force", faces: [5], magnitude: "250 N", direction: [0, -1, 0] } }, ctx);
    const setup = s.handle.doc().setup;
    const [sup] = Object.values(setup.supports);
    const [load] = Object.values(setup.loads);
    expect(sup).toEqual({ name: "Fixed support", kind: "fixed", faces: [0] });
    expect(load).toEqual({ name: "Force", kind: "force", faces: [5], magnitude: { value: 250, unit: "N" }, direction: [0, -1, 0] });
    expect(s.handle.messages.length).toBe(n + 1);
    expect(s.handle.messages.at(-1)).toMatch(new RegExp(`^agent ${SESSION}: set up the study: added a fixed support \\[\\w+\\]; added a force \\[\\w+\\]$`));
    expect(t).toMatch(/^Done: added a fixed support \[\w+\]; added a force \[\w+\]\./);
    expect(t).toMatch(/\[\w+\] “Fixed support”: fixed, on face 0 \(flat, 20 mm × 10 mm, facing −x\)\./);
    expect(t).toMatch(/\[\w+\] “Force”: force, 250 N down on 1 face: face 5 \(flat, 20 mm × 10 mm, facing \+x\)\./);
    expect(t).toContain("Ready: fea_run { study } runs it.");
    expect(t).toContain("6 faces (of 12 triangles): fea_study { study } lists them.");
  });
  it("takes { value, unit }, points a force into its faces, and changes and removes by id", async () => {
    const s = await readyStudy();
    const [loadId] = Object.keys(s.handle.doc().setup.loads);
    const [supId] = Object.keys(s.handle.doc().setup.supports);
    await setupTool.execute({ study: s.url, update_load: { id: loadId, magnitude: { value: 2, unit: "kN" }, direction: "into" } }, ctx);
    expect(s.handle.doc().setup.loads[loadId]).toMatchObject({ magnitude: { value: 2, unit: "kN" }, direction: [-1, 0, 0] });
    await setupTool.execute({ study: s.url, add_load: { kind: "pressure", faces: [4], pressure: "2 MPa", name: "Top" }, update_support: { id: supId, faces: [0, 1], name: "Wall" } }, ctx);
    expect(s.handle.doc().setup.supports[supId]).toEqual({ name: "Wall", kind: "fixed", faces: [0, 1] });
    expect(Object.values(s.handle.doc().setup.loads).find((l) => l.kind === "pressure")).toEqual({ name: "Top", kind: "pressure", faces: [4], pressure: { value: 2, unit: "MPa" } });
    await setupTool.execute({ study: s.url, add_load: { kind: "gravity" } }, ctx);
    expect(Object.values(s.handle.doc().setup.loads).find((l) => l.kind === "gravity")).toEqual({ name: "Gravity", kind: "gravity", acceleration: { value: 1, unit: "g" }, direction: [0, -1, 0] });
    const t = await setupTool.execute({ study: s.url, remove_support: supId }, ctx);
    expect(s.handle.doc().setup.supports).toEqual({});
    expect(t).toContain(`Done: removed the support [${supId}].`);
    expect(t).toMatch(/Not ready to run: Add a support/);
  });
  it("sets the analysis, modes, material and mesh", async () => {
    const s = await newStudy();
    await setupTool.execute({ study: s.url, analysis: "modal", modes: 10, material: { id: "steel", yield: null }, mesh: { size: "2 mm", order: 1 } }, ctx);
    const setup = s.handle.doc().setup;
    expect(setup.analysis).toBe("modal");
    expect(setup.modes).toBe(10);
    expect(setup.material).toEqual({ name: "Steel, structural (S235, A36) (edited)", E: { value: 200, unit: "GPa" }, nu: 0.3, density: { value: 7850, unit: "kg/m³" }, yield: null });
    expect(setup.mesh).toEqual({ size: { value: 2, unit: "mm" }, order: 1 });
    const t = await setupTool.execute({ study: s.url, material: { name: "6082", E: "70 GPa", density: "2.7 g/cm3", nu: 0.33, yield: "260 MPa" }, mesh: { size: "fine" } }, ctx);
    expect(s.handle.doc().setup.material).toEqual({ name: "6082", E: { value: 70, unit: "GPa" }, nu: 0.33, density: { value: 2.7, unit: "g/cm³" }, yield: { value: 260, unit: "MPa" } });
    expect(t).toContain("Analysis: modal, the first 10 ways it vibrates");
    expect(t).toMatch(/Mesh: fine, four-node \(rough\) elements; about [\d,]+ nodes/);
    expect(text(await setupTool.execute({ study: s.url, mesh: { size: "fine" } }, ctx))).toMatch(/^Nothing changed: the setup already reads so\./);
  });
});

describe("fea_setup refuses, says what is allowed, and writes nothing", () => {
  const refusals = [
    ["a bare number for a force", { add_load: { kind: "force", faces: [5], magnitude: 250, direction: [0, -1, 0] } }, "`add_load`.magnitude (a force's magnitude) needs a value with its unit (like “250 N”), not 250. Its units: N, kN, MN, lbf, kgf."],
    ["a unit it doesn't know", { add_load: { kind: "force", faces: [5], magnitude: "250 furlongs", direction: [0, -1, 0] } }, '`add_load`.magnitude (a force\'s magnitude) needs a value with its unit (like “250 N”), not "250 furlongs". Its units: N, kN, MN, lbf, kgf.'],
    ["a pressure for a stiffness's unit", { material: { E: "70 kN" } }, "`material.E` (Young's modulus) needs a value with its unit (like “2 MPa”), not \"70 kN\". Its units: Pa, kPa, MPa, GPa, bar, psi, ksi."],
    ["a face the part doesn't have", { add_support: { faces: [0, 9] } }, "`add_support`: The part has no face 9: its faces are numbered 0 to 5. Nothing was changed."],
    ["a material not in the list", { material: "unobtanium" }, `\`material.id\`: No material “unobtanium” in the list; the list: ${MATERIALS.map((m) => m.id).join(", ")}. Nothing was changed.`],
    ["no modes", { modes: 0 }, "`modes`: The number of modes must be a whole number from 1 to 40. Nothing was changed."],
    ["too many modes", { modes: 41 }, "`modes`: The number of modes must be a whole number from 1 to 40. Nothing was changed."],
    ["part of a mode", { modes: 2.5 }, "`modes`: The number of modes must be a whole number from 1 to 40. Nothing was changed."],
    ["an analysis it doesn't do", { analysis: "thermal" }, "`analysis`: The analysis must be one of static, modal. Nothing was changed."],
    ["a mesh size that is neither", { mesh: { size: "huge" } }, '`mesh.size` is coarse, medium, fine or a length with its unit (like "2 mm"; units: m, cm, mm, µm, in, ft), not "huge".'],
    ["an element order it doesn't have", { mesh: { order: 3 } }, "`mesh`: The element order must be 1 (four-node) or 2 (ten-node). Nothing was changed."],
    ["a force without a direction", { add_load: { kind: "force", faces: [5], magnitude: "1 kN" } }, "`add_load` (force) needs `direction`: a force is { kind, name, faces, magnitude, direction }."],
    ["a field its kind hasn't", { add_load: { kind: "pressure", faces: [5], pressure: "1 MPa", direction: [1, 0, 0] } }, "`add_load` (pressure) has no `direction`: it takes kind, name, faces, pressure."],
    ["a kind of load it doesn't know", { add_load: { kind: "heat", faces: [5] } }, '`add_load` needs a `kind`: force, pressure or gravity (not "heat").'],
    ["a direction of nothing", { add_load: { kind: "force", faces: [5], magnitude: "1 kN", direction: [0, 0, 0] } }, "`add_load`: A direction is three numbers, not all zero: [0, -1, 0] is down. Nothing was changed."],
    ["into faces that face no one way", { add_load: { kind: "force", faces: [0, 5], magnitude: "1 kN", direction: "into" } }, '`add_load`: `add_load`.direction “into” needs faces that face one way, to point into them. Nothing was changed.'],
    ["a support id it hasn't", { remove_support: "nope" }, '`remove_support` "nope": There is no support with that id; the study has no supports. Nothing was changed.'],
    ["a load id it hasn't", { update_load: { id: "nope", magnitude: "1 N" } }, "`update_load`: That load isn't in the study any more; the loads: none. Nothing was changed."],
    ["a field a setup hasn't", { mesh: { size: "fine", elements: 3 } }, "`mesh` has no `elements`: it takes size, order."],
    ["a field the tool hasn't", { supports: [{ faces: [0] }] }, "fea_setup has no `supports`: it takes study, analysis, modes, material, mesh, remove_support, remove_load, update_support, update_load, add_support, add_load."],
    ["a good change beside a refused one", { analysis: "modal", material: "steel", add_support: [{ faces: [0] }, { faces: [12] }] }, "`add_support[1]`: The part has no face 12: its faces are numbered 0 to 5. Nothing was changed."],
  ];
  for (const [what, input, error] of refusals)
    it(what, async () => {
      const s = await newStudy();
      const before = snapshot(s.handle);
      await expect(setupTool.execute({ study: s.url, ...input }, ctx)).rejects.toThrow(error);
      expect(snapshot(s.handle)).toBe(before);
    });
  it("a sliding support on a curved face", async () => {
    const r = await studyTool.execute({ part: plateUrl, facing: "curved" }, ctx);
    const hole = Number(r.text.match(/^ {2}face (\d+): round/m)[1]);
    const h = await repo.find(r.doc.url);
    const before = snapshot(h);
    await expect(setupTool.execute({ study: r.doc.url, add_support: { kind: "slide", faces: [hole] } }, ctx)).rejects.toThrow(`\`add_support\`: A sliding support needs flat faces; face ${hole} is curved. Nothing was changed.`);
    expect(snapshot(h)).toBe(before);
    // fixed is fine there
    await setupTool.execute({ study: r.doc.url, add_support: { kind: "fixed", faces: [hole] } }, ctx);
    expect(Object.values(h.doc().setup.supports)[0].faces).toEqual([hole]);
  });
  it("reads every change before applying any", () => {
    expect(() => setupChanges({ add_load: [{ kind: "gravity" }, { kind: "force", faces: [1], magnitude: 5, direction: [1, 0, 0] }] })).toThrow("`add_load[1]`.magnitude");
    expect(setupChanges({ analysis: "static", modes: 3, add_support: { faces: [1] } }).map((c) => c.what)).toEqual(["`analysis`", "`modes`", "`add_support`"]);
  });
});

// ---------------------------------------------------------------- running

describe("fea_run", () => {
  it("freezes the setup and the part into a queued run, asks the server's queue for it as a task keyed by the run, and says what to watch", async () => {
    const s = await readyStudy();
    const r = await runTool.execute({ study: s.url }, ctx);
    expect(r.made).toEqual([{ url: expect.any(String), name: "box · static · Aluminium 6061-T6 · coarse", kind: RUN_TYPE }]);
    const runUrl = r.made[0].url;
    const run = (await repo.find(runUrl)).doc();
    expect(run["@patchwork"].type).toBe(RUN_TYPE);
    expect(run.status).toBe("queued");
    expect(run.study).toBe(s.url);
    expect(run.requestedBy).toBe("agent");
    expect(run.setup).toEqual(normalizeSetup(s.handle.doc().setup));
    expect(run.part.faces).toHaveLength(6);
    expect(run.part.stl).toBeInstanceOf(Uint8Array);
    expect(run.part.title).toBe("box");
    expect(s.handle.doc().runs).toEqual([runUrl]);
    expect(s.handle.doc().selected).toBe(runUrl);
    // asked of the study's queue as a task keyed by the run, naming this package's run code
    expect(Object.keys(server.doc().jobs)).toEqual([runUrl]);
    const entry = server.doc().jobs[runUrl];
    expect(entry.package).toBe(PACKAGE);
    expect(run.task).toBe(entry.taskUrl);
    const task = (await repo.find(entry.taskUrl)).doc();
    expect(task).toEqual({ importUrl: `/${encodeURIComponent(PACKAGE)}/${RUN_CODE}`, input: { run: runUrl }, key: runUrl, runs: [] });
    expect(s.handle.messages.at(-1)).toBe(`agent ${SESSION}: run the study “box · FEA”`);
    expect((await repo.find(runUrl)).messages).toEqual([`agent ${SESSION}: run the study “box · FEA”`]);
    expect(STATUS_PATH).toEqual(["status"]);
    expect(r.text).toMatch(/^Asked “Test FEA” \(served by Test machine\) for a run: automerge:\S+ — “box · static · Aluminium 6061-T6 · coarse”, waiting for the server\./);
    expect(r.text).toMatch(/Its mesh will be about [\d,]+ nodes \([\d,]+ ten-node elements at [\d.]+ mm\)\./);
    expect(r.text).toContain(`doc_watch { url: "${runUrl}", path: ["status"], match: "done|failed|cancelled" }`);
  });
  it("refuses with nothing holding the part, and asks for nothing", async () => {
    const s = await newStudy();
    await setupTool.execute({ study: s.url, add_load: { kind: "force", faces: [5], magnitude: "250 N", direction: [0, -1, 0] } }, ctx);
    const before = snapshot(s.handle, server);
    await expect(runTool.execute({ study: s.url }, ctx)).rejects.toThrow("Can't run: not ready to run: add a support: with nothing holding it, the part would simply move away. Nothing was asked for");
    expect(snapshot(s.handle, server)).toBe(before);
  });
  it("refuses while nobody is heard serving the server's queue, and asks for nothing", async () => {
    const s = await readyStudy();
    clearInterval(beating);
    const before = snapshot(s.handle, server);
    await expect(runTool.execute({ study: s.url }, ctx)).rejects.toThrow("Can't run: the server “Test FEA” isn't running: start it (daemon/start.sh on its machine), or choose another. Nothing was asked for");
    expect(snapshot(s.handle, server)).toBe(before);
    expect(text(await studyTool.execute({ study: s.url }, ctx))).toContain("Not ready to run: The server isn't running: nobody is heard serving its queue.");
  }, 15_000);
  it("says how many runs are ahead, from the queue and what its machine says it is busy with", async () => {
    const s = await readyStudy();
    await runTool.execute({ study: s.url }, ctx);
    await runTool.execute({ study: s.url }, ctx);
    serveQueue({ busy: 1 });
    const r = await runTool.execute({ study: s.url }, ctx);
    expect(r.text).toMatch(/, waiting for the server, 2 ahead of it\./);
    expect(text(await studyTool.execute({ study: s.url }, ctx))).toContain("served by Test machine; running 1, 2 waiting.");
  });
  it("can't name the run's code outside its package without being told, and asks for nothing", async () => {
    const s = await readyStudy();
    setPackageUrl(null);
    const before = snapshot(s.handle, server);
    await expect(runTool.execute({ study: s.url }, ctx)).rejects.toThrow(/Can't run: This copy of the tool wasn't loaded from its package/);
    expect(snapshot(s.handle, server)).toBe(before);
  });
  it("refuses with no server", async () => {
    const r = await studyTool.execute({ part: boxUrl }, ctx);
    await setupTool.execute({ study: r.doc.url, add_support: { faces: [0] }, add_load: { kind: "pressure", faces: [5], pressure: "1 MPa" } }, ctx);
    await expect(runTool.execute({ study: r.doc.url }, ctx)).rejects.toThrow("Can't run: choose a server to run on");
  });
});

// ---------------------------------------------------------------- results

/** A finished static run, as its code leaves it (src/solver/post.js summarizeStatic, daemon/runner.mjs). */
function doneRun(studyUrl) {
  const setup = normalizeSetup({ supports: { s1: { name: "Wall", kind: "fixed", faces: [0] } }, loads: { l1: { name: "Push", kind: "force", faces: [5], magnitude: { value: 250, unit: "N" }, direction: [0, -1, 0] } } });
  return {
    ...newRun({ studyUrl, serverUrl: "automerge:s", setup, part: { title: "box", source: { title: "box", readAt: 0 } }, now: 0 }),
    status: "done",
    startedAt: 1_000,
    finishedAt: 13_000,
    daemon: { host: "lab", calculix: "2.22", gmsh: "4.13", cores: 4 },
    mesh: { nodes: 12345, elements: 7000, order: 2, size: 0.0025, method: "faces", volume: 2e-5, volumeOff: 0, quality: { worst: 0.21, poor: 0 }, skin: 900, finer: 0 },
    summary: {
      kind: "static",
      displacement: { max: 1.5e-4, at: [0.1, 0.02, 0.005], vector: [0, -1.5e-4, 0] },
      stress: { max: 1.2e8, at: [0, 0.02, 0.01], atSupport: true, p99: 6.1e7 },
      safety: 2.3,
      loads: [{ id: "l1", name: "Push", kind: "force", area: 2e-4, total: [0, -250, 0] }],
      weight: null,
      pushed: [0, -250, 0],
      reactions: [{ id: "s1", name: "Wall", kind: "fixed", force: [0, 250, 0] }],
      balance: 1e-9,
      energy: 0.0187,
      work: 0.0187,
      adrift: 0,
      mass: 0.054,
      volume: 2e-5,
    },
    notes: ["The highest stress is where a support holds the part. Read the stress a little way off."],
  };
}

describe("fea_results", () => {
  it("tabulates runs, then each finished run's figures and notes, and a line for the rest", async () => {
    const done = repo.add(doneRun("automerge:study"));
    const failed = repo.add({ ...doneRun("automerge:study"), status: "failed", summary: null, mesh: null, notes: [], error: `gmsh exited 1\n${"x".repeat(400)}`, stages: [{ id: "mesh", label: "Mesh it (gmsh)", status: "failed" }] });
    const t = await resultsTool.execute({ runs: [done.url, failed.url, boxUrl] }, ctx);
    const lines = t.split("\n");
    expect(lines[0]).toBe("| run | status | highest stress | safety | largest movement | first mode | nodes |");
    expect(lines[2]).toBe("| box · static · Aluminium 6061-T6 · coarse | done in 12 s | 120 MPa | 2.3 | 150 µm | – | 12,345 |");
    expect(lines[3]).toMatch(/^\| box · static · Aluminium 6061-T6 · coarse \| failed: gmsh exited 1 \|/);
    expect(t).toContain(`1. ${done.url} — “box · static · Aluminium 6061-T6 · coarse”: done in 12 s.`);
    expect(t).toContain("   Asked: Analysis static; Material Aluminium 6061-T6: E 68.9 GPa, ν 0.33, 2700 kg/m³, yield 276 MPa; Fixed support Wall: 1 face; Force Push: 250 N down on 1 face; Mesh coarse, ten-node");
    // (how a place is written is results.js's: only that it is there is checked)
    expect(t).toMatch(/\n {3}Result: Highest stress 120 MPa at \([^)]+\)[^;]*; All but the top 1% 61 MPa; Safety factor 2\.3; Largest movement 150 µm at \([^)]+\)[^;.]*\.\n/);
    expect(t).toContain("   Forces: Wall carries 250 N (0, 250 N, 0); Push applies 250 N (0, −250 N, 0) over 2 cm².");
    expect(t).toContain("   Checks: Forces balance exactly; Energy against work agree; Work done by the loads 18.7 mJ.");
    expect(t).toContain("   Mesh: Nodes 12,345; Elements 7,000 ten-node tetrahedra; Element size 2.5 mm; Worst element 0.21.");
    expect(t).toContain("   Note: The highest stress is where a support holds the part. Read the stress a little way off.");
    expect(t).toContain(`2. ${failed.url} — “box · static · Aluminium 6061-T6 · coarse”: failed.`);
    expect(t).toContain(`   Failed at “Mesh it (gmsh)”: gmsh exited 1 ${"x".repeat(240 - "gmsh exited 1 ".length - 1)}…`);
    expect(t).toContain(`3. ${boxUrl}: couldn't be read (not an FEA run (file)).`);
  });
  it("reads a study's runs, oldest first", async () => {
    const s = await readyStudy();
    const a = (await runTool.execute({ study: s.url }, ctx)).made[0].url;
    const b = (await runTool.execute({ study: s.url }, ctx)).made[0].url;
    const t = await resultsTool.execute({ study: s.url }, ctx);
    expect(t).toMatch(/^FEA study “box · FEA” \(automerge:\S+\): 2 runs, oldest first\./);
    expect(t.indexOf(`1. ${a}`)).toBeLessThan(t.indexOf(`2. ${b}`));
    expect(t).toContain(`1. ${a} — “box · static · Aluminium 6061-T6 · coarse”: queued, waiting for the server.`);
    expect(t).toContain('Not finished: watch ["status"] with doc_watch until it is done, failed, cancelled.');
    await expect(resultsTool.execute({}, ctx)).rejects.toThrow("Pass `runs` (run URLs) or `study` (a study's URL: all its runs).");
  });
});

// ---------------------------------------------------------------- stopping

describe("fea_stop", () => {
  it("cancels a run that hasn't finished, leaves a finished one be, and names the session", async () => {
    const s = await readyStudy();
    const runUrl = (await runTool.execute({ study: s.url }, ctx)).made[0].url;
    const run = await repo.find(runUrl);
    const done = repo.add(doneRun(s.url));
    const task = await repo.find(run.doc().task);
    const runDocBefore = JSON.stringify(run.doc());
    const t = await stopTool.execute({ runs: [runUrl, done.url] }, ctx);
    // the stop is a record in the task, and the queue no longer lists it; the run doc isn't written
    expect(task.doc().runs).toEqual([{ id: expect.any(String), start: expect.any(Number), end: expect.any(Number), status: "cancelled" }]);
    expect(taskState(task.doc(), allHeard)).toBe("cancelled");
    expect(server.doc().jobs).toEqual({});
    expect(JSON.stringify(run.doc())).toBe(runDocBefore);
    expect(t).toContain(`${runUrl}: cancelled. If it hadn't started it never will, and its status field stays "queued" (fea_results shows it cancelled)`);
    expect(t).toContain(`${done.url}: already done; nothing to cancel.`);
    // read from both, it is cancelled: to the results and to stop
    expect(await resultsTool.execute({ runs: [runUrl] }, ctx)).toContain(`1. ${runUrl} — “box · static · Aluminium 6061-T6 · coarse”: cancelled.`);
    expect(await stopTool.execute({ runs: [runUrl] }, ctx)).toBe(`${runUrl}: already cancelled; nothing to cancel.`);
  });
  it("a run its queue no longer lists (it ended, as far as the queue knows) has nothing to cancel", async () => {
    const s = await readyStudy();
    const runUrl = (await runTool.execute({ study: s.url }, ctx)).made[0].url;
    server.change((d) => delete d.jobs[runUrl]);
    expect(await stopTool.execute({ runs: [runUrl] }, ctx)).toBe(`${runUrl}: its queue no longer lists that run, so there's nothing to cancel.`);
  });
  it("a run whose task failed (its code never wrote the run doc) reads failed, with the task's reason", async () => {
    const s = await readyStudy();
    const runUrl = (await runTool.execute({ study: s.url }, ctx)).made[0].url;
    const task = await repo.find((await repo.find(runUrl)).doc().task);
    task.change((d) => d.runs.push({ id: "r1", pool: "p", start: 1, end: 2, status: "failed", logs: [{ timestampMillis: 2, message: "its code would not load" }] }));
    expect(await resultsTool.execute({ runs: [runUrl] }, ctx)).toContain("   Failed: its code would not load");
    expect(await stopTool.execute({ runs: [runUrl] }, ctx)).toBe(`${runUrl}: already failed; nothing to cancel.`);
  });
  it("refuses what isn't a run, and cancels nothing", async () => {
    const s = await readyStudy();
    const runUrl = (await runTool.execute({ study: s.url }, ctx)).made[0].url;
    const run = await repo.find(runUrl);
    await expect(stopTool.execute({ runs: [runUrl, boxUrl] }, ctx)).rejects.toThrow(/is a file document, not an FEA run\. Nothing was cancelled\./);
    expect((await repo.find(run.doc().task)).doc().runs).toEqual([]);
    expect(Object.keys(server.doc().jobs)).toEqual([runUrl]);
    await expect(stopTool.execute({ runs: [] }, ctx)).rejects.toThrow("`runs` is a list of run URLs to cancel.");
  });
});

// ---------------------------------------------------------------- every write names the session

describe("change messages", () => {
  it("name the agent's session on every write to the study", async () => {
    const s = await readyStudy();
    await studyTool.execute({ study: s.url, title: "Bracket" }, ctx);
    await runTool.execute({ study: s.url }, ctx);
    expect(s.handle.messages.length).toBeGreaterThan(3);
    for (const m of s.handle.messages) expect(m).toMatch(new RegExp(`^agent ${SESSION}: `));
  });
});
