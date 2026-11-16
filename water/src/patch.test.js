// A bounded body's drawn patch (material.js patchGrid, createOceanSurface's
// patch) and water's parts (parts.js). Finite cases.
import { describe, expect, it } from "vitest";
import { createOceanSurface, patchGrid } from "./material.js";
import { fakeThree } from "./test/fake-three.js";
import { HAS_OPEN, open, pond, POND, waterObject } from "./parts.js";

describe("the patch", () => {
  for (const [w, l] of [[1, 1], [10, 4], [30, 30]])
    for (const yawD of [0, 30, 137])
      it(`${w}×${l} m turned ${yawD}°: every triangle faces up, and its corners are the footprint's, turned`, () => {
        const yaw = (yawD * Math.PI) / 180;
        const g = patchGrid(w, l, yaw, 0.5);
        const P = g.positions;
        for (let i = 0; i < g.indices.length; i += 3) {
          const [a, b, c] = [g.indices[i], g.indices[i + 1], g.indices[i + 2]].map((k) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]);
          // (b − a) × (c − a) points up
          const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
          expect(ny).toBeGreaterThan(0);
        }
        const turn = ([u, v]) => [u * Math.cos(yaw) + v * Math.sin(yaw), -u * Math.sin(yaw) + v * Math.cos(yaw)];
        const corners = [0, g.nx, g.nz * (g.nx + 1), (g.nz + 1) * (g.nx + 1) - 1].map((k) => [P[k * 3], P[k * 3 + 2]]);
        const want = [[-w / 2, -l / 2], [w / 2, -l / 2], [-w / 2, l / 2], [w / 2, l / 2]].map(turn);
        corners.forEach((c, i) => {
          expect(c[0]).toBeCloseTo(want[i][0], 5);
          expect(c[1]).toBeCloseTo(want[i][1], 5);
        });
      });

  it("stands at its body's origin, and turns or resizes in place", () => {
    const THREE = fakeThree();
    const s = createOceanSurface(THREE, { components: [], seed: 1, stats: {}, wind: { speed: 0, from: 0 } }, { patch: { w: 4, l: 2 } });
    expect(s.object.name).toBe("water-patch");
    s.update(0, [3, -0.5, 7]);
    expect([s.object.position.x, s.object.position.y, s.object.position.z]).toEqual([3, -0.5, 7]);
    const before = s.object.geometry.attributes.position.array;
    s.setPatch(4, 2, Math.PI / 2);
    expect(s.object.geometry.attributes.position.array).toBe(before);
    s.setPatch(8, 2, Math.PI / 2);
    expect(s.object.geometry.attributes.position.array).not.toBe(before);
    expect(s.object.material.uniforms.uInner.value).toBe(1e9);
  });
});

describe("water's parts", () => {
  const run = async (part, world) => {
    const d = { objects: {}, order: [] };
    const id = await part.create({ newId: (p) => `${p}1`, change: (fn) => fn(d) }, { world });
    return { id, d };
  };
  it("open water: one object with no source and no size, at the height it was put, level", async () => {
    const { id, d } = await run(open, { position: [3, 1.5, -2], rotation: [0.2, 0.7, 0], scale: 1 });
    expect(d.order).toEqual([id]);
    expect(d.objects[id]).toEqual(waterObject({ name: "Water", position: [3, 1.5, -2] }));
    expect(d.objects[id].traits).toEqual({ water: {} });
    expect(d.objects[id].sourceUrl).toBeNull();
  });
  // the doc's water before the part (W24's open bodies, by id), and what each part leaves (W26's rule, for water's own parts)
  const DOCS = {
    none: {},
    "a pond only": { p: waterObject({ name: "Pond", position: [0, 0, 0], size: POND }) },
    "one open": { s: waterObject({ name: "Sea", position: [0, 0, 0] }) },
    "two open": { s: waterObject({ name: "Sea", position: [0, 0, 0] }), r: waterObject({ name: "Water", position: [0, 2, 0] }) },
  };
  for (const [doc, objects] of Object.entries(DOCS))
    for (const [label, part] of [["Water", open], ["Pond", pond]])
      it(`${label} on a doc with ${doc}: a pond is always added; open water only where there is none, else a notice and nothing changed`, async () => {
        const d = { objects: structuredClone(objects), order: Object.keys(objects) };
        const before = structuredClone(d);
        const notices = [];
        const id = await part.create({ newId: (p) => `${p}1`, change: (fn) => fn(d), notify: (t) => notices.push(t) }, { world: { position: [1, 0, 1] } });
        const openBefore = Object.keys(objects).filter((k) => !objects[k].traits.water.size).sort();
        const adds = part === pond || openBefore.length === 0;
        if (adds) {
          expect(id).toBe("o1");
          expect(d.order).toEqual([...before.order, "o1"]);
          expect(Object.keys(d.objects).sort()).toEqual([...Object.keys(objects), "o1"].sort());
          expect(notices).toEqual([]);
        } else {
          // the doc's open body (the lowest id) is the answer, and the doc is as it was
          expect(id).toBe(openBefore[0]);
          expect(d).toEqual(before);
          expect(notices).toEqual([HAS_OPEN]);
        }
        // never a second open body made by a part
        const openAfter = Object.values(d.objects).filter((o) => !o.traits.water.size).length;
        expect(openAfter).toBe(Math.max(openBefore.length, part === open ? 1 : 0));
      });

  it("a pond: a box 10 m across and 1.5 m deep, turned as it was put, level", async () => {
    const { id, d } = await run(pond, { position: [3, 1.5, -2], rotation: [0.2, 0.7, 0], scale: 1 });
    expect(d.objects[id].traits).toEqual({ water: { size: [...POND] } });
    expect(d.objects[id].transform).toEqual({ position: [3, 1.5, -2], rotation: [0, 0.7, 0], scale: 1 });
  });
});
