// A seat per port (seating.js), over its bounded spaces: 1 to 4 ports, every
// seat a view could be sitting in, every pair of ports wanted and held,
// every way ports can be held.
import { portSeats, portOf, seatsFor, placesFor, seatStep, follow, portToPlay } from "./seating.js";
import { screenOf, BODY } from "./cabinet.js";

test("a view's port on a machine: the index of its seat in the machine's list, only when it's that machine's own seat; every seat × 1-4 ports", () => {
  // a seat sat in: this machine's (each listed seat, one unlisted), another object's of the same name, the doc's own of the same name, or none
  let cases = 0;
  for (const ports of [1, 2, 3, 4]) {
    const seats = portSeats(ports);
    expect(seats).toEqual(Array.from({ length: ports }, (_, p) => `p${p + 1}`));
    const sittings = [null, ...seats.flatMap((seat) => [{ of: "m", seat }, { of: "k", seat }, { of: null, seat }]), { of: "m", seat: `p${ports + 1}` }, { of: "m", seat: "x" }];
    for (const s of sittings) {
      const want = s?.of === "m" && seats.includes(s.seat) ? seats.indexOf(s.seat) : null;
      expect(portOf("m", seats, ports, s)).toBe(want);
      // a list longer than the machine's ports: a seat past them plays no port
      expect(portOf("m", [...seats, "extra"], ports, s)).toBe(want);
      // no list: no seats, no port
      expect(portOf("m", null, ports, s)).toBe(null);
      cases++;
    }
  }
  expect(cases).toBe([1, 2, 3, 4].reduce((n, p) => n + 1 + 3 * p + 2, 0));
});

test("the seats a machine lays: one per port, named for it, each eye in front of the screen looking at it, in the object's frame", () => {
  for (const kind of ["doom", "snes"])
    for (const ports of [1, 2, 3, 4]) {
      const screen = screenOf(kind);
      const seats = seatsFor("m", { title: "Unarmed", ports, screen });
      expect(Object.keys(seats)).toEqual(portSeats(ports));
      const eyes = Object.values(seats).map((s) => s.camera.position);
      for (const [p, s] of Object.values(seats).entries()) {
        expect(s.name).toBe(`Unarmed · P${p + 1}`);
        expect(s.lasting).toBe(false); // a port is held only while someone sits at it
        expect(s.camera.in).toBe("m");
        expect(s.camera.target).toEqual(screen.center);
        expect(s.camera.position[2]).toBeGreaterThan(screen.center[2] + 1); // in front of it
        expect(Math.abs(s.camera.position[0])).toBeLessThan(screen.width); // within the screen's width either side
      }
      expect(new Set(eyes.map((e) => e.join())).size).toBe(ports); // no two in one place
    }
});

test("the places: a strip along the cabinet's front, one per listed seat, side by side, each the machine's own seat", () => {
  for (const ports of [1, 2, 3, 4]) {
    const seats = portSeats(ports);
    const places = placesFor("m", seats);
    expect(places.map((z) => [z.seat, z.of, z.id])).toEqual(seats.map((seat) => [seat, "m", "m"]));
    for (const [p, z] of places.entries()) {
      expect(z.max[0] - z.min[0]).toBeCloseTo(BODY.width / ports, 12); // its share of the front
      expect(z.min[0]).toBeCloseTo(-BODY.width / 2 + (p * BODY.width) / ports, 12); // in port order
      expect(z.min[2]).toBeLessThan(BODY.depth / 2); // across the front face
      expect(z.max[2]).toBeGreaterThan(BODY.depth / 2);
    }
  }
  expect(placesFor("m", null)).toEqual([]);
});

test("following a seat: every port wanted × held × who holds the wanted one; the step leaves the view holding what it wants when it's free, and never asks for a port someone plainly holds", () => {
  // a stub runMachine: the host's seat, who holds each port, play and leave as the host does them
  // (play refuses a held port, or one whose holder only just stood up: `late`)
  const PORTS = [null, 0, 1, 2, 3];
  let cases = 0;
  for (const want of PORTS)
    for (const have of PORTS)
      for (const other of ["free", "held", "late"]) {
        if (have !== null && have === want && other !== "free") continue; // (a port this view holds is nobody else's)
        const holders = [0, 1, 2, 3].map((p) => (p === have ? { by: "me" } : p === want && other === "held" ? { by: "them" } : null));
        const calls = [];
        const m = {
          host: { seat: have === null ? null : { port: have } },
          holders: () => holders.slice(),
          play(port) {
            calls.push(["play", port]);
            if (holders[port] !== null || (port === want && other === "late")) return null;
            holders[port] = { by: "me" };
            m.host.seat = { port };
            return port;
          },
          leave() {
            calls.push(["leave"]);
            if (m.host.seat) holders[m.host.seat.port] = null;
            m.host.seat = null;
          },
        };
        follow(m, want, { pickUp: (p) => calls.push(["up", p]), putDown: () => calls.push(["down"]) });
        const step = seatStep(want, have);
        const free = want !== null && other === "free";
        const asks = want !== null && other !== "held"; // a plainly held port isn't asked for
        const expected = [];
        if (step === "stand" || step === "move") expected.push(["down"], ["leave"]);
        if (step === "sit" || step === "move") {
          if (asks) expected.push(["play", want]);
          if (free) expected.push(["up", want]);
        }
        expect([want, have, other, calls]).toEqual([want, have, other, expected]);
        // where it ends: what it wants if that was free; nothing if it had to give its own back for a port it can't have yet
        expect(m.host.seat?.port ?? null).toBe(step === null ? have : free ? want : null);
        cases++;
      }
  expect(cases).toBe(5 * 5 * 3 - 4 * 2);
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
