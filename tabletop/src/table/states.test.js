// A piece's states (GAME-FORMAT.md §4): drawn by ref (states.js), laid out
// in the state the game says with every look named in the thing's trait
// (setup.js), turned for everyone by one write (states.js, the
// "tabletop.states" extension), shown over the object by the stage's
// display, left behind by a copy, and merged by Automerge when two people
// turn one piece at once: the last writer wins, the same on every peer.
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import States, { PICKS, statesOf, turnTo, turnedLooks } from "./states.js";
import { STATES, lookIndex, lookRef, parseRef, pieceAt, refsOf } from "../states.js";
import { kindsLaid, kindsUsed, tableLayout } from "../setup.js";
import { testScene } from "./test-scene.js";
import { roster, SEATS } from "../test/stand-ins.js";
import { cleanObject, copyRules, describesOf } from "../library/copy-rule.js";
import { plugins } from "../index.js";
import { validate } from "../../contract/v2/validate.js";
import every from "../../contract/v2/fixtures/valid/every-feature.json" with { type: "json" };

const fileOf = (ref) => ({ url: `automerge:2File${ref.replace(/[^A-Za-z0-9]/g, "")}`.padEnd(40, "x"), hint: { bounds: { min: [-0.01, 0, -0.01], max: [0.01, 0.01, 0.01] } } });
const ships = (layout) => Object.values(layout.objects).filter((o) => o.traits?.[STATES]);

describe("a piece's looks, by ref", () => {
  const ship = every.pieces.ship;

  it("names its own look by its kind and each state by #n; a ref that names no look is nothing", () => {
    expect(refsOf(every.pieces, "ship")).toEqual(["ship", "ship#1", "ship#2"]);
    expect(parseRef("ship#2")).toEqual({ kind: "ship", i: 2 });
    expect(parseRef("ship")).toEqual({ kind: "ship", i: 0 });
    expect(lookRef("ship", 0)).toBe("ship");
    expect(pieceAt(every.pieces, "ship")).toBe(ship);
    expect(pieceAt(every.pieces, "ship#3")).toBe(null);
    expect(pieceAt(every.pieces, "pawn#1")).toBe(null);
    expect(lookIndex(ship, "Ship (docked)")).toBe(2);
    expect(lookIndex(ship, "Ship")).toBe(0);
    expect(lookIndex(ship, undefined)).toBe(0);
    expect(lookIndex(ship, "Ship (sunk)")).toBe(-1);
  });

  it("draws a state as the piece with that look, its own snap points, or else the piece's; nothing of the other states", () => {
    const damaged = pieceAt(every.pieces, "ship#1");
    expect(damaged).toEqual({ name: "Ship (damaged)", parts: ship.states[0].parts });
    const docked = pieceAt(every.pieces, "ship#2");
    expect(docked.snapPoints).toEqual(ship.states[1].snapPoints);
    const board = { name: "Board", parts: [], snapPoints: [{ position: [0, 0, 0] }], locked: true, states: [{ name: "Board for three", parts: [] }] };
    expect(pieceAt({ board }, "board#1")).toEqual({ name: "Board for three", parts: [], snapPoints: board.snapPoints, locked: true });
  });
});

describe("a table with a piece in a state (setup.js)", () => {
  it("lays it out showing that state, its trait naming every look and the one it was laid out in", () => {
    expect(validate(every).ok).toBe(true);
    const layout = tableLayout(every, { fileOf, rng: () => 0.5 });
    const laid = ships(layout);
    expect(laid).toHaveLength(2);
    for (const o of laid) {
      expect(o.sourceUrl).toBe(fileOf("ship#1").url);
      expect(o.traits[STATES]).toEqual({
        looks: [
          { name: "Ship", sourceUrl: fileOf("ship").url },
          { name: "Ship (damaged)", sourceUrl: fileOf("ship#1").url },
          { name: "Ship (docked)", sourceUrl: fileOf("ship#2").url },
        ],
        own: 1,
      });
    }
  });

  it("from a game page: each look named by the game and its ref, drawn when first shown; only the state laid out is drawn to set it up", () => {
    const layout = tableLayout(every, { fileOf, faceOf: (kind) => ({ game: "automerge:game", kind }), rng: () => 0.5 });
    expect(ships(layout)[0].traits[STATES].looks).toEqual([
      { name: "Ship", game: "automerge:game", kind: "ship" },
      { name: "Ship (damaged)", game: "automerge:game", kind: "ship#1" },
      { name: "Ship (docked)", game: "automerge:game", kind: "ship#2" },
    ]);
    expect(kindsLaid(every)).toContain("ship#1");
    expect(kindsLaid(every)).not.toContain("ship");
    expect(kindsLaid(every)).not.toContain("ship#2");
    // (a template's or part's table draws every look up front)
    expect(kindsUsed(every)).toEqual(expect.arrayContaining(["ship", "ship#1", "ship#2"]));
  });

  it("a thing laid out in its piece's own look shows it, and its trait says so", () => {
    const g = structuredClone(every);
    delete g.setup.at(-1).state;
    const [o] = ships(tableLayout(g, { fileOf, rng: () => 0.5 }));
    expect(o.sourceUrl).toBe(fileOf("ship").url);
    expect(o.traits[STATES].own).toBe(0);
    expect(kindsLaid(g)).toContain("ship");
  });
});

