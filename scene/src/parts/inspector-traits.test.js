import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import inspector from "./inspector.js";
import { addableTraits, describedTraits, entriesOf, fieldWrite, formSpecs, newValue, shownValues, traitRows } from "./inspector-traits.js";
import { resolveParents } from "../hierarchy.js";
import { resolveGroups } from "../groups.js";

const INSPECTOR = { meta: { id: "scene.inspector" }, module: inspector };

// A stand-in for scene.sidebar: mounts every panel in a right edge and updates it each flush.
const SIDEBAR = {
  meta: { id: "t.sidebar" },
  module: {
    create(api) {
      const edge = api.edge("right");
      const mounted = new Map();
      return {
        update(scene, local) {
          for (const { value } of api.collect("panels")) {
            for (const p of value ?? []) {
              if (!mounted.has(p.id)) {
                const body = document.createElement("div");
                body.className = "panel-body";
                body.dataset.panel = p.id;
                edge.append(body);
                mounted.set(p.id, p.mount(body) ?? {});
              }
              mounted.get(p.id).update?.(scene, local);
            }
          }
        },
      };
    },
  },
};

const DECK = "automerge:2j9vHjM4kfgV7xYGVhQjNzr2Ucqh";

// A game that describes its traits, as arena and tabletop do. It counts its
// starts, so a test can see that offering a trait doesn't start it and adding
// one does.
let started = 0;
const GAME = {
  meta: {
    id: "t.game",
    traits: ["t.target", "t.zone", "t.hidden", "t.seats", "t.level"],
    // laid out while editing, and played: a scene with its traits offers play
    activities: ["edit", "play"],
    describes: {
      "t.target": { name: "Target", on: "object", blurb: "Can be shot", fields: [{ key: "points", label: "Points", kind: "integer", default: 10 }] },
      "t.zone": {
        name: "Private zone",
        on: "object",
        fields: [
          { key: "seat", label: "Seat", kind: "entry", of: "t.seats" },
          { key: "min", label: "Min", kind: "json" },
          { key: "near", label: "Near", kind: "object" },
        ],
        init: { min: [-1, 0, -1] },
      },
      "t.hidden": { name: "Hidden card", fields: [{ key: "by", label: "Deck", kind: "url" }] },
      "t.seats": { name: "Seats", on: "scene", entries: { label: "Seats", noun: "seat", prefix: "seat", fields: [{ key: "name", label: "Name", kind: "string", default: "Seat" }], init: { player: null } } },
      "t.level": { name: "Level", on: ["scene"], fields: [{ key: "look", label: "Look", kind: "enum", default: "", options: [{ value: "", label: "Its own" }, { value: "arena", label: "Arena" }] }] },
    },
  },
  module: {
    create() {
      started++;
      return {};
    },
  },
};

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  started = 0;
  vi.restoreAllMocks();
});

async function mount({ objects = {}, doc = {}, extensions = [GAME] } = {}) {
  s = await mountStage({
    extensions: [SIDEBAR, INSPECTOR, ...extensions],
    doc: { objects, order: Object.keys(objects), ...doc },
  });
  return s;
}

const body = () => s.root.querySelector('.panel-body[data-panel="inspector"]');
const $ = (sel) => body().querySelector(sel);
const behaviour = (key) => $(`.behaviour[data-trait="${key}"]`);
const picker = () => $(".behaviour-add");
const offered = () => [...picker().options].slice(1).map((o) => o.textContent);
/** A param-form row's control, by its label. */
const field = (root, label) => [...root.querySelectorAll(".param")].find((r) => r.querySelector(".param-label")?.textContent === label)?.querySelector("input, select");
const running = () => s.local.get().running.map((r) => r.id);
async function select(id) {
  s.local.swap((m) => ({ ...m, selected: id }));
  await settle();
}
async function fire(input, value) {
  if (input.type === "checkbox" || input.type === "radio") input.checked = value;
  else input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}
const pick = (name) => fire(picker(), [...picker().options].find((o) => o.textContent === name).value);

