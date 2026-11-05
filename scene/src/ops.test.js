// The structural doc verbs as planners, without the tool around them. These
// port the doc-level assertions of tool.test.js and tool-v3.test.js (attach,
// remove, ungroup, new group, file in, the outline's row moves), and add
// several-id removal and the refusals.
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { attachTo, docOf, fileIn, moveRow, newGroup, orderedIds, removeObjects, repairCycles, REASONS, setField, setTransform, setTransformPart, ungroup } from "./ops.js";
import { resolveParents, worldMatrix } from "./hierarchy.js";
import { placementFor } from "./tree-drop.js";
import { outlineParents } from "./groups.js";
import { applyMatrix } from "./transform.js";

const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const group = (name, inGroup = null, extra = {}) => ({ kind: "group", name, group: inGroup, visible: true, opacity: 1, ...extra });
const leaf = (name, { parent = null, group = null, x = 0, ...extra } = {}) => ({ kind: "object", name, parent, group, visible: true, opacity: 1, transform: T([x, 0, 0]), ...extra });

/** A doc from `objects` (order: their key order unless given). */
const docWith = (objects, order = Object.keys(objects)) => ({ objects, order, dimensions: {}, view: {} });

/** What api.change does with a plan, on a copy: the snapshot is never touched. */
function apply(doc, plan) {
  const draft = structuredClone(doc);
  plan(draft);
  return draft;
}

const origin = (objects, id) => applyMatrix(worldMatrix(objects, id), [0, 0, 0]);
const expectClose = (a, b, digits = 9) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
};

/**
 * vessel ─┬─ body ─┬─ hull
 *         │        └─ deck
 *         └─ bhd (hidden)
 * battery (hidden) ── cell
 *
 * (tool-v3.test.js's vesselScene after its upgrade: groups have no transform.)
 */
function vessel() {
  return docWith({
    vessel: group("Solander 38"),
    body: group("BODY", "vessel"),
    hull: leaf("HULL", { group: "body", x: 1 }),
    deck: leaf("DECK", { group: "body" }),
    bhd: leaf("console bhd", { group: "vessel", visible: false, x: 2 }),
    battery: group("Battery (display)", null, { visible: false }),
    cell: leaf("CELL", { group: "battery" }),
  });
}

describe("plan shapes", () => {
  it("a plan is a change function with ok and what a surface wants to know", () => {
    const plan = ungroup(vessel(), "body");
    expect(typeof plan).toBe("function");
    expect(plan.ok).toBe(true);
    expect({ ...plan }).toMatchObject({ id: "body", into: "vessel" });
  });

  it("a refusal is a change function that writes nothing, with a reason", () => {
    const doc = vessel();
    const plan = fileIn(doc, "vessel", "body");
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe(REASONS.groupInItself);
    expect(apply(doc, plan)).toEqual(doc);
  });

  it("null when what it names isn't there", () => {
    const doc = vessel();
    expect(removeObjects(doc, "nope")).toBeNull();
    expect(ungroup(doc, "hull")).toBeNull(); // not a group
    expect(fileIn(doc, "nope", "body")).toBeNull();
    expect(attachTo(doc, "nope", "hull")).toBeNull();
    expect(moveRow(doc, "nope", { parent: null, before: null })).toBeNull();
    expect(setField(doc, "nope", "name", "x")).toBeNull();
  });

  it("reads the stage's scene() snapshot as well as the doc", () => {
    const d = vessel();
    const scene = { d, objects: d.objects, parents: resolveParents(d.objects), groups: new Map() };
    expect(docOf(scene)).toBe(d);
    expect({ ...ungroup(scene, "body") }).toMatchObject({ ok: true, members: ["hull", "deck"] });
  });

  it("never mutates the snapshot", () => {
    const doc = vessel();
    const frozen = structuredClone(doc);
    for (const plan of [removeObjects(doc, ["vessel"]), ungroup(doc, "body"), newGroup(doc, { around: "bhd", id: "g9" }), fileIn(doc, "bhd", "battery")]) apply(doc, plan);
    expect(doc).toEqual(frozen);
  });

  it("orderedIds: the doc's order (no repeats, nothing missing), then anything it leaves out", () => {
    const doc = docWith({ a: leaf("a"), b: leaf("b"), c: leaf("c") }, ["b", "gone", "b", "a"]);
    expect(orderedIds(doc)).toEqual(["b", "a", "c"]);
  });
});

