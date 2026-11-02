import { describe, it, expect } from "vitest";
import { isFaceUp, revealedSecrets, seatAt, seatOf, zoneRegions } from "./secrets.js";

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
