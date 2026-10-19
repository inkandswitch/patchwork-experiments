import { readGcode } from "./output.js";
import { describe, it, expect } from "vitest";
import { sliceJob } from "./job.js";
import { newJobDoc, normalizeJob } from "./datatype.js";
import { decide } from "./staleness.js";
import { currentSourceKey } from "./source.js";
import { readProvenance } from "./gcode.js";
import { fileBytes } from "./render-read.js";
import { settingsKey } from "./settings.js";
import { FakeRepo } from "./test/fake-repo.js";
import { boxGlb, boxTris, fileDoc, renderDoc, toBinaryStl } from "./test/models.js";

/** A scene render of a 20 × 10 × 30 mm box (Y up, metres), and its job. */
function setup(jobFields = {}) {
  const repo = new FakeRepo();
  const glb = repo.add(fileDoc("part.glb", boxGlb(0.02, 0.01, 0.03)));
  const part = repo.add({ title: "Part source" });
  const render = repo.add(renderDoc({ title: "Part", parent: part.url, glbUrl: glb.url }));
  const job = repo.add(newJobDoc({ title: "Part slice", source: render.url, ...jobFields }));
  return { repo, glb, part, render, job };
}

const gcodeOf = async (repo, url) => readGcode((await repo.find(url)).doc(), fileBytes);
const keysNow = async (repo, j) => ({ ...(await currentSourceKey(j.source, (await repo.find(j.source)).doc())), settingsKey: settingsKey(j.settings) });

