import { describe, it, expect } from "vitest";
import { brokenGroups, childrenMap, defaultExpanded, descendantsOf, groupChain, groupTargets, groupsWithHidden, inheritedDisplay, outlineParents, removalSet, resolveGroups, searchOutline, ungroupPlan, visibleRows } from "./groups.js";
import { resolveParents, treeOrder } from "./hierarchy.js";

const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const group = (name, inGroup = null, extra = {}) => ({ kind: "group", name, group: inGroup, visible: true, opacity: 1, ...extra });
const obj = (name, inGroup = null, extra = {}) => ({ name, group: inGroup, parent: null, visible: true, opacity: 1, transform: T(), ...extra });

// vessel ─┬─ body ─┬─ hull
//         │        └─ deck (hidden)
//         └─ rig   ── mast ── flag (attached to mast, in RIG too)
// battery (hidden) ── cell
function scene() {
  return {
    vessel: group("Solander 38"),
    body: group("BODY", "vessel", { opacity: 0.5 }),
    hull: obj("HULL", "body"),
    deck: obj("DECK", "body", { visible: false }),
    rig: group("RIG", "vessel"),
    mast: obj("mast", "rig", { visible: false }),
    flag: obj("flag", "rig", { parent: "mast", opacity: 0.5 }),
    battery: group("Battery (display)", null, { visible: false }),
    cell: obj("CELL", "battery"),
  };
}

describe("groups and attachment are separate", () => {
  it("a group is never a parent; an object's group is any group", () => {
    const o = { ...scene(), stray: obj("stray", "hull", { parent: "body" }) };
    expect(resolveParents(o).get("stray")).toBeNull(); // body is a group: not a parent
    expect(resolveGroups(o).get("stray")).toBeNull(); // hull is an object: not a group
    expect(resolveGroups(o).get("hull")).toBe("body");
    expect(groupChain(resolveGroups(o), "hull")).toEqual(["body", "vessel"]);
  });

  it("the outline: groups hold what's in them; an attachment sits under its parent when they share a group, else in its own", () => {
    const o = { ...scene(), streamer: obj("streamer", "body", { parent: "mast" }) };
    const out = outlineParents(o);
    expect(out.get("flag")).toBe("mast"); // both in RIG
    expect(out.get("streamer")).toBe("body"); // attached to the mast, filed in BODY
    expect(out.get("mast")).toBe("rig");
    expect(out.get("body")).toBe("vessel");
    expect(out.get("vessel")).toBeNull();
  });

  it("a loop of groups (two concurrent edits) breaks the same way for everyone, and is reported for repair", () => {
    const o = { a: group("A", "b"), b: group("B", "a"), x: obj("x", "a") };
    const groups = resolveGroups(o);
    expect(groups.get("a")).toBeNull(); // the smallest id in the loop is the root
    expect(groups.get("b")).toBe("a");
    expect(brokenGroups(o, groups)).toEqual(["a"]);
  });

  it("a group can go in any group but itself and those in it", () => {
    expect(groupTargets(scene(), "vessel").sort()).toEqual(["battery"]);
    expect(groupTargets(scene(), "body").sort()).toEqual(["battery", "rig", "vessel"]);
  });
});

