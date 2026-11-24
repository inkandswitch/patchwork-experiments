import { describe, it, expect, beforeAll } from "vitest";
import { convert3dm, loadRhino, rhinoUnit, RHINO_UNIT_METRES } from "./source.js";

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

  it("builds a part on a hidden layer, and declares that layer hidden (the scene shows or hides it)", async () => {
    const { glb } = await convert3dm(blockFile({ partLayerVisible: false }), {});
    expect(groups(glb)).toEqual([{ name: "B", color: "#00ff00" }]);
    const j = gltfJSON(glb);
    expect(j.scenes[0].extras.layers.map((l) => [l.name, l.visible])).toEqual([["B", false]]);
    expect(j.nodes[0].extras.layer).toBe(j.scenes[0].extras.layers[0].id);
  });
});

describe("layers", () => {
  // layers: Outside (hidden) > Inside; Spare (no geometry); Loose. One sphere
  // on Inside, one on Loose, one hidden object on Loose.
  function layeredFile() {
    const f = new rhino.File3dm();
    f.settings().modelUnitSystem = rhino.UnitSystem.Meters;
    const add = (name, { parent = null, visible = true } = {}) => {
      const l = new rhino.Layer();
      l.name = name;
      l.visible = visible;
      if (parent != null) l.parentLayerId = f.layers().get(parent).id;
      return f.layers().add(l);
    };
    const outside = add("Outside", { visible: false });
    const inside = add("Inside", { parent: outside });
    add("Spare");
    const loose = add("Loose");
    const on = (layerIndex, x, visible = true) => {
      const a = new rhino.ObjectAttributes();
      a.layerIndex = layerIndex;
      a.visible = visible;
      f.objects().add(new rhino.Sphere([x, 0, 0], 0.5).toBrep(), a);
    };
    on(inside, 0);
    on(loose, 10);
    on(loose, 20, false);
    return f.toByteArray();
  }

  it("declares each layer with geometry and the layers it's in, in the file's order, by Rhino's layer id", async () => {
    const j = gltfJSON((await convert3dm(layeredFile(), {})).glb);
    const table = j.scenes[0].extras.layers;
    expect(table.map((l) => [l.name, l.visible, l.parent ? table.find((p) => p.id === l.parent).name : null])).toEqual([
      ["Outside", false, null],
      ["Inside", true, "Outside"],
      ["Loose", true, null],
    ]);
    for (const l of table) expect(l.id).toMatch(/^[0-9a-f-]{36}$/);
    // each mesh node is on its layer
    const nameOf = Object.fromEntries(table.map((l) => [l.id, l.name]));
    expect(j.nodes.map((n) => nameOf[n.extras.layer]).sort()).toEqual(["Inside", "Loose"]);
  });

  it("leaves out an object hidden in the file unless asked for, and bounds what the file shows", async () => {
    const shown = await convert3dm(layeredFile(), {});
    // Inside is hidden with Outside: only Loose's sphere at x = 10 counts
    expect([shown.meta.bounds.min[0], shown.meta.bounds.max[0]]).toEqual([9.5, 10.5]);
    expect(shown.meta.notes).toMatch(/^2 objects, .* 3 layers \(2 hidden\)/);
    const all = await convert3dm(layeredFile(), { hidden: true });
    expect(all.meta.notes).toMatch(/^3 objects/);
    expect([all.meta.bounds.min[0], all.meta.bounds.max[0]]).toEqual([9.5, 20.5]);
  });
});