/** A ship lying on the table, and a tray that is seat a's hand (a stand-in's seats), as a scene snapshot. */
function table({ shown, inHand = false } = {}) {
  const looks = [{ name: "Ship", sourceUrl: "automerge:ship" }, { name: "Ship (damaged)", game: "automerge:game", kind: "ship#1" }, { name: "Ship (docked)", sourceUrl: "automerge:docked" }];
  return {
    objects: {
      ship: { name: "Ship 1", transform: { position: inHand ? [0, 0.01, 0.3] : [0, 0.01, 0] }, traits: { [STATES]: { looks, own: 0, ...(shown != null ? { shown } : {}) } } },
      tray: { name: "Tray", transform: { position: [0, 0, 0.3] }, traits: { "tabletop.zone": { seat: "a", min: [-0.2, 0, -0.05], max: [0.2, 0.05, 0.05] } } },
    },
    traits: { [SEATS]: { a: { name: "A", player: "ann" }, b: { name: "B", player: "ben" } } },
  };
}

/** Just enough of the stage for the states extension: displays recorded, changes applied to the doc. */
function stage(doc, viewer = "ann") {
  const shown = new Map();
  const api = {
    channel: { viewer },
    repo: null,
    scene: () => testScene(doc.objects, doc.traits),
    change: (fn) => {
      api.changes++;
      fn(doc);
    },
    changes: 0,
    use: () => null,
    collect: (name) => (name === "roster" ? [{ value: roster }] : []),
    display: (id, o) => {
      shown.set(id, o);
      return () => shown.delete(id);
    },
  };
  const ext = States.create(api);
  const update = () => ext.update(api.scene(), {}, null);
  const command = (id) => ext.commands.find((c) => c.id === id);
  return { api, ext, shown, update, command };
}