describe("attachTo", () => {
  // tool.test.js: "attaches an object in the inspector without moving it …"
  it("attaches without moving, and refuses the loop back", () => {
    const doc = docWith({
      a: leaf("a", { transform: T([1, 0, 0], [0, Math.PI / 2, 0], 2) }),
      b: leaf("b", { transform: T([1, 0, -2]) }),
    });
    const plan = attachTo(doc, "b", "a");
    expect({ ...plan }).toMatchObject({ ok: true, id: "b", parent: "a" });
    const next = apply(doc, plan);
    const ob = next.objects.b;
    expect(ob.parent).toBe("a");
    // a is at x=1, turned 90° about y (its x axis points along world -z), scale 2;
    // b at world (1,0,-2) is 2 m along that axis, i.e. 1 unit of a's local x
    expectClose(ob.transform.position, [1, 0, 0]);
    expectClose(ob.transform.rotation, [0, -Math.PI / 2, 0]);
    expect(ob.transform.scale).toBeCloseTo(0.5, 9);
    expectClose(origin(next.objects, "b"), [1, 0, -2]);

    // a can't be attached to b now (b is attached to a)
    const back = attachTo(next, "a", "b");
    expect(back.ok).toBe(false);
    expect(back.reason).toBe(REASONS.attachLoop);
    expect(attachTo(next, "a", "a").ok).toBe(false);
  });

  // tool.test.js: "an attach clears the edge a merged cycle left behind …"
  it("clears the edge a merged cycle left behind, so the loser doesn't jump later", () => {
    const doc = docWith({
      a: leaf("a", { parent: "b", x: 5 }), // as two concurrent attaches merge
      b: leaf("b", { parent: "a" }),
      c: leaf("c", { transform: T([0, 0, 7]) }),
    });
    const next = apply(doc, attachTo(doc, "b", "c"));
    expect(next.objects.b.parent).toBe("c");
    expect(next.objects.a.parent).toBeNull(); // not silently re-attached to b
    expect(next.objects.a.transform.position).toEqual([5, 0, 0]);
  });

  it("detaches to the world pose; null when nothing would change", () => {
    const doc = docWith({ a: leaf("a", { x: 2, transform: T([2, 0, 0], [0, 0, 0], 3) }), b: leaf("b", { parent: "a", x: 1 }) });
    const next = apply(doc, attachTo(doc, "b", null));
    expect(next.objects.b.parent).toBeNull();
    expectClose(next.objects.b.transform.position, [5, 0, 0]);
    expect(next.objects.b.transform.scale).toBeCloseTo(3, 9);
    expect(attachTo(doc, "b", "a")).toBeNull();
    expect(attachTo(doc, "a", null)).toBeNull();
  });

  it("refuses groups at either end", () => {
    const doc = vessel();
    expect(attachTo(doc, "body", "hull").reason).toBe(REASONS.attachGroup);
    expect(attachTo(doc, "hull", "body").reason).toBe(REASONS.attachToGroup);
  });
});

