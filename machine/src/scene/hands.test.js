// The pad in hand and the port it holds (hands.js), over its bounded space:
// for a machine with seats, every seat this view could sit in × the pad in
// hand or put down (Escape) × what P is looked at; for one without, the pad
// in hand or not × the ports free or full × what P is looked at. Stub
// machines (a host's seat, who holds each port, play and leave as the host
// does them) and a stub held-tool slot (as the stage's: one tool, Escape
// puts it down, a new one replaces it).
import { hands } from "./hands.js";

function stubMachine(id, { seats = null, held = [] } = {}) {
  const ports = 2;
  const h = Array.from({ length: ports }, (_, p) => (held.includes(p) ? { by: "them" } : null));
  const m = {
    host: { seat: null },
    holders: () => h.slice(),
    play(port) {
      if (m.host.seat) return m.host.seat.port;
      if (h[port] !== null) return null;
      h[port] = { by: "me" };
      m.host.seat = { port };
      return port;
    },
    leave() {
      if (m.host.seat) h[m.host.seat.port] = null;
      m.host.seat = null;
    },
  };
  const pad = { down: new Set(), cleared: 0, key: (code, on) => (on ? pad.down.add(code) : pad.down.delete(code)), clear: () => (pad.cleared++, pad.down.clear()) };
  return { e: { id, m, pad, ports, kind: "snes", title: id.toUpperCase(), note: null }, seats };
}

/** A view: machines by id, the seat it sits in, the held-tool slot. */
function view(specs, sat = null) {
  const machines = new Map();
  const seats = new Map();
  for (const [id, o] of Object.entries(specs)) {
    const { e, seats: list } = stubMachine(id, o);
    machines.set(id, e);
    seats.set(id, list);
  }
  const v = { machines, sat, tool: null, notices: [] };
  v.h = hands({
    machines,
    hold(spec, input) {
      const was = v.tool;
      v.tool = { spec, input };
      if (was) was.input.put(); // replaced: the old one is put down
      return () => {
        if (v.tool?.input === input) (v.tool = null), input.put();
      };
    },
    sitting: () => v.sat,
    seatsOf: (id) => seats.get(id) ?? null,
    prefer: () => 1,
    notify: (t) => v.notices.push(t),
  });
  v.frame = () => {
    for (const e of machines.values()) v.h.follow(e);
  };
  /** Escape: the held tool put down, as the stage does it. */
  v.escape = () => {
    const t = v.tool;
    v.tool = null;
    t?.input.put();
  };
  v.port = (id) => machines.get(id).m.host.seat?.port ?? null;
  v.pad = () => v.tool?.spec.name ?? null;
  return v;
}

const SEATS = ["p1", "p2"];
const SITTINGS = [null, { of: "m", seat: "p1" }, { of: "m", seat: "p2" }, { of: "n", seat: "p1" }, { of: null, seat: "p1" }, { of: "k", seat: "p1" }];
const TARGETS = ["m", "n", "floor", null];