describe("turning a piece (the tabletop.states extension)", () => {
  it("reads a trait whole: every look, the one laid out, the one shown (a bad `shown` is its own); none for one look", () => {
    expect(statesOf(table().objects.ship)).toMatchObject({ own: 0, now: 0 });
    expect(statesOf(table({ shown: 2 }).objects.ship)).toMatchObject({ own: 0, now: 2 });
    expect(statesOf(table({ shown: 7 }).objects.ship)).toMatchObject({ now: 0 });
    expect(statesOf({ traits: { [STATES]: { looks: [{ name: "One" }], own: 0 } } })).toBe(null);
    expect(statesOf({})).toBe(null);
  });

  it("PgDn turns it to its next look, for everyone, in one write; PgUp to the one before; a number key to that look", () => {
    const doc = table();
    const s = stage(doc);
    s.update();
    expect(s.command("state-next")).toMatchObject({ key: "PageDown" });
    expect(s.command("state-previous")).toMatchObject({ key: "PageUp" });
    expect(s.command("state-2")).toMatchObject({ key: "2", show: ["menu"] });
    expect(s.command("state-next").state("ship")).toMatchObject({ label: "Turn to Ship (damaged)" });
    expect(s.command("state-previous").state("ship")).toMatchObject({ label: "Turn to Ship (docked)" });
    expect(s.command("state-1").state("ship")).toBe(null); // (the one it shows)
    expect(s.command("state-3").state("ship")).toMatchObject({ label: "Turn to Ship (docked)" });
    expect(s.command(`state-${PICKS}`).state("ship")).toBe(null);
    expect(s.command("state-next").state("tray")).toBe(null);

    s.command("state-next").run("ship");
    expect(s.api.changes).toBe(1);
    expect(doc.objects.ship.traits[STATES].shown).toBe(1);
    s.command("state-previous").run("ship");
    expect(doc.objects.ship.traits[STATES].shown).toBe(0);
    s.command("state-3").run("ship");
    expect(doc.objects.ship.traits[STATES].shown).toBe(2);
    // the one it shows: nothing written
    s.update();
    s.command("state-3").run("ship");
    expect(s.api.changes).toBe(3);
  });

  it("with two looks, PgDn turns it to the other and back; PgUp and the number keys offer nothing more", () => {
    const doc = table();
    doc.objects.ship.traits[STATES].looks.pop();
    const s = stage(doc);
    s.update();
    expect(s.command("state-next").state("ship")).toMatchObject({ label: "Turn to Ship (damaged)" });
    expect(s.command("state-previous").state("ship")).toBe(null);
    expect(s.command("state-2").state("ship")).toBe(null);
    s.command("state-next").run("ship");
    s.update();
    expect(s.command("state-next").state("ship")).toMatchObject({ label: "Turn to Ship" });
    s.command("state-next").run("ship");
    expect(doc.objects.ship.traits[STATES].shown).toBe(0);
  });

  it("shows the look it's turned to over the object (its own file is the one it was laid out in), and puts it back", () => {
    const doc = table();
    const s = stage(doc);
    s.update();
    expect(s.shown.size).toBe(0);
    s.command("state-3").run("ship");
    s.update();
    expect(s.shown.get("ship")).toEqual({ name: "Ship (docked)", content: "automerge:docked" });
    s.command("state-1").run("ship");
    s.update();
    expect(s.shown.size).toBe(0);
  });

  it("a piece in someone's hand follows the hand's rule: its seat sees it turned, everyone else as it was laid out", () => {
    const doc = table({ shown: 2, inHand: true });
    const snap = testScene(doc.objects, doc.traits);
    expect([...turnedLooks(snap, { mine: "a" }).keys()]).toEqual(["ship"]);
    expect([...turnedLooks(snap, { mine: "b" }).keys()]).toEqual([]);
    expect([...turnedLooks(snap, { mine: null }).keys()]).toEqual([]);
    const ann = stage(structuredClone(doc), "ann");
    const ben = stage(structuredClone(doc), "ben");
    ann.update();
    ben.update();
    expect(ann.shown.has("ship")).toBe(true);
    expect(ben.shown.has("ship")).toBe(false);
  });

  it("two people turning one piece at once: the merge keeps one look, the same whichever way it's merged", () => {
    const base = Automerge.from(JSON.parse(JSON.stringify(table())));
    const peers = { ann: Automerge.load(Automerge.save(base)), ben: Automerge.load(Automerge.save(base)) };
    peers.ann = Automerge.change(peers.ann, turnTo("ship", 1));
    peers.ben = Automerge.change(peers.ben, turnTo("ship", 2));
    const one = Automerge.merge(Automerge.clone(peers.ann), peers.ben);
    const other = Automerge.merge(Automerge.clone(peers.ben), peers.ann);
    const shown = (d) => Automerge.toJS(d).objects.ship.traits[STATES].shown;
    expect([1, 2]).toContain(shown(one));
    expect(shown(other)).toBe(shown(one));
    expect(Automerge.toJS(one)).toEqual(Automerge.toJS(other));
    // each turn is one write of one field, and nothing else
    for (const p of Object.values(peers)) expect(Automerge.diff(p, Automerge.getHeads(base), Automerge.getHeads(p)).map((x) => [x.action, x.path.join(".")])).toEqual([["put", `objects.ship.traits.${STATES}.shown`]]);
  });

  it("a copy (a forked session) leaves which look it shows behind: it shows the one it was laid out in", () => {
    const rules = copyRules(describesOf(plugins.filter((p) => p.type === "scene:extension")));
    const copied = cleanObject(table({ shown: 2 }).objects.ship, rules);
    expect(copied.traits[STATES].shown).toBeUndefined();
    expect(statesOf(copied)).toMatchObject({ own: 0, now: 0 });
  });
});