describe("removeObjects", () => {
  // tool.test.js: "… and orphans it on remove"
  it("leaves what was attached to a removed object where it is in the world, at the root", () => {
    const doc = docWith({
      a: leaf("a", { transform: T([3, 0, 0], [0, Math.PI / 2, 0], 2) }),
      b: leaf("b", { parent: "a", transform: T([1, 0, 0], [0, -Math.PI / 2, 0], 0.5) }),
    });
    const plan = removeObjects(doc, "a");
    expect({ ...plan }).toMatchObject({ ok: true, ids: ["a"], within: [], orphans: ["b"] });
    const next = apply(doc, plan);
    expect(next.objects.a).toBeUndefined();
    expect(next.order).toEqual(["b"]);
    expect(next.objects.b.parent).toBeNull();
    expectClose(next.objects.b.transform.position, [3, 0, -2]);
    expect(next.objects.b.transform.scale).toBeCloseTo(1, 9);
  });

  // tool-v3.test.js: "removing a group asks, with a count, and takes everything in it"
  it("a group goes with everything in it, and says how many for a confirm", () => {
    const doc = vessel();
    doc.dimensions.d1 = { a: { objectId: "hull", local: [0, 0, 0], world: [0, -0.7, 0] }, b: { objectId: null, local: null, world: [1, 0, 0] }, label: null };
    const plan = removeObjects(doc, "vessel");
    expect(plan.ids[0]).toBe("vessel");
    expect([...plan.within].sort()).toEqual(["bhd", "body", "deck", "hull"]);
    const next = apply(doc, plan);
    expect(Object.keys(next.objects).sort()).toEqual(["battery", "cell"]);
    expect(next.order).toEqual(["battery", "cell"]);
    // dimensions are the dimensions extension's (beforeRemove), not ops'
    expect(next.dimensions).toEqual(doc.dimensions);
  });

  it("several at once: one plan, each taken once, missing ones ignored", () => {
    const doc = vessel();
    const plan = removeObjects(doc, ["hull", "battery", "body", "nope", "hull"]);
    expect([...plan.ids].sort()).toEqual(["battery", "body", "cell", "deck", "hull"]);
    expect(plan.ids.slice(0, 3)).toEqual(["hull", "battery", "body"]); // the named ones first
    expect([...plan.within].sort()).toEqual(["cell", "deck"]); // hull was named
    const next = apply(doc, plan);
    expect(Object.keys(next.objects).sort()).toEqual(["bhd", "vessel"]);
    expect(next.order).toEqual(["vessel", "bhd"]);
    expect(removeObjects(doc, [])).toBeNull();
    expect(removeObjects(doc, ["nope"])).toBeNull();
  });

  it("an object attached to two removed ones in a chain is orphaned only if it stays", () => {
    // a ← b ← c, d attached to b. Removing a and b: c and d go to the root, where they are.
    const doc = docWith({
      a: leaf("a", { x: 1 }),
      b: leaf("b", { parent: "a", x: 1 }),
      c: leaf("c", { parent: "b", x: 1 }),
      d: leaf("d", { parent: "b", x: 2 }),
    });
    const plan = removeObjects(doc, ["a", "b"]);
    expect([...plan.orphans].sort()).toEqual(["c", "d"]);
    const next = apply(doc, plan);
    expect(next.objects.c).toMatchObject({ parent: null, transform: { position: [3, 0, 0] } });
    expect(next.objects.d).toMatchObject({ parent: null, transform: { position: [4, 0, 0] } });
  });

  it("an attachment filed elsewhere outlives its parent's group", () => {
    const doc = docWith({ g: group("G"), mast: leaf("mast", { group: "g", x: 1 }), flag: leaf("flag", { parent: "mast", x: 1 }) });
    const next = apply(doc, removeObjects(doc, "g"));
    expect(Object.keys(next.objects)).toEqual(["flag"]);
    expect(next.objects.flag).toMatchObject({ parent: null, transform: { position: [2, 0, 0] } });
  });

  it("repairs a merged cycle on the way", () => {
    const doc = docWith({ a: leaf("a", { parent: "b", x: 5 }), b: leaf("b", { parent: "a" }), z: leaf("z") });
    const next = apply(doc, removeObjects(doc, "z"));
    expect(next.objects.a.parent).toBeNull();
    expect(next.objects.a.transform.position).toEqual([5, 0, 0]);
  });
});

describe("ungroup", () => {
  // tool-v3.test.js: "… and ungroups without moving anything"
  it("moves the members up a level, without moving anything", () => {
    const doc = vessel();
    const was = origin(doc.objects, "hull");
    const plan = ungroup(doc, "body");
    expect({ ...plan }).toMatchObject({ id: "body", members: ["hull", "deck"], into: "vessel" });
    const next = apply(doc, plan);
    expect(next.objects.body).toBeUndefined();
    expect(next.order).not.toContain("body");
    expect(next.objects.hull.group).toBe("vessel");
    expect(next.objects.deck.group).toBe("vessel");
    expectClose(origin(next.objects, "hull"), was);
  });

  it("members keep looking as they did: a hidden group's stay hidden, a faded one's faded", () => {
    const doc = docWith({ g: group("G", null, { visible: false, opacity: 0.5 }), a: leaf("a", { group: "g", opacity: 0.5 }) });
    const next = apply(doc, ungroup(doc, "g"));
    expect(next.objects.a).toMatchObject({ group: null, visible: false, opacity: 0.25 });
  });
});

