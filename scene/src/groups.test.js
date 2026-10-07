import { describe, it, expect } from "vitest";
import { childrenMap, defaultExpanded, descendantsOf, groupsWithHidden, inheritedDisplay, removalSet, searchOutline, ungroupPlan, visibleRows } from "./groups.js";
import { resolveParents, treeOrder, worldMatrix } from "./hierarchy.js";
import { applyMatrix } from "./transform.js";

const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const group = (name, parent = null, extra = {}) => ({ kind: "group", name, parent, visible: true, opacity: 1, transform: T(), ...extra });
const obj = (name, parent = null, extra = {}) => ({ name, parent, visible: true, opacity: 1, transform: T(), ...extra });

// vessel ─┬─ body ─┬─ hull
//         │        └─ deck (hidden)
//         └─ rig   ── mast ── flag (attached to mast, not a group)
// battery (hidden) ── cell
function scene() {
  return {
    vessel: group("Solander 38", null, { transform: T([0, -0.7, 0]) }),
    body: group("BODY", "vessel", { opacity: 0.5 }),
    hull: obj("HULL", "body"),
    deck: obj("DECK", "body", { visible: false }),
    rig: group("RIG", "vessel"),
    mast: obj("mast", "rig", { visible: false }),
    flag: obj("flag", "mast", { opacity: 0.5 }),
    battery: group("Battery (display)", null, { visible: false }),
    cell: obj("CELL", "battery"),
  };
}

describe("groups", () => {
  it("cascades visibility and opacity through group ancestors only", () => {
    const o = scene();
    const inh = inheritedDisplay(o);
    expect(inh.get("hull")).toEqual({ visible: true, opacity: 0.5 });
    expect(inh.get("cell").visible).toBe(false);
    // flag hangs off an object: the hidden mast doesn't hide it (v2 §5), but RIG's state still reaches it
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
    expect(descendantsOf(childrenMap(resolveParents(o)), "rig").sort()).toEqual(["flag", "mast"]);
  });

  it("ungroups to the group's parent, keeping world poses", () => {
    const o = scene();
    o.body.transform = T([1, 2, 3], [0, Math.PI / 2, 0], 2);
    o.hull.transform = T([1, 0, 0]);
    const before = applyMatrix(worldMatrix(o, "hull"), [0, 0, 0]);
    const plan = ungroupPlan(o, "body");
    expect(plan.parent).toBe("vessel");
    expect(Object.keys(plan.children).sort()).toEqual(["deck", "hull"]);
    const after = { ...o, hull: { ...o.hull, parent: "vessel", transform: plan.children.hull } };
    delete after.body;
    applyMatrix(worldMatrix(after, "hull"), [0, 0, 0]).forEach((v, i) => expect(v).toBeCloseTo(before[i], 9));
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
    for (const [c, t] of Object.entries(plan.children)) after[c] = { ...o[c], parent: plan.parent, transform: t, ...plan.display[c] };
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
    const parents = resolveParents(o);
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
    const parents = resolveParents(o);
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
