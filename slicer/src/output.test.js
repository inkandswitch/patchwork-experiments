import { describe, it, expect } from "vitest";
import { gcodeFileDoc, gcodeName, hashBytes, saveGcode } from "./output.js";
import { generateGcode, provenanceHeader, readProvenance } from "./gcode.js";
import { buildToolpaths } from "./toolpaths.js";
import { DEFAULT_SETTINGS, stableStringify } from "./settings.js";
import { parseGcodePreview } from "./gcode-preview.js";
import { FakeRepo } from "./test/fake-repo.js";
import { hexPrism } from "./test/models.js";

const SRC = "automerge:2j9mK3vG7pQx4TzR8wYbN5cD6eF1";
const JOB = "automerge:3k8nL4wH8qRy5UaS9xZcP6dE7fG2";

const prov = (o = {}) => ({ job: JOB, source: SRC, sourceKind: "scene-render", sourceKey: `${SRC} render:automerge:abc`, renderOf: "automerge:part", unit: "m", unitSource: "render", scale: 1, settings: DEFAULT_SETTINGS, ...o });

describe("G-code file docs", () => {
  it("one file doc of bytes, named after the job", () => {
    const d = gcodeFileDoc("Hull (3D render)", new Uint8Array([59]));
    expect(d).toMatchObject({ "@patchwork": { type: "file" }, name: "Hull (3D render).gcode", extension: "gcode" });
    expect(d.content).toBeInstanceOf(Uint8Array);
    expect(gcodeName("part.stl")).toBe("part.gcode");
    expect(gcodeName("")).toBe("slice.gcode");
  });

  it("keeps the current doc when the bytes are the same, makes a new one when they change", async () => {
    const repo = new FakeRepo();
    const first = await saveGcode({ repo, job: { title: "A", gcodeUrl: null, builtFrom: null }, gcode: "G28\n" });
    expect(first.reused).toBe(false);
    expect(repo.created.length).toBe(1);
    const job = { title: "A", gcodeUrl: first.url, builtFrom: { gcodeHash: first.hash } };
    const same = await saveGcode({ repo, job, gcode: "G28\n" });
    expect(same).toMatchObject({ url: first.url, reused: true });
    expect(repo.created.length).toBe(1);
    const changed = await saveGcode({ repo, job, gcode: "G28\nG1 X1\n" });
    expect(changed.reused).toBe(false);
    expect(changed.url).not.toBe(first.url);
    expect(repo.created.length).toBe(2);
  });

  it("hashes bytes stably", async () => {
    const a = await hashBytes(new TextEncoder().encode("abc"));
    expect(a).toBe(await hashBytes(new TextEncoder().encode("abc")));
    expect(a).not.toBe(await hashBytes(new TextEncoder().encode("abd")));
  });
});

describe("provenance", () => {
  it("the header names the job, source, source key, units and settings", () => {
    const lines = provenanceHeader(prov());
    const back = readProvenance(lines.join("\n"));
    expect(back).toMatchObject({ job: JOB, source: SRC, source_kind: "scene-render", source_key: `${SRC} render:automerge:abc`, render_of: "automerge:part", units: "m (render)", scale: "1" });
    expect(JSON.parse(back.settings)).toEqual(JSON.parse(stableStringify(DEFAULT_SETTINGS)));
  });

  it("the same inputs give byte-identical G-code (no timestamps), so dedupe works", async () => {
    const s = { ...DEFAULT_SETTINGS };
    const a = generateGcode(await buildToolpaths(hexPrism(10, 4), s), s, prov());
    const b = generateGcode(await buildToolpaths(hexPrism(10, 4), s), s, prov());
    expect(a.gcode).toBe(b.gcode);
    expect(readProvenance(a.gcode).source).toBe(SRC);
    const c = generateGcode(await buildToolpaths(hexPrism(10, 4), s), s, prov({ sourceKey: "other" }));
    expect(c.gcode).not.toBe(a.gcode);
  });

  it("comments can't be broken by a newline in a value", () => {
    expect(provenanceHeader(prov({ source: "a\nG28" })).some((l) => l === "G28")).toBe(false);
  });

  it("the preview reads back the layers and features gcode.js wrote", async () => {
    const s = { ...DEFAULT_SETTINGS };
    const tp = await buildToolpaths(hexPrism(20, 10), s);
    const p = parseGcodePreview(generateGcode(tp, s, prov()).gcode);
    expect(p.layers).toBe(tp.layers.length);
    expect(p.positions.wall.length).toBeGreaterThan(0);
    expect(p.positions.infill.length).toBeGreaterThan(0);
    expect(p.layerEnds.wall.length).toBe(p.layers);
    expect(p.layerEnds.wall.at(-1)).toBe(p.positions.wall.length / 3);
    // the first layer's walls sit at the first layer's height
    expect(p.positions.wall[2]).toBeCloseTo(s.firstLayerHeight);
  });
});