describe("scene.inspector: Behaviours on an object", () => {
  it("offers every described object trait without starting its extension; adding one starts it", async () => {
    await mount({ objects: { a: object({ name: "A" }) } });
    await select("a");
    expect(running()).not.toContain("t.game");
    expect(started).toBe(0);
    // object traits only (no on: means an object), by name; nothing listed yet
    expect(offered()).toEqual(["Hidden card", "Private zone", "Target"]);
    expect($(".behaviour-list").children.length).toBe(0);
    await pick("Target");
    // init plus the fields' defaults, written as one trait key
    expect(s.doc().objects.a.traits).toEqual({ "t.target": { points: 10 } });
    expect(running()).toContain("t.game");
    expect(started).toBe(1);
    expect(behaviour("t.target").querySelector(".behaviour-name").textContent).toBe("Target");
    expect(offered()).toEqual(["Hidden card", "Private zone"]);
    expect(picker().value).toBe("");
  });

  it("edits a field in place, leaving the trait's other keys (a game's own state) alone", async () => {
    await mount({ objects: { a: object({ traits: { "t.target": { points: 10, down: { by: "v1" } }, "x.other": { keep: 1 } } }) } });
    await select("a");
    const points = field(behaviour("t.target"), "Points");
    expect(points.value).toBe("10");
    await fire(points, "25");
    expect(s.doc().objects.a.traits).toEqual({ "t.target": { points: 25, down: { by: "v1" } }, "x.other": { keep: 1 } });
    // a peer's change shows
    s.change((d) => (d.objects.a.traits["t.target"].points = 3));
    await settle();
    expect(field(behaviour("t.target"), "Points").value).toBe("3");
  });

  it("lists a trait nothing describes by its key, and × removes only that trait", async () => {
    await mount({ objects: { a: object({ traits: { "t.target": { points: 1 }, "x.other": { keep: 1 } } }) } });
    await select("a");
    expect(behaviour("x.other").querySelector(".behaviour-name").textContent).toBe("x.other");
    expect(behaviour("x.other").querySelector(".param")).toBeNull();
    behaviour("t.target").querySelector(".behaviour-remove").click();
    await settle();
    expect(s.doc().objects.a.traits).toEqual({ "x.other": { keep: 1 } });
    expect(behaviour("t.target")).toBeNull();
    expect(offered()).toContain("Target");
  });

  it("an object field picks another object (never itself), and None removes it", async () => {
    await mount({ objects: { a: object({ name: "A", traits: { "t.zone": {} } }), b: object({ name: "Bench" }) } });
    await select("a");
    const near = field(behaviour("t.zone"), "Near");
    expect([...near.options].map((o) => o.textContent)).toEqual(["None", "Bench"]);
    await fire(near, "b");
    expect(s.doc().objects.a.traits["t.zone"].near).toBe("b");
    await fire(field(behaviour("t.zone"), "Near"), "");
    expect("near" in s.doc().objects.a.traits["t.zone"]).toBe(false);
  });

  it("an entry field offers the scene trait's entries by name, and follows them", async () => {
    await mount({ objects: { a: object({ traits: { "t.zone": { seat: "n" } } }) }, doc: { traits: { "t.seats": { n: { name: "North", player: null }, s: { name: "South", player: null } } } } });
    await select("a");
    const seat = field(behaviour("t.zone"), "Seat");
    expect([...seat.options].map((o) => o.textContent)).toEqual(["None", "North", "South"]);
    expect(seat.value).toBe("n");
    await fire(seat, "s");
    expect(s.doc().objects.a.traits["t.zone"].seat).toBe("s");
    // the seat is renamed: the option follows
    s.change((d) => (d.traits["t.seats"].s.name = "Dealer"));
    await settle();
    expect([...field(behaviour("t.zone"), "Seat").options].map((o) => o.textContent)).toEqual(["None", "North", "Dealer"]);
    // the seat goes: the zone shows None (its id is left for whoever tidies)
    s.change((d) => delete d.traits["t.seats"].s);
    await settle();
    expect(field(behaviour("t.zone"), "Seat").value).toBe("");
    expect(s.doc().objects.a.traits["t.zone"].seat).toBe("s");
  });

  it("json and url fields refuse what they can't parse, with a notice, and write nothing", async () => {
    await mount({ objects: { a: object({ traits: { "t.zone": { min: [0, 0, 0] }, "t.hidden": {} } }) } });
    await select("a");
    const min = field(behaviour("t.zone"), "Min");
    expect(min.value).toBe("[0,0,0]");
    await fire(min, "[1, 2");
    expect(s.doc().objects.a.traits["t.zone"].min).toEqual([0, 0, 0]);
    expect(s.local.get().notices.at(-1).text).toMatch(/Min isn't valid JSON/);
    await fire(field(behaviour("t.zone"), "Min"), "[-0.2, 0, -0.1]");
    expect(s.doc().objects.a.traits["t.zone"].min).toEqual([-0.2, 0, -0.1]);

    const by = field(behaviour("t.hidden"), "Deck");
    await fire(by, "a deck");
    expect(s.doc().objects.a.traits["t.hidden"]).toEqual({});
    expect(s.local.get().notices.at(-1).text).toMatch(/Deck needs a document link/);
    await fire(field(behaviour("t.hidden"), "Deck"), DECK);
    expect(s.doc().objects.a.traits["t.hidden"].by).toBe(DECK);
    await fire(field(behaviour("t.hidden"), "Deck"), "");
    expect(s.doc().objects.a.traits["t.hidden"]).toEqual({});
  });

  it("a first trait makes the object's traits map; a second is added beside the first", async () => {
    await mount({ objects: { a: object() } });
    await select("a");
    expect(s.doc().objects.a.traits).toBeUndefined();
    await pick("Private zone");
    await pick("Hidden card");
    expect(s.doc().objects.a.traits).toEqual({ "t.zone": { min: [-1, 0, -1] }, "t.hidden": {} });
  });

  it("shows no Behaviours section when nothing is described and the object has none", async () => {
    await mount({ objects: { a: object() }, extensions: [] });
    await select("a");
    expect($(".behaviours").hidden).toBe(true);
  });
});

describe("scene.inspector: the Scene, with nothing selected", () => {
  it("offers scene traits, and edits a map trait's entries (seats) one by one", async () => {
    await mount({ objects: { a: object() } });
    expect($(".inspector").dataset.kind).toBe("scene");
    expect(offered()).toEqual(["Level", "Seats"]);
    await pick("Seats");
    expect(s.doc().traits["t.seats"]).toEqual({});
    expect(running()).toContain("t.game");
    const add = behaviour("t.seats").querySelector(".entry-add");
    expect(add.textContent).toBe("Add seat");
    add.click();
    await settle();
    behaviour("t.seats").querySelector(".entry-add").click();
    await settle();
    const ids = Object.keys(s.doc().traits["t.seats"]);
    expect(ids.length).toBe(2);
    expect(ids.every((id) => id.startsWith("seat"))).toBe(true);
    expect(Object.values(s.doc().traits["t.seats"])).toEqual([
      { player: null, name: "Seat" },
      { player: null, name: "Seat" },
    ]);
    const rows = [...behaviour("t.seats").querySelectorAll(".behaviour-entry")];
    expect(rows.map((r) => r.dataset.entry)).toEqual(ids);
    await fire(field(rows[1], "Name"), "South");
    expect(s.doc().traits["t.seats"][ids[1]]).toEqual({ player: null, name: "South" });
    behaviour("t.seats").querySelector(`.behaviour-entry[data-entry="${ids[0]}"] .entry-remove`).click();
    await settle();
    expect(Object.keys(s.doc().traits["t.seats"])).toEqual([ids[1]]);
    // a scene trait with an enum field
    await pick("Level");
    expect(s.doc().traits["t.level"]).toEqual({ look: "" });
    await fire(field(behaviour("t.level"), "Look"), "arena");
    expect(s.doc().traits["t.level"].look).toBe("arena");
    // the scene's traits map was edited in place: both are there
    expect(Object.keys(s.doc().traits).sort()).toEqual(["t.level", "t.seats"]);
  });

  it("Starts in: the activities the scene offers, written to doc.view.activity, with a note about each viewer's own", async () => {
    await mount({ objects: {} });
    const radio = (a) => $(`.starts-in input[data-activity="${a}"]`);
    const labels = () => [...$(".starts-in").querySelectorAll("label")].map((l) => l.textContent.trim());
    // a plain scene offers only editing
    expect(labels()).toEqual(["Edit"]);
    expect(radio("edit").checked).toBe(true);
    expect($(".starts-in-note").textContent).toMatch(/Editing is all this scene offers/);
    // the game's trait makes play a choice
    s.change((d) => {
      d.traits["t.level"] = {};
    });
    await settle();
    expect(labels()).toEqual(["Edit", "Play"]);
    expect(radio("edit").checked).toBe(true);
    expect($(".starts-in-note").textContent).toMatch(/Each viewer can switch for themselves/);
    await fire(radio("play"), true);
    expect(s.doc().view.activity).toBe("play");
    expect(radio("play").checked).toBe(true);
    // it's where people start: this viewer, already here, stays editing
    expect(s.local.get().activity).toBe("edit");
    expect(running()).toContain("scene.inspector");
    await fire(radio("edit"), true);
    expect("activity" in s.doc().view).toBe(false);
    // a peer's change shows
    s.change((d) => {
      d.view.activity = "play";
    });
    await settle();
    expect(radio("play").checked).toBe(true);
  });
});

describe("scene.inspector: describing traits, the pure side", () => {
  const snap = (objects, traits = {}) => ({ objects, ids: Object.keys(objects), parents: resolveParents(objects), groups: resolveGroups(objects), traits });

  it("describedTraits: the first to describe a key wins; on defaults to objects; bad fields go, unknown kinds become json", () => {
    const d = describedTraits([
      { id: "a", describes: { "k.one": { name: "One", fields: [{ key: "x", kind: "integer" }, { kind: "string" }, { key: "y", kind: "vec9" }, { key: "z" }] }, "k.two": { on: ["scene", "object", "moon"] } } },
      { id: "b", describes: { "k.one": { name: "Other" }, "k.three": { name: "Three", on: "scene", entries: { fields: [{ key: "name" }], prefix: "no digits 1" } } } },
      { id: "c" },
      { id: "d", describes: "nope" },
    ]);
    expect([...d.keys()]).toEqual(["k.one", "k.two", "k.three"]);
    const one = d.get("k.one");
    expect(one).toMatchObject({ ext: "a", name: "One", on: ["object"], entries: null });
    expect(one.fields.map((f) => [f.key, f.kind, f.label])).toEqual([
      ["x", "integer", "x"],
      ["y", "json", "y"],
      ["z", "string", "z"],
    ]);
    expect(d.get("k.two")).toMatchObject({ name: "k.two", on: ["scene", "object"] });
    expect(d.get("k.three").entries).toMatchObject({ label: "Entries", noun: "entry", prefix: "e", init: {} });
  });

  it("traitRows, addableTraits and newValue", () => {
    const d = describedTraits([{ id: "a", describes: { "k.b": { name: "B" }, "k.a": { name: "A", init: { list: [1] }, fields: [{ key: "n", kind: "number", default: 2 }, { key: "list", kind: "json", default: [] }] }, "k.s": { name: "S", on: "scene" } } }]);
    expect(traitRows({ "k.b": {}, "x.y": 1 }, d).map((r) => [r.key, r.desc?.name ?? null, r.value])).toEqual([
      ["k.b", "B", {}],
      ["x.y", null, 1],
    ]);
    expect(traitRows(null, d)).toEqual([]);
    expect(addableTraits(d, "object", { "k.b": {} }).map((x) => x.key)).toEqual(["k.a"]);
    expect(addableTraits(d, "scene", undefined).map((x) => x.key)).toEqual(["k.s"]);
    const v = newValue(d.get("k.a"));
    expect(v).toEqual({ list: [1], n: 2 });
    v.list.push(2);
    expect(d.get("k.a").init.list).toEqual([1]); // a copy, every time
    expect(entriesOf({ a: { name: "A" }, b: 3, c: null })).toEqual([["a", { name: "A" }]]);
  });

  it("formSpecs, shownValues and fieldWrite", () => {
    const fields = [
      { key: "o", label: "O", kind: "object" },
      { key: "e", label: "E", kind: "entry", of: "k.seats" },
      { key: "j", label: "J", kind: "json" },
      { key: "u", label: "U", kind: "url" },
      { key: "n", label: "N", kind: "number", min: 0, max: 5, default: 1 },
    ];
    const sc = snap({ a: object({ name: "A" }), b: object({ name: "B" }) }, { "k.seats": { n: { name: "North" }, x: { player: null } } });
    const specs = formSpecs(fields, { scene: sc, self: "a" });
    expect(specs.map((s) => s.kind)).toEqual(["enum", "enum", "string", "string", "number"]);
    expect(specs[0].options).toEqual([
      { value: "", label: "None" },
      { value: "b", label: "B" },
    ]);
    expect(specs[1].options.map((o) => o.label)).toEqual(["None", "North", "x"]);
    expect(specs[4]).toMatchObject({ min: 0, max: 5, default: 1 });
    expect(shownValues(fields, specs, { o: "gone", e: "n", j: { a: [1] } })).toEqual({ o: "", e: "n", j: '{"a":[1]}', u: "", n: 1 });
    expect(fieldWrite(fields[0], "")).toEqual({ remove: true });
    expect(fieldWrite(fields[0], "b")).toEqual({ value: "b" });
    expect(fieldWrite(fields[2], " [1,2] ")).toEqual({ value: [1, 2] });
    expect(fieldWrite(fields[2], "{")).toHaveProperty("error");
    expect(fieldWrite(fields[3], DECK)).toEqual({ value: DECK });
    expect(fieldWrite(fields[3], "https://x")).toHaveProperty("error");
    expect(fieldWrite(fields[4], 3)).toEqual({ value: 3 });
    expect(fieldWrite(fields[4], null)).toHaveProperty("error");
  });
});
