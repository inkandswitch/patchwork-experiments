// A seat per port (seating.js), over its bounded spaces: object ids that
// look alike, 1 to 4 ports, every pair of ports wanted and held, every way
// ports can be held.
import { seatId, portOfSeat, seatsFor, placesFor, seatedPorts, seatStep, portToPlay } from "./seating.js";
import { screenOf, BODY } from "./cabinet.js";

const IDS = ["m", "m1", "m10", "a", "a.p1", "o-x"];

test("a seat names one port of one machine: every id × 1-4 ports × every port, and nothing else reads as one", () => {
  let cases = 0;
  for (const id of IDS)
    for (const ports of [1, 2, 3, 4]) {
      for (let p = 0; p < ports; p++) {
        expect(portOfSeat(id, ports, seatId(id, p))).toBe(p);
        // another machine's seat is never this one's, however alike their ids
        for (const other of IDS) if (other !== id) expect(portOfSeat(other, ports, seatId(id, p))).toBe(null);
        cases++;
      }
      for (const sid of [null, undefined, 3, "", id, `${id}.p`, `${id}.p0`, `${id}.p${ports + 1}`, `${id}.p01`, `${id}.px`, `${id}.p1.p1`]) expect(portOfSeat(id, ports, sid)).toBe(null);
    }
  expect(cases).toBe(IDS.length * 10);
});

test("the seats a machine lays: one per port, named for it, each eye in front of the screen looking at it, in the object's frame", () => {
  for (const kind of ["doom", "snes"])
    for (const ports of [1, 2, 3, 4]) {
      const screen = screenOf(kind);
      const seats = seatsFor("m", { title: "Unarmed", ports, screen });
      expect(Object.keys(seats)).toEqual(Array.from({ length: ports }, (_, p) => seatId("m", p)));
      const eyes = Object.values(seats).map((s) => s.camera.position);
      for (const [p, s] of Object.values(seats).entries()) {
        expect(s.name).toBe(`Unarmed · P${p + 1}`);
        expect(s.camera.in).toBe("m");
        expect(s.camera.target).toEqual(screen.center);
        expect(s.camera.position[2]).toBeGreaterThan(screen.center[2] + 1); // in front of it
        expect(Math.abs(s.camera.position[0])).toBeLessThan(screen.width); // within the screen's width either side
      }
      expect(new Set(eyes.map((e) => e.join())).size).toBe(ports); // no two in one place
    }
});

test("the places: a strip along the cabinet's front, one per port, side by side, only for the seats laid", () => {
  for (const ports of [1, 2, 3, 4])
    for (let mask = 0; mask < 1 << ports; mask++) {
      const laid = new Set(Array.from({ length: ports }, (_, p) => (mask >> p) & 1 ? seatId("m", p) : null).filter(Boolean));
      const places = placesFor("m", ports, laid);
      expect(places.map((z) => z.seat)).toEqual([...laid]);
      for (const z of places) {
        const p = portOfSeat("m", ports, z.seat);
        expect(z.id).toBe("m");
        expect(z.max[0] - z.min[0]).toBeCloseTo(BODY.width / ports, 12); // its share of the front
        expect(z.min[0]).toBeCloseTo(-BODY.width / 2 + (p * BODY.width) / ports, 12); // in port order
        expect(z.min[2]).toBeLessThan(BODY.depth / 2); // across the front face
        expect(z.max[2]).toBeGreaterThan(BODY.depth / 2);
      }
    }
});

test("how many ports a machine has seats for: P1 up to the first missing", () => {
  for (let mask = 0; mask < 16; mask++) {
    const laid = new Set([0, 1, 2, 3].filter((p) => (mask >> p) & 1).map((p) => seatId("m", p)));
    let n = 0;
    while ((mask >> n) & 1) n++;
    expect(seatedPorts("m", laid)).toBe(n);
  }
});

test("following a seat: every port wanted × every port held, and doing the step leaves the view holding what it wants", () => {
  const PORTS = [null, 0, 1, 2, 3];
  for (const want of PORTS)
    for (const have of PORTS) {
      const step = seatStep(want, have);
      let held = have;
      if (step === "stand" || step === "move") held = null;
      if (step === "sit" || step === "move") held = want;
      expect(held).toBe(want);
      expect(step === null).toBe(want === have); // nothing done when nothing differs
      if (step === "sit") expect(have).toBe(null); // sitting only from standing: a held port is given back first
    }
});

test("Play's port, with no seats: the preferred one if it's free, else the first free, else none; over every way 1-4 ports are held", () => {
  let cases = 0;
  for (const ports of [1, 2, 3, 4])
    for (let mask = 0; mask < 1 << ports; mask++) {
      const holders = Array.from({ length: ports }, (_, p) => ((mask >> p) & 1 ? { id: `s${p}` } : null));
      for (let prefer = 0; prefer < ports; prefer++) {
        const port = portToPlay(holders, prefer);
        if (!holders.includes(null)) expect(port).toBe(null);
        else if (holders[prefer] === null) expect(port).toBe(prefer);
        else expect(port).toBe(holders.indexOf(null));
        cases++;
      }
    }
  expect(cases).toBe(2 * 1 + 4 * 2 + 8 * 3 + 16 * 4);
});