describe("newGroup and fileIn", () => {
  // tool-v3.test.js: "… filing in a group moves nothing; New group and Group wrap"
  it("files without moving, wraps in place, and makes a group inside a group", () => {
    let doc = vessel();
    const before = origin(doc.objects, "bhd");
    const filed = fileIn(doc, "bhd", "battery");
    expect({ ...filed }).toMatchObject({ ok: true, id: "bhd", group: "battery" });
    doc = apply(doc, filed);
    expect(doc.objects.bhd.group).toBe("battery");
    expectClose(origin(doc.objects, "bhd"), before);

    const wrap = newGroup(doc, { around: "bhd", id: "g1" });
    expect({ ...wrap }).toMatchObject({ ok: true, id: "g1", group: "battery", around: "bhd" });
    doc = apply(doc, wrap);
    expect(doc.objects.bhd.group).toBe("g1");
    expect(doc.objects.g1).toEqual({ kind: "group", name: "Group", group: "battery", visible: true, opacity: 1 });
    expect(doc.order.indexOf("g1")).toBe(doc.order.indexOf("bhd") - 1);
    expectClose(origin(doc.objects, "bhd"), before);

    doc = apply(doc, newGroup(doc, { into: "g1", id: "g2", name: "Inner" }));
    expect(doc.objects.g2).toMatchObject({ group: "g1", name: "Inner" });
    expect(doc.order.at(-1)).toBe("g2");
  });

  it("makes its own id when given none, and refuses one that's taken", () => {
    const doc = vessel();
    const plan = newGroup(doc);
    expect(plan.id).toMatch(/^g\w+/);
    expect(apply(doc, plan).objects[plan.id]).toMatchObject({ kind: "group", group: null });
    expect(newGroup(doc, { id: "hull" }).reason).toBe(REASONS.idTaken);
  });

  it("an into that isn't a group, or an around that isn't there, goes at the top", () => {
    const doc = vessel();
    expect(newGroup(doc, { into: "hull", id: "g1" }).group).toBeNull();
    const next = apply(doc, newGroup(doc, { around: "nope", id: "g1" }));
    expect(next.objects.g1.group).toBeNull();
    expect(next.order.at(-1)).toBe("g1");
  });

  it("refuses to put a group in itself or in anything inside it, or in a non-group", () => {
    const doc = vessel();
    expect(fileIn(doc, "vessel", "vessel").reason).toBe(REASONS.groupInItself);
    expect(fileIn(doc, "vessel", "body").reason).toBe(REASONS.groupInItself);
    expect(fileIn(doc, "deck", "hull").reason).toBe(REASONS.notAGroup);
    expect(fileIn(doc, "deck", "nope").reason).toBe(REASONS.notAGroup);
    expect(fileIn(doc, "body", "battery").ok).toBe(true);
  });

  it("null when it's already filed there; out of every group with null", () => {
    const doc = vessel();
    expect(fileIn(doc, "hull", "body")).toBeNull();
    expect(fileIn(doc, "battery", null)).toBeNull();
    expect(apply(doc, fileIn(doc, "hull", null)).objects.hull.group).toBeNull();
  });

  it("clears a merged loop of groups first", () => {
    const doc = docWith({ a: group("A", "b"), b: group("B", "a"), c: group("C"), x: leaf("x") });
    const next = apply(doc, fileIn(doc, "x", "c"));
    expect(next.objects.a.group).toBeNull(); // the loop's loser, cleared
    expect(next.objects.b.group).toBe("a");
  });
});

