import { describe, it, expect } from "vitest";
import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { composeMatrix, decomposeMatrix, invertMatrix, multiplyMatrices, IDENTITY_MATRIX, applyMatrix } from "./transform.js";
import {
  ancestors,
  attachTargets,
  descendants,
  orphanTransforms,
  planAttach,
  reparentTransform,
  resolveParents,
  treeOrder,
  wouldCycle,
  worldMatrix,
  worldTransform,
} from "./hierarchy.js";
import { makeAnchor, resolveAnchor } from "./anchors.js";

const T1 = { position: [1, 2, 3], rotation: [0.3, -1.1, 2.0], scale: 2.5 };
const T2 = { position: [-4, 0.5, 7], rotation: [-0.7, 0.4, 0.2], scale: 0.4 };
const T3 = { position: [0.2, -1, 0], rotation: [1.2, 0.1, -2.5], scale: 1.5 };

const close = (a, b, digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

function obj(transform, parent) {
  return { name: "x", transform, ...(parent !== undefined ? { parent } : {}) };
}

describe("matrix maths", () => {
  it("decomposes what it composes", () => {
    for (const t of [T1, T2, T3, { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 1 }]) {
      close(composeMatrix(decomposeMatrix(composeMatrix(t))), composeMatrix(t));
    }
    const d = decomposeMatrix(composeMatrix(T1));
    close(d.position, T1.position);
    expect(d.scale).toBeCloseTo(T1.scale, 9);
  });

  it("decomposes like three (Matrix4.decompose + Euler XYZ)", () => {
    const m = multiplyMatrices(composeMatrix(T1), composeMatrix(T2));
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    new Matrix4().fromArray(m).decompose(p, q, s);
    const e = new Euler().setFromQuaternion(q, "XYZ");
    const ours = decomposeMatrix(m);
    close(ours.position, p.toArray());
    close(ours.rotation, [e.x, e.y, e.z]);
    expect(ours.scale).toBeCloseTo(s.x, 9);
  });

  it("inverts", () => {
    const m = composeMatrix(T1);
    close(multiplyMatrices(invertMatrix(m), m), IDENTITY_MATRIX);
    expect(invertMatrix(new Array(16).fill(0))).toBeNull();
  });

  it("multiplies in three's order", () => {
    const ours = multiplyMatrices(composeMatrix(T1), composeMatrix(T2));
    const three = new Matrix4().fromArray(composeMatrix(T1)).multiply(new Matrix4().fromArray(composeMatrix(T2)));
    close(ours, three.elements);
  });
});

describe("world matrices", () => {
  const objects = { a: obj(T1), b: obj(T2, "a"), c: obj(T3, "b") };

  it("composes parent world with local, like a three.js Object3D hierarchy", () => {
    const [a, b, c] = [T1, T2, T3].map((t) => {
      const o = new Object3D();
      o.position.fromArray(t.position);
      o.rotation.set(...t.rotation, "XYZ");
      o.scale.setScalar(t.scale);
      return o;
    });
    a.add(b);
    b.add(c);
    a.updateMatrixWorld(true);
    close(worldMatrix(objects, "c"), c.matrixWorld.elements);
    close(worldMatrix(objects, "a"), composeMatrix(T1));
  });

  it("treats a missing or self parent as the root", () => {
    const o = { a: obj(T1, "gone"), b: obj(T2, "b") };
    close(worldMatrix(o, "a"), composeMatrix(T1));
    close(worldMatrix(o, "b"), composeMatrix(T2));
  });

  it("anchors follow parents", () => {
    const anchor = makeAnchor([1, 1, 1], "c", worldMatrix(objects, "c"));
    close(resolveAnchor(anchor, objects).world, [1, 1, 1]);
    const moved = { ...objects, a: obj({ ...T1, position: [11, 2, 3] }) };
    const r = resolveAnchor(anchor, moved);
    expect(r.attached).toBe(true);
    close(r.world, [11, 1, 1]); // the grandparent moved +10 in x
  });
});

describe("cycles", () => {
  it("breaks a cycle in the doc at its smallest id, the same way every time", () => {
    const objects = { b: obj(T1, "c"), c: obj(T2, "a"), a: obj(T3, "b"), d: obj(T1, "a") };
    const p = resolveParents(objects);
    expect(p.get("a")).toBeNull();
    expect(p.get("b")).toBe("c");
    expect(p.get("c")).toBe("a");
    expect(p.get("d")).toBe("a");
    const reordered = resolveParents({ d: objects.d, a: objects.a, c: objects.c, b: objects.b });
    expect([...reordered.entries()].sort()).toEqual([...p.entries()].sort());
    expect(ancestors(objects, "b")).toEqual(["c", "a"]);
    expect(Number.isFinite(worldMatrix(objects, "b")[12])).toBe(true);
  });

  it("rejects an attachment that would loop", () => {
    const objects = { a: obj(T1), b: obj(T2, "a"), c: obj(T3, "b"), d: obj(T1) };
    expect(wouldCycle(objects, "a", "c")).toBe(true);
    expect(wouldCycle(objects, "a", "a")).toBe(true);
    expect(wouldCycle(objects, "c", "a")).toBe(false);
    expect(wouldCycle(objects, "a", null)).toBe(false);
    expect(planAttach(objects, "a", "c")).toBeNull();
    expect([...descendants(objects, "a")].sort()).toEqual(["b", "c"]);
    expect(attachTargets(objects, "a")).toEqual(["d"]);
    expect(attachTargets(objects, "c").sort()).toEqual(["a", "b", "d"]);
  });
});

describe("re-parenting preserves the world pose", () => {
  const objects = { a: obj(T1), b: obj(T2), c: obj(T3, "b") };

  it("attaching", () => {
    const before = worldMatrix(objects, "b");
    const plan = planAttach(objects, "b", "a");
    expect(plan.parent).toBe("a");
    const after = { ...objects, b: { ...objects.b, parent: plan.parent, transform: plan.transform } };
    close(worldMatrix(after, "b"), before);
    // and b's own child comes along unmoved
    close(worldMatrix(after, "c"), worldMatrix(objects, "c"));
  });

  it("detaching", () => {
    const before = worldMatrix(objects, "c");
    const plan = planAttach(objects, "c", null);
    expect(plan.parent).toBeNull();
    close(composeMatrix(plan.transform), before);
    close(composeMatrix(reparentTransform(objects, "c", null)), before);
  });

  it("moving to another parent", () => {
    const before = worldMatrix(objects, "c");
    const plan = planAttach(objects, "c", "a");
    const after = { ...objects, c: { ...objects.c, parent: "a", transform: plan.transform } };
    close(worldMatrix(after, "c"), before);
  });

  it("removing a parent orphans its children where they are", () => {
    const o = { a: obj(T1), b: obj(T2, "a"), c: obj(T3, "b"), d: obj(T3, "a") };
    const orphans = orphanTransforms(o, "a");
    expect(Object.keys(orphans).sort()).toEqual(["b", "d"]);
    close(composeMatrix(orphans.b), worldMatrix(o, "b"));
    const { a, ...rest } = o;
    const after = { ...rest, b: { ...o.b, parent: null, transform: orphans.b }, d: { ...o.d, parent: null, transform: orphans.d } };
    close(worldMatrix(after, "c"), worldMatrix(o, "c"));
    close(worldMatrix(after, "d"), worldMatrix(o, "d"));
    close(applyMatrix(composeMatrix(worldTransform(o, "c")), [1, 2, 3]), applyMatrix(worldMatrix(o, "c"), [1, 2, 3]));
  });
});

describe("outline order", () => {
  it("nests children under their parents, keeping order", () => {
    const objects = { a: obj(T1), b: obj(T2, "c"), c: obj(T3), d: obj(T1, "a"), e: obj(T1, "b") };
    expect(treeOrder(objects, ["a", "b", "c", "d", "e"])).toEqual([
      { id: "a", depth: 0 },
      { id: "d", depth: 1 },
      { id: "c", depth: 0 },
      { id: "b", depth: 1 },
      { id: "e", depth: 2 },
    ]);
  });
});

describe("merged cycles and re-parenting order", () => {
  it("brokenParents names the root each cycle was broken at, and nothing else", async () => {
    const { brokenParents } = await import("./hierarchy.js");
    const objects = {
      A: { parent: "B", transform: T1 },
      B: { parent: "A", transform: T2 },
      C: { parent: "A", transform: T1 },
      D: { parent: "gone", transform: T1 }, // dangling, not a cycle
    };
    expect(brokenParents(objects)).toEqual(["A"]);
    expect(brokenParents({ A: { parent: null }, B: { parent: "A" } })).toEqual([]);
    // clearing it leaves the resolved tree (and every world pose) unchanged
    const repaired = { ...objects, A: { ...objects.A, parent: null } };
    expect([...resolveParents(repaired)]).toEqual([...resolveParents(objects)]);
    for (const id of ["A", "B", "C"]) worldMatrix(repaired, id).forEach((v, i) => expect(v).toBeCloseTo(worldMatrix(objects, id)[i], 12));
  });

  it("re-parenting roots-first gives the viewport the resolved tree when an edge inverts", async () => {
    const { Viewport } = await import("./viewport.js");
    const { Group } = await import("three");
    // just enough of a Viewport for setParent: groups under a content root
    const fake = () => {
      const content = new Group();
      const objects = new Map();
      const ensureObject = (id) => {
        if (!objects.has(id)) {
          const group = new Group();
          content.add(group);
          objects.set(id, { group });
        }
        return objects.get(id);
      };
      return { content, objects, ensureObject, setParent: Viewport.prototype.setParent };
    };
    const parentOf = (v, id) => [...v.objects].find(([, e]) => e.group === v.objects.get(id).group.parent)?.[0] ?? null;
    const apply = (v, ids, parents) => {
      for (const id of ids) {
        v.ensureObject(id);
        v.setParent(id, parents.get(id) ?? null);
      }
    };
    // before: A under B. After a merge of "A → B" with "B → A": B under A (cycle broken at A).
    const before = { A: { parent: "B" }, B: { parent: null } };
    const after = { A: { parent: "B" }, B: { parent: "A" } };
    const order = ["B", "A"];
    const plain = fake();
    apply(plain, order, resolveParents(before));
    apply(plain, order, resolveParents(after));
    expect(parentOf(plain, "B")).toBeNull(); // the bug: B fell to the root
    const tree = fake();
    apply(tree, order, resolveParents(before));
    const parents = resolveParents(after);
    apply(tree, treeOrder(after, order, parents).map((r) => r.id), parents);
    expect(parentOf(tree, "A")).toBeNull();
    expect(parentOf(tree, "B")).toBe("A");
  });
});
