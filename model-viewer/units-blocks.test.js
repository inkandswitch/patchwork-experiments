import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { convert3dm, loadRhino, rhinoUnit, RHINO_UNIT_METRES, RHINO_URL } from "./source.js";

let rhino;
beforeAll(async () => { rhino = await loadRhino(); }, 60000);

const v = (e) => (e && typeof e === "object" && "value" in e ? e.value : e);

/** The GLB's JSON chunk. */
function gltfJSON(glb) {
  const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
}
/** Each mesh's name and sRGB base colour as #rrggbb. */
function groups(glb) {
  const j = gltfJSON(glb);
  const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  return j.meshes.map((m) => {
    const f = j.materials[m.primitives[0].material].pbrMetallicRoughness.baseColorFactor;
    return { name: m.name, color: "#" + f.slice(0, 3).map((c) => Math.round(srgb(c) * 255).toString(16).padStart(2, "0")).join("") };
  });
}

describe("rhino3dm under test", () => {
  it("is the version source.js loads from the CDN", () => {
    const req = createRequire(import.meta.url);
    const { version } = JSON.parse(readFileSync(req.resolve("rhino3dm/package.json"), "utf8"));
    expect(RHINO_URL).toContain(`rhino3dm@${version}/`);
  });
});

describe("units", () => {
  // Every unit system rhino3dm has: either we know its scale, or it's one of
  // the three with no scale (and gets the mm fallback, said in the notes).
  it("covers every UnitSystem rhino3dm knows, by name", () => {
    const names = Object.keys(rhino.UnitSystem).filter((k) => typeof rhino.UnitSystem[k] === "object" && k !== "values");
    const unscaled = names.filter((n) => !(n in RHINO_UNIT_METRES)).sort();
    expect(unscaled).toEqual(["CustomUnits", "None", "Unset"]);
    for (const n of Object.keys(RHINO_UNIT_METRES)) expect(names).toContain(n);
    for (const n of names) {
      const u = rhinoUnit(rhino, v(rhino.UnitSystem[n]));
      if (n in RHINO_UNIT_METRES) expect(u.metres).toBe(RHINO_UNIT_METRES[n]);
      else expect(u).toBeNull();
    }
  });

  // A sphere one unit across, in each of the units the old table got wrong
  // (and two it got right), comes out that many metres tall.
  for (const [unit, metres] of [["Yards", 0.9144], ["Megameters", 1e6], ["Gigameters", 1e9], ["Millimeters", 0.001], ["Feet", 0.3048]]) {
    it(`reads ${unit}`, async () => {
      const f = new rhino.File3dm();
      f.settings().modelUnitSystem = rhino.UnitSystem[unit];
      f.objects().addSphere(new rhino.Sphere([0, 0, 0], 0.5), null);
      const { meta } = await convert3dm(f.toByteArray(), {});
      expect((meta.bounds.max[1] - meta.bounds.min[1]) / metres).toBeCloseTo(1, 4);
    });
  }

  it("says when a file has no known units", async () => {
    const f = new rhino.File3dm();
    f.settings().modelUnitSystem = rhino.UnitSystem.None;
    f.objects().addSphere(new rhino.Sphere([0, 0, 0], 500), null);
    const { meta } = await convert3dm(f.toByteArray(), {});
    expect(meta.bounds.max[1] - meta.bounds.min[1]).toBeCloseTo(1, 4); // read as mm
    expect(meta.notes).toContain("no known units");
  });
});

describe("blocks", () => {
  // One block whose part is on layer B (green) or hidden, placed on layer A
  // (blue, or with its own colour red), translated 10 m along x.
  function blockFile({ partSource = "ColorFromLayer", partLayerVisible = true, refColor = null } = {}) {
    const f = new rhino.File3dm();
    f.settings().modelUnitSystem = rhino.UnitSystem.Meters;
    const layer = (name, r, g, b, visible = true) => { const l = new rhino.Layer(); l.name = name; l.color = { r, g, b, a: 255 }; l.visible = visible; return f.layers().add(l); };
    const A = layer("A", 0, 0, 255), B = layer("B", 0, 255, 0, partLayerVisible);
    const part = new rhino.ObjectAttributes();
    part.layerIndex = B;
    part.colorSource = rhino.ObjectColorSource[partSource];
    f.instanceDefinitions().add("blk", "", "", "", [0, 0, 0], [new rhino.Sphere([0, 0, 0], 0.5).toBrep()], [part]);
    const ref = new rhino.ObjectAttributes();
    ref.layerIndex = A;
    if (refColor) { ref.colorSource = rhino.ObjectColorSource.ColorFromObject; ref.objectColor = refColor; }
    f.objects().addInstanceObject(new rhino.InstanceReference(f.instanceDefinitions().get(0).id, rhino.Transform.translationXYZ(10, 0, 0)), ref);
    return f.toByteArray();
  }

  it("places the part where the reference puts it", async () => {
    const { meta } = await convert3dm(blockFile(), {});
    expect(meta.bounds.min[0]).toBeCloseTo(9.5, 4);
    expect(meta.bounds.max[0]).toBeCloseTo(10.5, 4);
  });

  it("keeps a by-layer part on its own layer, in that layer's colour", async () => {
    expect(groups((await convert3dm(blockFile(), {})).glb)).toEqual([{ name: "B", color: "#00ff00" }]);
  });

  it("gives a by-parent part the block's colour, on its own layer", async () => {
    expect(groups((await convert3dm(blockFile({ partSource: "ColorFromParent" }), {})).glb)).toEqual([{ name: "B", color: "#0000ff" }]);
    const red = { r: 255, g: 0, b: 0, a: 255 };
    expect(groups((await convert3dm(blockFile({ partSource: "ColorFromParent", refColor: red }), {})).glb)).toEqual([{ name: "B", color: "#ff0000" }]);
  });

  it("hides a part on a hidden layer unless hidden objects are asked for", async () => {
    const bytes = blockFile({ partLayerVisible: false });
    expect(gltfJSON((await convert3dm(bytes, {})).glb).meshes).toBeUndefined();
    expect(groups((await convert3dm(bytes, { hidden: true })).glb)).toEqual([{ name: "B", color: "#00ff00" }]);
  });
});