describe("groups", () => {
  it("cascades visibility and opacity through group ancestors only", () => {
    const o = scene();
    const inh = inheritedDisplay(o);
    expect(inh.get("hull")).toEqual({ visible: true, opacity: 0.5 });
    expect(inh.get("cell").visible).toBe(false);
    // flag is attached to the mast: the hidden mast doesn't hide it, but RIG's state still reaches it
    expect(inh.get("flag")).toEqual({ visible: true, opacity: 1 });
    expect(inh.get("vessel")).toEqual({ visible: true, opacity: 1 });
    o.vessel.visible = false;
    expect(inheritedDisplay(o).get("flag").visible).toBe(false);
  });

  it("knows which groups have something hidden below them (indeterminate checkboxes)", () => {
    const mixed = groupsWithHidden(scene());
    expect([...mixed].sort()).toEqual(["body", "rig", "vessel"]);
  });

  it("removes a group with everything below it, an object alone", () => {
    const o = scene();
    expect(removalSet(o, "vessel").sort()).toEqual(["body", "deck", "flag", "hull", "mast", "rig", "vessel"]);
    expect(removalSet(o, "mast")).toEqual(["mast"]);
    expect(removalSet(o, "nope")).toEqual([]);
    expect(descendantsOf(childrenMap(outlineParents(o)), "rig").sort()).toEqual(["flag", "mast"]);
  });

  it("ungroups into the group's own group; nothing moves", () => {
    const plan = ungroupPlan(scene(), "body");
    expect(plan.group).toBe("vessel");
    expect(plan.members.sort()).toEqual(["deck", "hull"]);
    expect(plan.transforms).toBeUndefined();
    expect(ungroupPlan(scene(), "vessel").members.sort()).toEqual(["body", "rig"]);
  });

  it("ungrouping keeps how the children look: a hidden group's stay hidden, a translucent one's stay translucent", () => {
    const o = scene();
    // body is at 0.5 opacity: hull (1) and deck (hidden, 1) take it on
    expect(ungroupPlan(o, "body").display).toEqual({ hull: { opacity: 0.5 }, deck: { opacity: 0.5 } });
    // battery is hidden: cell becomes hidden itself
    expect(ungroupPlan(o, "battery").display).toEqual({ cell: { visible: false } });
    // a visible, opaque group changes nothing
    expect(ungroupPlan(o, "rig").display).toEqual({});
    // effective display is the same after as before
    const plan = ungroupPlan(o, "body");
    const after = { ...o };
    for (const c of plan.members) after[c] = { ...o[c], group: plan.group, ...plan.display[c] };
    delete after.body;
    const before = inheritedDisplay(o);
    const now = inheritedDisplay(after);
    for (const c of ["hull", "deck"]) {
      expect(after[c].visible !== false && now.get(c).visible).toBe(o[c].visible !== false && before.get(c).visible);
      expect(after[c].opacity * now.get(c).opacity).toBeCloseTo(o[c].opacity * before.get(c).opacity, 12);
    }
  });

  it("searches name and group path, AND of terms, case-insensitive, with ancestors for context", () => {
    const o = scene();
    const s = searchOutline(o, "body HULL");
    expect([...s.matches]).toEqual(["hull"]);
    expect([...s.shown].sort()).toEqual(["body", "hull", "vessel"]);
    expect(s.first).toBe("hull");
    expect(searchOutline(o, "solander").matches.size).toBe(9 - 2); // everything under the vessel, and the vessel
    expect(searchOutline(o, "  ").matches.size).toBe(0);
    expect(searchOutline(o, "zzz").matches.size).toBe(0);
  });

  it("shows roots open, deeper groups closed, and skips collapsed subtrees", () => {
    const o = scene();
    const parents = outlineParents(o);
    const ids = Object.keys(o);
    const tree = treeOrder(o, ids, parents);
    const kids = childrenMap(parents, ids);
    const has = (id) => (kids.get(id)?.length ?? 0) > 0;
    expect(defaultExpanded(o, "vessel", 0)).toBe(true);
    expect(defaultExpanded(o, "battery", 0)).toBe(false); // a hidden root stays closed
    expect(defaultExpanded(o, "body", 1)).toBe(false);
    expect(defaultExpanded(o, "mast", 2)).toBe(true); // an object's attachments show
    const rows = visibleRows(tree, { isExpanded: (id, depth) => defaultExpanded(o, id, depth), hasChildren: has });
    expect(rows.map((r) => r.id)).toEqual(["vessel", "body", "rig", "battery"]);
    const open = visibleRows(tree, { isExpanded: () => true, hasChildren: has });
    expect(open.map((r) => [r.id, r.depth])).toEqual([
      ["vessel", 0], ["body", 1], ["hull", 2], ["deck", 2], ["rig", 1], ["mast", 2], ["flag", 3], ["battery", 0], ["cell", 1],
    ]);
    // filtering shows matches and their ancestors, open, whatever is collapsed
    const s = searchOutline(o, "flag", parents, ids);
    const filtered = visibleRows(tree, { isExpanded: () => false, hasChildren: has, shown: s.shown });
    expect(filtered.map((r) => r.id)).toEqual(["vessel", "rig", "mast", "flag"]);
  });

  it("handles a 500-object tree quickly", () => {
    const o = {};
    for (let g = 0; g < 129; g++) o[`g${g}`] = group(`G${g}`, g ? `g${Math.floor((g - 1) / 3)}` : null);
    for (let i = 0; i < 378; i++) o[`o${i}`] = obj(`layer ${i}`, `g${i % 129}`, { visible: i % 5 !== 0 });
    const t0 = performance.now();
    const parents = outlineParents(o);
    const ids = Object.keys(o);
    const tree = treeOrder(o, ids, parents);
    inheritedDisplay(o, parents);
    groupsWithHidden(o, parents);
    searchOutline(o, "layer 1", parents, ids);
    const ms = performance.now() - t0;
    expect(tree.length).toBe(507);
    expect(ms).toBeLessThan(50);
  });
});
