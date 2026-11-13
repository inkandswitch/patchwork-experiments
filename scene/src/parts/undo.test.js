// scene.undo, mounted: ⌘Z / Ctrl+Z and the toolbar's Undo and Redo take back
// the stage's own edits (here Delete, scene.select's), this viewer's; a
// package's verb (a roll) is never on it, and an edit since changed by one is
// left as the verb left it.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { fakeUrl } from "../test/fake-repo.js";
import undo, { undoKey } from "./undo.js";
import select from "./select.js";

const DICE = {
  meta: { id: "t.dice" },
  module: {
    create: (api) => ({
      commands: [
        {
          id: "roll",
          name: "Roll",
          state: (t, { scene }) => (scene?.objects?.[t] ? {} : null),
          run: (t) =>
            api.change((d) => {
              d.objects[t].transform.position = [4, 0, 4];
            }),
        },
      ],
    }),
  },
};

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

const press = (key, extra = {}) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, code: `Key${key.toUpperCase()}`, ...extra });
  s.root.dispatchEvent(e);
  return e;
};

describe("scene.undo", () => {
  it("undoKey: ⌘Z / Ctrl+Z undo, with Shift redo, Ctrl+Y redo; nothing else", () => {
    expect(undoKey({ key: "z", metaKey: true })).toBe("undo");
    expect(undoKey({ key: "Z", ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(undoKey({ key: "y", ctrlKey: true })).toBe("redo");
    expect(undoKey({ key: "y", metaKey: true })).toBeNull();
    expect(undoKey({ key: "z" })).toBeNull();
    expect(undoKey({ key: "z", metaKey: true, altKey: true })).toBeNull();
  });

  it("Delete is an edit: ⌘Z puts it back, ⇧⌘Z takes it out again; a roll is no step, and a rolled die isn't deleted again by redo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    s = await mountStage({
      extensions: [
        { meta: { id: "scene.select" }, module: select },
        { meta: { id: "scene.undo" }, module: undo },
        DICE,
      ],
      doc: { objects: { die: object({ name: "Die" }) }, order: ["die"] },
    });
    await settle();
    const run = (ext, command, target = null) => s.api("scene.undo").run({ ext, command, target });
    const state = (id) => s.instance("scene.undo").commands.find((c) => c.id === id).state(null);
    expect(state("undo")).toMatchObject({ disabled: true });
    run("scene.select", "remove", "die");
    expect(s.doc().objects.die).toBeUndefined();
    expect(state("undo")).toEqual({ title: "Undo “Delete”" });
    expect(press("z", { metaKey: true }).defaultPrevented).toBe(true);
    expect(s.doc().objects.die.name).toBe("Die");
    expect(s.doc().order).toEqual(["die"]);
    expect(state("redo")).toEqual({ title: "Redo “Delete”" });
    // the die is rolled: no step of its own, and redo can't delete what the roll has moved since
    run("t.dice", "roll", "die");
    expect(s.local.get().edits).toEqual({ undo: null, redo: "Delete" });
    press("z", { metaKey: true, shiftKey: true });
    expect(s.doc().objects.die.transform.position).toEqual([4, 0, 4]);
    expect(s.local.get().notices.at(-1).text).toBe("Nothing to redo: “Delete” has been changed since.");
    expect(s.local.get().edits).toEqual({ undo: null, redo: null });
  });

  it("a field being typed in keeps ⌘Z (its own text undo)", async () => {
    s = await mountStage({ extensions: [{ meta: { id: "scene.undo" }, module: undo }], doc: { objects: { a: object() }, order: ["a"] } });
    await settle();
    s.api("scene.undo").edit((d) => (d.objects.a.name = "B"), { label: "Rename" });
    const input = document.createElement("input");
    s.root.append(input);
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", metaKey: true });
    input.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(s.doc().objects.a.name).toBe("B");
    press("z", { ctrlKey: true });
    expect(s.doc().objects.a.name).toBe("Object");
  });
});