describe("moveRow", () => {
  // The outline's drops, as tool.test.js drives them: the place comes from
  // placementFor over the row under the pointer.
  const placeAt = (doc, row, intent) => placementFor(doc.objects, orderedIds(doc), row, intent, outlineParents(doc.objects));
  const move = (doc, id, row, intent) => moveRow(doc, id, placeAt(doc, row, intent));

  it("onto a group files it there and moves nothing; out of its parent's rows it's detached, where it is", () => {
    let doc = docWith({
      hull: leaf("hull", { transform: T([1, 0, 0], [0, 0, 0], 2) }),
      cleat: leaf("cleat", { parent: "hull", x: 1 }), // world x 1 + 2·1 = 3
      g1: group("G"),
    });
    const plan = move(doc, "hull", "g1", "into");
    expect({ ...plan }).toMatchObject({ ok: true, id: "hull", parent: "g1", group: "g1" });
    doc = apply(doc, plan);
    expect(doc.objects.hull).toMatchObject({ group: "g1", parent: null });
    expect(doc.objects.hull.transform.position[0]).toBe(1);
    // the cleat is still attached to the hull, but filed elsewhere: dropping it into the group detaches it
    doc = apply(doc, move(doc, "cleat", "g1", "into"));
    const c = doc.objects.cleat;
    expect(c).toMatchObject({ group: "g1", parent: null });
    expect(c.transform.position[0]).toBeCloseTo(3, 6);
    expect(c.transform.scale).toBeCloseTo(2, 6);
  });

  it("dropped on the line under an attached row, a row is attached to the same object, in its group", () => {
    const doc = docWith({ g1: group("G"), hull: leaf("hull", { group: "g1" }), cleat: leaf("cleat", { parent: "hull", group: "g1", x: 1 }), winch: leaf("winch", { x: 5 }) });
    const next = apply(doc, move(doc, "winch", "cleat", "after"));
    expect(next.objects.winch).toMatchObject({ parent: "hull", group: "g1" });
    expect(next.objects.winch.transform.position[0]).toBeCloseTo(5, 6); // hull is at the origin
  });

  it("a group can't go among an object's attachments", () => {
    const doc = docWith({ hull: leaf("hull"), cleat: leaf("cleat", { parent: "hull" }), g1: group("G") });
    const plan = move(doc, "g1", "cleat", "after");
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/only go inside another group/);
  });

  it("refuses to put a group inside its own child, and changes nothing", () => {
    const doc = docWith({ g1: group("G"), g2: group("G2", "g1") });
    const plan = move(doc, "g1", "g2", "into");
    expect(plan.reason).toMatch(/inside itself/);
    expect(apply(doc, plan)).toEqual(doc);
  });

  it("refuses an attachment loop", () => {
    const doc = docWith({ a: leaf("a"), b: leaf("b", { parent: "a" }), c: leaf("c", { parent: "b" }) });
    expect(moveRow(doc, "a", { parent: "c", before: null }).reason).toBe(REASONS.attachLoop);
  });

  it("a row released where it already sits, or onto itself, is nothing to write", () => {
    const doc = docWith({ r: leaf("r"), x: leaf("x"), s: leaf("s") });
    expect(move(doc, "x", "x", "before")).toBeNull(); // its own top half
    expect(move(doc, "x", "r", "after")).toBeNull(); // below r: the line between r and x
    expect(move(doc, "x", "s", "before")).toBeNull(); // above s: the same line
    const g = docWith({ g1: group("G") });
    expect(move(g, "g1", "g1", "into")).toBeNull(); // a group on its own middle: a click, not a cycle
  });

  it("a reorder among siblings leaves the transform alone", () => {
    const doc = docWith({ r: leaf("r", { x: 1 }), s: leaf("s", { transform: T([2, 0, 0], [0, 0, Math.PI]) }) });
    const plan = move(doc, "s", "r", "before");
    const draft = structuredClone(doc);
    const t = draft.objects.s.transform;
    plan(draft);
    expect(draft.order).toEqual(["s", "r"]);
    expect(draft.objects.s.transform).toBe(t); // not even rewritten
  });

  // Two peers attached a1 under b1 and b1 under a1 at once; resolveParents
  // breaks it at a1, so a1 is a root at x=5 and b1 is under it. Moving b1 to
  // the top level must not let a1's old edge come back and move a1.
  it("clears a merged cycle first, so nothing else jumps", () => {
    const doc = docWith({ a1: leaf("a1", { parent: "b1", x: 5 }), b1: leaf("b1", { parent: "a1", x: 3 }), c1: leaf("c1") });
    const next = apply(doc, move(doc, "b1", "c1", "before"));
    expect(next.objects.b1.parent ?? null).toBe(null);
    expect(next.objects.a1.parent ?? null).toBe(null);
    expect(next.objects.a1.transform.position).toEqual([5, 0, 0]);
  });
});