describe("sliceJob", () => {
  it("slices a scene render as metres and records what it was built from", async () => {
    const { repo, render, job, part } = setup();
    const r = await sliceJob({ repo, handle: job, now: () => 1234 });
    expect(r.ok).toBe(true);
    const j = normalizeJob(job.doc());
    expect(j.status).toBe("idle");
    expect(j.gcodeUrl).toBe(r.gcodeUrl);
    expect(j.builtAt).toBe(1234);
    expect(j.builtFrom).toMatchObject({ sourceKey: `${render.url} render:${render.doc().glbUrl}`, settingsKey: settingsKey(j.settings), sourceUrl: render.url });
    expect(j.builtFrom.gcodeHash).toMatch(/^(sha256|c53):/);
    expect(j.stats.sizeMm[0]).toBeCloseTo(20, 1);
    expect(j.stats.sizeMm[2]).toBeCloseTo(10, 1); // the GLB's Z (depth) becomes print Y; its Y is print height
    expect(j.stats.sizeMm[1]).toBeCloseTo(30, 1);
    expect(j.stats).toMatchObject({ unit: "m", unitSource: "render", layers: 50 });
    const prov = readProvenance(await gcodeOf(repo, j.gcodeUrl));
    expect(prov).toMatchObject({ job: job.url, source: render.url, source_kind: "scene-render", render_of: part.url, units: "m (render)" });
    expect(prov.source_key).toBe(j.builtFrom.sourceKey);
    expect(decide(j, await keysNow(repo, j)).state).toBe("fresh");
  });

  it("re-slicing unchanged inputs keeps the same G-code doc", async () => {
    const { repo, job } = setup();
    const a = await sliceJob({ repo, handle: job });
    const n = repo.created.length;
    // a forced re-slice (button) after the job was renamed
    job.change((d) => void (d.title = "Renamed"));
    const b = await sliceJob({ repo, handle: job });
    expect(b.gcodeUrl).toBe(a.gcodeUrl);
    expect(b.reused).toBe(true);
    expect(repo.created.length).toBe(n);
  });

  it("goes stale when the render gets a new GLB, not when it is renamed", async () => {
    const { repo, render, job } = setup();
    await sliceJob({ repo, handle: job });
    render.change((d) => {
      d.title = "Part (renamed)";
      d.status = "building";
    });
    let j = normalizeJob(job.doc());
    expect(decide(j, await keysNow(repo, j)).state).toBe("fresh");
    const glb2 = repo.add(fileDoc("part.glb", boxGlb(0.02, 0.01, 0.04)));
    render.change((d) => void (d.glbUrl = glb2.url));
    j = normalizeJob(job.doc());
    expect(decide(j, await keysNow(repo, j))).toMatchObject({ state: "stale", reason: "source", slice: true });
    const first = j.gcodeUrl;
    const r = await sliceJob({ repo, handle: job });
    expect(r.gcodeUrl).not.toBe(first);
    expect(normalizeJob(job.doc()).stats.sizeMm[1]).toBeCloseTo(40, 1);
  });

  it("changing the layer height re-slices and leaves the first layer alone", async () => {
    const { repo, job } = setup();
    await sliceJob({ repo, handle: job });
    job.change((d) => void (d.settings.layerHeight = 0.1));
    const j = normalizeJob(job.doc());
    expect(j.settings.firstLayerHeight).toBe(0.2);
    expect(decide(j, await keysNow(repo, j)).reason).toBe("settings");
    await sliceJob({ repo, handle: job });
    expect(normalizeJob(job.doc()).stats.layers).toBe(1 + Math.round((10 - 0.2) / 0.1));
  });

  it("slices an STL file in its unit setting (default mm)", async () => {
    const repo = new FakeRepo();
    const stl = repo.add(fileDoc("cube.stl", toBinaryStl(boxTris(2, 2, 2))));
    const job = repo.add(newJobDoc({ source: stl.url }));
    const r = await sliceJob({ repo, handle: job });
    expect(r.ok).toBe(true);
    expect(normalizeJob(job.doc()).stats).toMatchObject({ unit: "mm", unitSource: "setting", layers: 10, sizeMm: [2, 2, 2] });
    job.change((d) => void (d.settings.stlUnit = "cm"));
    const r2 = await sliceJob({ repo, handle: job });
    expect(r2.ok).toBe(true);
    expect(normalizeJob(job.doc()).stats).toMatchObject({ layers: 100, sizeMm: [20, 20, 20] });
  });

  it("records a failure with its inputs, so auto mode doesn't loop on it", async () => {
    const repo = new FakeRepo();
    const glb = repo.add(fileDoc("hull.glb", boxGlb(10, 2, 3))); // a 10 m hull, kit GLB, metres
    const job = repo.add(newJobDoc({ source: glb.url }));
    const r = await sliceJob({ repo, handle: job });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/10000\.0 × 3000\.0 × 2000\.0 mm/);
    let j = normalizeJob(job.doc());
    expect(j.status).toBe("error");
    expect(j.errorFrom.sourceKey).toMatch(/sha256|c53/);
    expect(decide(j, await keysNow(repo, j))).toMatchObject({ state: "error", slice: false });
    // scale it down to 1:50 and it slices
    job.change((d) => void (d.settings.scale = 0.02));
    j = normalizeJob(job.doc());
    expect(decide(j, await keysNow(repo, j)).slice).toBe(true);
    const r2 = await sliceJob({ repo, handle: job });
    expect(r2.ok).toBe(true);
    expect(normalizeJob(job.doc())).toMatchObject({ status: "idle", error: null, errorFrom: null });
  });

  it("waits, without recording an error, for a render that isn't built", async () => {
    const repo = new FakeRepo();
    const render = repo.add(renderDoc({ glbUrl: null }));
    const job = repo.add(newJobDoc({ source: render.url }));
    const r = await sliceJob({ repo, handle: job });
    expect(r).toMatchObject({ ok: false, code: "unbuilt" });
    expect(normalizeJob(job.doc())).toMatchObject({ status: "idle", error: null });
  });

  it("an old bambu-slicer job slices its modelUrl", async () => {
    const repo = new FakeRepo();
    const stl = repo.add(fileDoc("cube.stl", toBinaryStl(boxTris(20, 20, 20))));
    const job = repo.add({ title: "Old", modelUrl: stl.url, settings: { layerHeight: 0.25, infillDensity: 20, filament: "PETG", printSpeed: 100, wallLoops: 2 }, printer: "BambuLab H2D" });
    const r = await sliceJob({ repo, handle: job });
    expect(r.ok).toBe(true);
    const g = await gcodeOf(repo, job.doc().gcodeUrl);
    expect(readProvenance(g).source).toBe(stl.url);
    expect(JSON.parse(readProvenance(g).settings)).toMatchObject({ layerHeight: 0.25, wallSpeed: 100, wallLoops: 2, printer: "BambuLab H2D" });
    expect(job.doc().modelUrl).toBe(stl.url); // never rewritten
  });

  it("an OpenSCAD source is refused with directions", async () => {
    const repo = new FakeRepo();
    const scad = repo.add({ "@patchwork": { type: "openscad" }, content: "cube(10);" });
    const job = repo.add(newJobDoc({ source: scad.url }));
    const r = await sliceJob({ repo, handle: job });
    expect(r).toMatchObject({ ok: false, code: "unsupported" });
    expect(r.error).toMatch(/scene/);
  });
});
