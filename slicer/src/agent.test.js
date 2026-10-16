import { describe, it, expect } from "vitest";
import agent from "./agent.js";
import { plugins } from "./index.js";
import { normalizeJob } from "./datatype.js";
import { FILAMENTS, SETTINGS } from "./settings.js";
import { FakeRepo } from "./test/fake-repo.js";
import { boxGlb, boxTris, fileDoc, renderDoc, toBinaryStl } from "./test/models.js";

function world() {
  const repo = new FakeRepo();
  const glb = repo.add(fileDoc("part.glb", boxGlb(0.02, 0.01, 0.02)));
  const render = repo.add(renderDoc({ title: "Bracket", glbUrl: glb.url }));
  const stl = repo.add(fileDoc("cube.stl", toBinaryStl(boxTris(5, 5, 5))));
  return { repo, glb, render, stl };
}

describe("prepare_slice", () => {
  it("makes a slice job pointing at a render, with settings and the filament's temperatures", async () => {
    const { repo, render } = world();
    const out = await agent.execute({ model: render.url, layerHeight: 0.12, infillDensity: 25, supports: true, filament: "PETG" }, { repo });
    expect(out.doc.kind).toBe("slice-job");
    const job = normalizeJob((await repo.find(out.doc.url)).doc());
    expect(job).toMatchObject({ title: "Bracket slice", source: render.url, auto: true });
    expect(job.settings).toMatchObject({ layerHeight: 0.12, firstLayerHeight: 0.2, infillDensity: 25, supports: true, filament: "PETG", nozzleTemp: FILAMENTS.PETG.nozzleTemp, bedTemp: FILAMENTS.PETG.bedTemp });
    expect(out.text).toMatch(/Created slice job automerge:/);
    expect(out.text).toMatch(/supports requested \(not generated\)/);
  });

  it("explicit temperatures beat the filament preset; junk is reported, not written", async () => {
    const { repo, stl } = world();
    const out = await agent.execute({ model: stl.url, filament: "ABS", nozzleTemp: 245, colour: "red", wallLoops: "lots" }, { repo });
    const job = normalizeJob((await repo.find(out.doc.url)).doc());
    expect(job.settings).toMatchObject({ filament: "ABS", nozzleTemp: 245, bedTemp: FILAMENTS.ABS.bedTemp, wallLoops: 3 });
    expect(out.text).toMatch(/unknown settings: colour/);
    expect(out.text).toMatch(/don't fit: wallLoops/);
  });

  it("re-points and updates an existing job", async () => {
    const { repo, render, stl } = world();
    const first = await agent.execute({ model: render.url }, { repo });
    const out = await agent.execute({ model: stl.url, job: first.doc.url, scale: 2, auto: false, title: "Cube" }, { repo });
    expect(out.doc.url).toBe(first.doc.url);
    const job = normalizeJob((await repo.find(first.doc.url)).doc());
    expect(job).toMatchObject({ source: stl.url, auto: false, title: "Cube" });
    expect(job.settings.scale).toBe(2);
    expect(out.text).toMatch(/^Updated/);
  });

  it("slices on request and returns the G-code URL", async () => {
    const { repo, stl } = world();
    const out = await agent.execute({ model: stl.url, slice: true }, { repo });
    const job = normalizeJob((await repo.find(out.doc.url)).doc());
    expect(job.gcodeUrl).toBeTruthy();
    expect(out.text).toContain(`G-code: ${job.gcodeUrl}`);
  });

  it("refuses a whole scene, an OpenSCAD doc, and a non-URL, saying what to pass instead", async () => {
    const { repo } = world();
    const scene = repo.add({ "@patchwork": { type: "scene" }, objects: {} });
    const scad = repo.add({ "@patchwork": { type: "openscad" } });
    await expect(agent.execute({ model: scene.url }, { repo })).rejects.toThrow(/renderUrl/);
    await expect(agent.execute({ model: scad.url }, { repo })).rejects.toThrow(/scene/);
    await expect(agent.execute({ model: "my bracket" }, { repo })).rejects.toThrow(/automerge URL/);
  });

  it("summarizes", () => {
    expect(agent.summarize({ model: "automerge:x", filament: "TPU" })).toMatch(/TPU slice job/);
  });
});

describe("plugin metadata", () => {
  it("every field but load survives structuredClone", () => {
    for (const p of plugins) {
      const { load, ...rest } = p;
      expect(typeof load).toBe("function");
      expect(() => structuredClone(rest)).not.toThrow();
    }
  });

  it("keeps the ids old documents and pins use", () => {
    expect(plugins.find((p) => p.type === "patchwork:tool").id).toBe("patchwork-slicer");
    expect(plugins.find((p) => p.type === "patchwork:tool").supportedDatatypes).toEqual(["slice-job", "file"]);
    expect(plugins.find((p) => p.type === "patchwork:datatype").id).toBe("slice-job");
    expect(plugins.find((p) => p.type === "agent:tool").id).toBe("prepare_slice");
  });

  it("the agent schema lists exactly the settings, with matching enums and ranges", () => {
    const props = plugins.find((p) => p.type === "agent:tool").input_schema.properties;
    const settingProps = Object.keys(props).filter((k) => !["model", "job", "title", "auto", "slice"].includes(k));
    expect(settingProps.sort()).toEqual(SETTINGS.map((s) => s.key).sort());
    for (const spec of SETTINGS) {
      const p = props[spec.key];
      if (spec.kind === "enum") expect(p.enum).toEqual(spec.options.map((o) => o.value));
      if (spec.kind === "number" || spec.kind === "integer") {
        expect(p.type).toBe(spec.kind);
        expect([p.minimum, p.maximum]).toEqual([spec.min, spec.max]);
      }
      if (spec.kind === "boolean") expect(p.type).toBe("boolean");
      if (spec.kind === "string") expect(p.type).toBe("string");
    }
  });

  it("the entry module has no imports (it runs in a worker)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(import.meta.url).replace(/agent\.test\.js$/, "index.js"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