test("a machine with seats: the port follows the seat, Escape keeps it while you sit, and P picks the pad up, puts it down, or (not sitting) does nothing; looking at anything else, P is the machine you sit at", () => {
  // m and n both have seats; nobody else is at either
  let cases = 0;
  for (const sat of SITTINGS)
    for (const pad of ["in hand", "put down"])
      for (const target of TARGETS) {
        const v = view({ m: { seats: SEATS }, n: { seats: SEATS } }, sat);
        v.frame();
        // where it sits: the port of that seat, on that machine, with its pad in hand
        const at = sat && sat.of !== null && sat.of !== "k" ? sat.of : null;
        const port = at ? SEATS.indexOf(sat.seat) : null;
        expect([v.port("m"), v.port("n")]).toEqual([at === "m" ? port : null, at === "n" ? port : null]);
        expect(v.pad()).toBe(at ? `${at.toUpperCase()} · P${port + 1}` : null);
        if (pad === "put down") {
          v.escape();
          // Escape: the pad down, the port still this view's while it sits
          expect([v.pad(), at ? v.port(at) : null]).toEqual([null, port]);
        }
        const inHand = at && pad === "in hand";
        // what P acts on: the machine looked at; else the one whose pad is in hand, or whose seat this view sits in
        const on = target === "m" || target === "n" ? target : at;
        const verb = v.h.verb(target);
        const want = on == null ? null : on !== at ? { label: "Play", disabled: true, title: "Sit at one of its seats to play (F)" } : inHand ? { label: "Put the pad down" } : { label: "Pick up the pad" };
        expect([sat, pad, target, verb]).toEqual([sat, pad, target, want]);
        v.h.play(target);
        // P: the pad down (the port kept), or picked up again, or (another machine, not sitting there) nothing at all
        expect(v.pad()).toBe(on === at && at && !inHand ? `${at.toUpperCase()} · P${port + 1}` : on !== at && inHand ? `${at.toUpperCase()} · P${port + 1}` : null);
        expect([v.port("m"), v.port("n")]).toEqual([at === "m" ? port : null, at === "n" ? port : null]);
        expect(v.notices).toEqual([]);
        // and getting up gives the port back, the pad with it
        v.sat = null;
        v.frame();
        expect([v.port("m"), v.port("n"), v.pad()]).toEqual([null, null, null]);
        cases++;
      }
  expect(cases).toBe(SITTINGS.length * 2 * TARGETS.length);
});

test("a machine without seats: P takes a free port (the preferred first) with the pad, Escape gives it back; full, it says so; a seat sat in elsewhere changes nothing", () => {
  let cases = 0;
  for (const held of [[], [1], [0, 1]])
    for (const pad of ["in hand", "none"])
      for (const sat of [null, { of: "m", seat: "p1" }])
        for (const target of TARGETS) {
          const v = view({ m: { held }, n: { seats: SEATS } }, sat);
          v.frame();
          expect(v.port("m")).toBe(null); // a seat named like one of its ports is nothing to a machine that lists none
          const free = [0, 1].filter((p) => !held.includes(p));
          const first = free.includes(1) ? 1 : (free[0] ?? null);
          if (pad === "in hand") {
            v.h.play("m");
            expect(v.port("m")).toBe(first);
          }
          const inHand = pad === "in hand" && first !== null;
          const on = target === "m" || target === "n" ? target : inHand ? "m" : null;
          const verb = v.h.verb(target);
          const want =
            on === null ? null
            : on === "n" ? { label: "Play", disabled: true, title: "Sit at one of its seats to play (F)" }
            : inHand ? { label: "Put the pad down" }
            : first === null ? { label: "Play", disabled: true, title: "Every port is taken" }
            : { label: "Play" };
          expect([held, pad, sat, target, verb]).toEqual([held, pad, sat, target, want]);
          const notices = v.notices.length;
          v.h.play(target);
          if (on === "m" && inHand) expect([v.port("m"), v.pad()]).toEqual([null, null]); // put down: the port given back
          else if (on === "m" && first !== null) expect([v.port("m"), v.pad()]).toEqual([first, "M · P" + (first + 1)]);
          else if (on === "m") expect(v.notices.slice(notices)).toEqual(["Every port on that machine is taken"]);
          else expect(v.port("m")).toBe(inHand ? first : null);
          // Escape gives back whatever port the pad held
          v.escape();
          expect([v.port("m"), v.pad()]).toEqual([null, null]);
          cases++;
        }
  expect(cases).toBe(3 * 2 * 2 * TARGETS.length);
});

test("a machine going puts its pad down; another's stays in hand", () => {
  for (const going of ["m", "n"]) {
    const v = view({ m: { seats: SEATS }, n: {} }, { of: "m", seat: "p2" });
    v.frame();
    expect(v.pad()).toBe("M · P2");
    v.h.drop(going);
    expect(v.pad()).toBe(going === "m" ? null : "M · P2");
  }
});
