import { describe, it, expect } from "vitest";
import { isFaceUp, plainResolver, revealedSecrets, seatAt, seatOf, seatedPlayers, visibility, zoneRegions } from "./secrets.js";

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
const objects = {
  // two hand trays, one turned round, each a private zone 0.6 × 0.1 m, 0.15 m high
  hand1: { name: "Hand 1", transform: T([0, 0, 0.5]), zone: { seat: "p1", min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] } },
  hand2: { name: "Hand 2", transform: T([0, 0, -0.5], [0, Math.PI, 0]), zone: { seat: "p2", min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] } },
  inHand1: { name: "Card", transform: T([0.1, 0.002, 0.5]) },
  inHand2Flipped: { name: "Card", transform: T([0.2, 0.002, -0.49], [0, 0, Math.PI]) },
  faceUp: { name: "Card", transform: T([0, 0, 0]) },
  faceDown: { name: "Card", transform: T([0.3, 0.001, 0], [0, 0.4, Math.PI]) },
  // attached to the tray: its world position decides
  onTray: { name: "Card", parent: "hand1", transform: T([-0.2, 0.002, 0]) },
  public: { name: "Board", transform: T([0, 0, 0]) },
};
const secret = (n) => ({ sourceUrl: `automerge:${n}`, name: n });
const secrets = {
  inHand1: secret("Red 7"),
  inHand2Flipped: secret("Blue 3"),
  faceUp: secret("Green 10"),
  faceDown: secret("White 2"),
  onTray: secret("Yellow wager"),
  gone: secret("Nothing"),
};

describe("zones", () => {
  it("finds the seat whose box holds a point, through the zone's own turn", () => {
    const regions = zoneRegions(objects);
    expect(regions.map((r) => r.seat).sort()).toEqual(["p1", "p2"]);
    expect(seatAt(regions, [0.25, 0.1, 0.52])).toBe("p1");
    expect(seatAt(regions, [-0.25, 0.1, -0.46])).toBe("p2");
    expect(seatAt(regions, [0, 0.2, 0.5])).toBeNull(); // above it
    expect(seatAt(regions, [0, 0, 0])).toBeNull();
  });
  it("ignores a malformed zone", () => {
    expect(zoneRegions({ a: { transform: T([0, 0, 0]), zone: { seat: "p1" } } })).toEqual([]);
  });
});

describe("face up", () => {
  it("is +Y up in the world, whatever the yaw", () => {
    expect(isFaceUp(objects, "faceUp")).toBe(true);
    expect(isFaceUp(objects, "faceDown")).toBe(false);
    expect(isFaceUp({ a: { transform: T([0, 0, 0], [0, 2, 0]) } }, "a")).toBe(true);
  });
});

describe("revealedSecrets", () => {
  it("a hand is its seat's alone, either way up; the table is face up for everyone", () => {
    const names = (seat) => [...revealedSecrets(objects, secrets, seat).values()].map((s) => s.name).sort();
    expect(names("p1")).toEqual(["Green 10", "Red 7", "Yellow wager"]);
    expect(names("p2")).toEqual(["Blue 3", "Green 10"]);
    expect(names(null)).toEqual(["Green 10"]);
  });
  it("tolerates no secrets doc yet", () => {
    expect(revealedSecrets(objects, null, "p1").size).toBe(0);
  });
});

describe("seatOf", () => {
  it("is where the viewer sits, or null", () => {
    const seats = { p1: { name: "Player 1", player: "automerge:me" }, p2: { name: "Player 2", player: null } };
    expect(seatOf(seats, "automerge:me")).toBe("p1");
    expect(seatOf(seats, "automerge:you")).toBeNull();
    expect(seatOf(seats, null)).toBeNull();
  });
});

describe("visibility", () => {
  const seats = { p1: { name: "Player 1", player: "automerge:me" }, p2: { name: "Player 2", player: "automerge:you" } };
  it("is the zone rule, per player; null is what everyone sees", () => {
    const v = visibility(objects, seats);
    // (each tray is inside its own zone, so it counts as its seat's; harmless, it isn't hidden)
    expect([...v("automerge:me")].sort()).toEqual(["faceUp", "hand1", "inHand1", "onTray", "public"]);
    expect([...v("automerge:you")].sort()).toEqual(["faceUp", "hand2", "inHand2Flipped", "public"]);
    expect([...v(null)].sort()).toEqual(["faceUp", "public"]);
    expect([...v("automerge:stranger")]).toEqual([...v(null)]);
  });
  it("lists who is seated", () => {
    expect(seatedPlayers(seats)).toEqual(["automerge:me", "automerge:you"]);
    expect(seatedPlayers({ a: { player: null } })).toEqual([]);
  });
});

describe("plainResolver", () => {
  it("looks up what the viewer may see, and says when that changes", () => {
    let doc = { objects: secrets };
    const listeners = new Set();
    const handle = { doc: () => doc, on: (_, f) => listeners.add(f), off: (_, f) => listeners.delete(f) };
    let changes = 0;
    const r = plainResolver({ handle, viewer: "automerge:me", onChange: () => changes++ });
    const seats = { p1: { name: "Player 1", player: "automerge:me" } };
    r.update({ visibleTo: visibility(objects, seats) });
    expect([...r.looks().values()].map((s) => s.name).sort()).toEqual(["Green 10", "Red 7", "Yellow wager"]);
    doc = { objects: { ...secrets, faceUp: secret("Blue 9") } };
    for (const f of listeners) f();
    expect(changes).toBe(1);
    expect(r.looks().get("faceUp").name).toBe("Blue 9");
    for (const f of listeners) f(); // nothing new
    expect(changes).toBe(1);
    r.dispose();
    expect(listeners.size).toBe(0);
  });

  it("shuffles by permuting the entries of the objects asked for, and nothing else", () => {
    let doc = { objects: { a: secret("A"), b: secret("B"), c: secret("C"), d: secret("D") } };
    const handle = { doc: () => doc, change(fn) { const x = structuredClone(doc); fn(x); doc = x; }, on() {}, off() {} };
    const r = plainResolver({ handle, viewer: null, onChange: () => {} });
    expect(r.shuffle(["a", "b", "c", "missing"], () => 0)).toBe(3);
    expect(Object.values(doc.objects).map((s) => s.name).sort()).toEqual(["A", "B", "C", "D"]);
    expect(doc.objects.d.name).toBe("D");
    expect(["a", "b", "c"].map((id) => doc.objects[id].name)).not.toEqual(["A", "B", "C"]);
    expect(r.shuffle(["a"])).toBe(0);
  });
});