describe("plain writes", () => {
  it("setField writes one field; undefined deletes; structure is refused", () => {
    const doc = vessel();
    expect(apply(doc, setField(doc, "hull", "name", "Hull")).objects.hull.name).toBe("Hull");
    expect(setField(doc, "hull", "name", "HULL")).toBeNull(); // already so
    expect("opacity" in apply(doc, setField(doc, "hull", "opacity", undefined)).objects.hull).toBe(false);
    expect(setField(doc, "hull", "parent", "deck").reason).toBe(REASONS.structural);
    expect(setField(doc, "hull", "group", null).ok).toBe(false);
  });

  it("setTransform writes one or many, fresh and normalised, skipping groups and missing ids", () => {
    const doc = vessel();
    const one = setTransform(doc, "hull", { position: [1, 2, 3] });
    expect(apply(doc, one).objects.hull.transform).toEqual(T([1, 2, 3]));
    const many = setTransform(doc, new Map([["hull", T([1, 0, 0])], ["deck", T([2, 0, 0])], ["body", T()], ["nope", T()]]));
    expect(many.ids).toEqual(["hull", "deck"]);
    const next = apply(doc, many);
    expect(next.objects.deck.transform.position).toEqual([2, 0, 0]);
    expect(next.objects.body.transform).toBeUndefined();
    expect(setTransform(doc, { nope: T() })).toBeNull();
  });

  it("setTransformPart writes one number and nothing else", () => {
    const doc = vessel();
    expect(apply(doc, setTransformPart(doc, "hull", "position", 1, 4)).objects.hull.transform).toEqual(T([1, 4, 0]));
    expect(apply(doc, setTransformPart(doc, "hull", "scale", 0, -2)).objects.hull.transform.scale).toBe(1);
    const bare = docWith({ a: { name: "a" } });
    expect(apply(bare, setTransformPart(bare, "a", "rotation", 2, 1)).objects.a.transform).toEqual(T([0, 0, 0], [0, 0, 1]));
    expect(setTransformPart(doc, "hull", "position", 3, 1)).toBeNull();
    expect(setTransformPart(doc, "hull", "position", 0, NaN)).toBeNull();
    expect(setTransformPart(doc, "body", "scale", 0, 2)).toBeNull();
  });
});

describe("repairCycles", () => {
  it("clears only what it's told, and skips what's gone", () => {
    const d = { objects: { a: { parent: "b", group: "g" }, b: { parent: "a", group: "h" } } };
    repairCycles(d, ["a", "gone"], ["b"]);
    expect(d.objects).toEqual({ a: { parent: null, group: "g" }, b: { parent: "a", group: null } });
  });
});

// The plans run inside real automerge changes: no value from the snapshot
// may be written back into the doc, and nothing may be undefined.
describe("in an automerge change", () => {
  it("every structural plan applies cleanly", () => {
    let doc = Automerge.from(
      docWith({
        g1: group("G"),
        a: leaf("a", { transform: T([1, 0, 0], [0, 1, 0], 2) }),
        b: leaf("b", { parent: "a", x: 1 }),
        c: leaf("c", { group: "g1", x: 3 }),
      }),
    );
    const step = (plan) => {
      expect(plan?.ok).toBe(true);
      doc = Automerge.change(doc, plan);
    };
    step(attachTo(doc, "c", "a"));
    step(moveRow(doc, "b", { parent: "g1", before: null }));
    step(newGroup(doc, { around: "a", id: "g2" }));
    step(fileIn(doc, "g1", "g2"));
    step(setTransform(doc, "a", T([0, 1, 0])));
    step(setTransformPart(doc, "b", "position", 2, 9));
    step(setField(doc, "b", "name", "B"));
    step(removeObjects(doc, ["a"]));
    step(ungroup(doc, "g2"));
    const plain = Automerge.toJS(doc);
    expect(Object.keys(plain.objects).sort()).toEqual(["b", "c", "g1"]);
    expect(plain.objects.c.parent).toBeNull(); // orphaned when a went
    expect(plain.objects.g1.group).toBeNull(); // g2 ungrouped
    expect(plain.objects.b).toMatchObject({ name: "B", group: "g1" });
    expect(plain.objects.b.transform.position[2]).toBe(9);
    expect(plain.order).toEqual(["g1", "c", "b"]);
  });
});