// Decisions 2's other rules: a step that showed or decided something is taken
// back only with its parties' agreement (refused, until that protocol
// exists); a step that removed something a keeper holds says what it can't
// put back. And only the stage's own parts can edit at all.
describe("undo's agreement and keeper rules, and who may edit", () => {
  // A card with one physical state of four: in ann's hand, in bob's hand,
  // face up on the table, face down on it. Who may see what it is: the
  // hand's player; everyone; nobody. The fixture table's parties are the
  // seated, from the scene's `t.seated` trait.
  const STATES = ["hand:ann", "hand:bob", "up", "down"];
  const audienceOfState = (st) => (st === "up" ? "all" : st.startsWith("hand:") ? [st.slice(5)] : []);
  const TABLE = {
    meta: { id: "t.table", traits: ["t.card"] },
    module: {
      create: (api) => ({
        audience: (snap) => (id) => {
          const st = snap.objects[id]?.traits?.["t.card"]?.state;
          if (!st) return null;
          if (st === "up") return { show: "all" };
          if (st.startsWith("hand:")) return { show: [st.slice(5)], only: [st.slice(5)] };
          return null;
        },
        parties: (snap) => {
          const seated = [...(snap.traits?.["t.seated"]?.who ?? [])];
          return () => seated;
        },
        // a package's write (not an edit): how the tests set a state up
        set: (st) => api.change((d) => (d.objects.card.traits["t.card"].state = st)),
        seat: (who) => api.change((d) => (d.traits["t.seated"] = { who })),
      }),
    },
  };
  const cardDoc = (seated) => ({
    traits: { "t.card": {}, "t.seated": { who: seated } },
    objects: { card: object({ name: "Card", traits: { "t.card": { state: "down" } } }) },
    order: ["card"],
  });
  const grew = (a, b) => (b === "all" ? a !== "all" : a !== "all" && b.some((v) => !a.includes(v)));

  it("over every move of a card between four states × who is seated (nobody, ann, ann and bob): ann's undo is refused exactly when the move widened who may see it and someone else is seated", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let cases = 0;
    for (const seated of [[], ["ann"], ["ann", "bob"]]) {
      s = await mountStage({ viewerId: "ann", extensions: [{ meta: { id: "scene.undo" }, module: undo }, TABLE], doc: cardDoc(seated) });
      await settle();
      const table = s.instance("t.table");
      const edit = s.api("scene.undo");
      for (const from of STATES) {
        for (const to of STATES) {
          if (from === to) continue;
          cases++;
          table.set(from);
          edit.edit((d) => (d.objects.card.traits["t.card"].state = to), { label: "Move" });
          const refused = grew(audienceOfState(from), audienceOfState(to)) && seated.some((v) => v !== "ann");
          const where = `${seated.join("+") || "nobody"} ${from} → ${to}`;
          const took = edit.undo();
          expect(took, where).toBe(!refused);
          expect(s.doc().objects.card.traits["t.card"].state, where).toBe(refused ? to : from);
          if (refused) {
            expect(s.local.get().notices.at(-1).text, where).toBe("Can't undo “Move”: it showed or decided something, and taking it back needs the others' agreement.");
            // it stays: the top of the stack, still refused
            expect(s.local.get().edits.undo, where).toBe("Move");
          }
        }
      }
      s.unmount();
      s = null;
    }
    expect(cases).toBe(36);
  });

  it("a refused step stays, and is free once the others have stood up (parties are current); redo is judged the same way", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    s = await mountStage({ viewerId: "ann", extensions: [{ meta: { id: "scene.undo" }, module: undo }, TABLE], doc: cardDoc(["ann", "bob"]) });
    await settle();
    const table = s.instance("t.table");
    const edit = s.api("scene.undo");
    table.set("hand:ann");
    // a card from ann's hand, face up onto the table: shown to bob
    edit.edit((d) => (d.objects.card.traits["t.card"].state = "up"), { label: "Play" });
    expect(edit.undo()).toBe(false);
    table.seat(["ann"]);
    expect(edit.undo()).toBe(true);
    expect(s.doc().objects.card.traits["t.card"].state).toBe("hand:ann");
    // the undo hid it again, and widened nothing: but its redo (which shows it) is judged by what the undo did, so free
    table.seat(["ann", "bob"]);
    expect(edit.redo()).toBe(true);
    expect(s.doc().objects.card.traits["t.card"].state).toBe("up");
  });

  it("a CAD scene, two people, nothing answering who has a stake: every undo is free, even of a flip", async () => {
    const CAD = { meta: { id: "t.cad", traits: ["t.card"] }, module: { create: () => ({ audience: TABLE.module.create({ change() {} }).audience }) } };
    s = await mountStage({ viewerId: "ann", extensions: [{ meta: { id: "scene.undo" }, module: undo }, CAD], doc: cardDoc(["ann", "bob"]) });
    await settle();
    const edit = s.api("scene.undo");
    edit.edit((d) => (d.objects.card.traits["t.card"].state = "up"), { label: "Flip" });
    expect(edit.undo()).toBe(true);
    expect(s.doc().objects.card.traits["t.card"].state).toBe("down");
  });

  it("parties' answers, every kind × a reveal: [] and null are no stake (free); a viewer is a stake, and a throw can't be told (both refused)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = () => {
      throw new Error("broken");
    };
    // what parties(snap) is: a function answering each kind, or itself throwing
    const KINDS = { none: () => () => [], nobody: () => () => null, bob: () => () => ["bob"], throwsPerId: () => boom, throwsWhole: boom };
    const refusedFor = { none: false, nobody: false, bob: true, throwsPerId: true, throwsWhole: true };
    let cases = 0;
    for (const [kind, parties] of Object.entries(KINDS)) {
      const ASKED = { meta: { id: "t.asked", traits: ["t.card"] }, module: { create: () => ({ audience: TABLE.module.create({ change() {} }).audience, parties }) } };
      s = await mountStage({ viewerId: "ann", extensions: [{ meta: { id: "scene.undo" }, module: undo }, ASKED], doc: cardDoc([]) });
      await settle();
      const edit = s.api("scene.undo");
      edit.edit((d) => (d.objects.card.traits["t.card"].state = "up"), { label: "Flip" });
      expect(edit.undo(), kind).toBe(!refusedFor[kind]);
      expect(s.doc().objects.card.traits["t.card"].state, kind).toBe(refusedFor[kind] ? "up" : "down");
      cases++;
      s.unmount();
      s = null;
    }
    expect(cases).toBe(5);
  });

  it("a listed package missing: who could see anything can't be told, so a step counts as showing everything; refused while someone else is seated, saying why; free alone", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = { packages: [{ url: fakeUrl() }] };
    for (const seated of [["ann", "bob"], ["ann"]]) {
      s = await mountStage({ viewerId: "ann", extensions: [{ meta: { id: "scene.undo" }, module: undo }, TABLE], doc: { ...cardDoc(seated), ...missing } });
      await settle();
      const edit = s.api("scene.undo");
      // a move on the table, face down: no reveal, were the audience known
      edit.edit((d) => (d.objects.card.transform.position = [1, 0, 0]), { label: "Move" });
      const alone = seated.length === 1;
      expect(edit.undo(), seated.join("+")).toBe(alone);
      if (!alone)
        expect(s.local.get().notices.at(-1).text).toBe(
          "Can't undo “Move”: who could see what it changed can't be told (a package the scene uses is missing or didn't start), and taking it back needs the others' agreement.",
        );
      s.unmount();
      s = null;
    }
  });

  it("a package's `decided` marks a step as deciding: refused while others have a stake, whatever the audience did", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const DECIDES = {
      meta: { id: "t.decides", traits: ["t.card"] },
      module: { create: () => ({ decided: (before, after) => (before.objects.card?.name !== after.objects.card?.name ? ["card"] : []) }) },
    };
    s = await mountStage({ viewerId: "ann", extensions: [{ meta: { id: "scene.undo" }, module: undo }, TABLE, DECIDES], doc: cardDoc(["ann", "bob"]) });
    await settle();
    const edit = s.api("scene.undo");
    edit.edit((d) => (d.objects.card.name = "Drawn"), { label: "Rename" });
    expect(edit.undo()).toBe(false);
    edit.edit((d) => (d.objects.card.transform.position = [1, 0, 0]), { label: "Move" });
    expect(edit.undo()).toBe(true);
  });

  it("deleting something a keeper holds the contents of: undo puts the doc's part back and says the kept part is as its keeper has it now", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const KEEPER = { meta: { id: "t.keeper", keeper: "plain", traits: ["t.kept"] }, module: { create: () => ({}) } };
    s = await mountStage({
      extensions: [{ meta: { id: "scene.select" }, module: select }, { meta: { id: "scene.undo" }, module: undo }, KEEPER],
      doc: { objects: { c1: object({ name: "Card", traits: { "t.kept": { by: "automerge:box", slot: 3 } } }), d: object({ name: "Die" }) }, order: ["c1", "d"] },
    });
    await settle();
    const run = (command, target) => s.api("scene.undo").run({ ext: "scene.select", command, target });
    run("remove", "c1");
    expect(s.doc().objects.c1).toBeUndefined();
    expect(s.api("scene.undo").undo()).toBe(true);
    expect(s.doc().objects.c1.traits["t.kept"]).toEqual({ by: "automerge:box", slot: 3 });
    expect(s.local.get().notices.at(-1).text).toBe("Undid “Delete”: what is kept for “Card” comes back as its keeper has it now, not as it was.");
    // something no keeper holds: undone without a word
    const before = s.local.get().notices.length;
    run("remove", "d");
    expect(s.api("scene.undo").undo()).toBe(true);
    expect(s.local.get().notices.length).toBe(before);
  });

  it("only the stage's own parts can edit: a package's api has no edit, edits, undo or redo", async () => {
    s = await mountStage({ extensions: [{ meta: { id: "scene.undo" }, module: undo }, TABLE, DICE], doc: cardDoc([]) });
    await settle();
    for (const k of ["edit", "edits", "undo", "redo"]) {
      expect(typeof s.api("scene.undo")[k], k).toBe("function");
      expect(s.api("t.table")[k], k).toBeUndefined();
      expect(s.api("t.dice")[k], k).toBeUndefined();
    }
    // a package passing a part's module through as its own isn't it: the mark is the module, not the id
    s.unmount();
    s = await mountStage({ extensions: [{ meta: { id: "scene.undo" }, module: { create: (api) => undo.create(api) } }], doc: cardDoc([]) });
    await settle();
    expect(s.api("scene.undo").edit).toBeUndefined();
    // nor can it swap a part's create for its own: the marked module is frozen
    const mine = (api) => ({ api });
    expect(() => {
      "use strict";
      undo.create = mine;
    }).toThrow(TypeError);
    expect(undo.create).not.toBe(mine);
  });
});
