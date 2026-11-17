// The pad in hand and the port it holds (hands.js), over its bounded space:
// for a machine with seats, every seat this view could sit in × the pad in
// hand or put down (Escape) × what P is looked at; for one without, the pad
// in hand or not × the ports free or full × what P is looked at. Stub
// machines (a host's seat, who holds each port, play and leave as the host
// does them) and a stub held-tool slot (as the stage's: one tool, Escape
// puts it down, a new one replaces it).
import { hands } from "./hands.js";

function stubMachine(id, { seats = null, held = [], started = true } = {}) {
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
  return { e: { id, m: started ? m : null, pad, ports, kind: "snes", title: id.toUpperCase(), note: started ? null : "Starting…" }, seats };
}

/**
 * A view: machines by id, the seat it sits in, the held-tool slot, and the
 * seats' roster (as seats/ has it: each seat's state for this view, and sit,
 * which takes a free one and refuses the rest; `refuse` lists seats it
 * refuses although they read free, a race lost), or none (`roster: null`).
 */
function view(specs, sat = null, { states = {}, refuse = [], roster = "seats" } = {}) {
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
    // the seats' roster; none; or one that can't sit anyone (sitting() alone: a roster from something else)
    roster: () => (roster === "seats" ? v.roster : roster === "sitting only" ? { sitting: () => v.sat } : null),
  });
  const key = (ref) => `${ref.of}:${ref.seat}`;
  v.sits = [];
  v.roster = {
    stateOf: (ref) => (v.sat?.of === ref.of && v.sat?.seat === ref.seat ? "mine" : (states[key(ref)] ?? "free")),
    sit(ref) {
      v.sits.push(key(ref));
      if (refuse.includes(key(ref)) || v.roster.stateOf(ref) !== "free") return false;
      v.sat = { of: ref.of, seat: ref.seat };
      return true;
    },
  };
  v.frame = () => {
    for (const e of machines.values()) if (e.m) v.h.follow(e); // as the extension: only a running machine follows
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

test("a machine with seats: the port follows the seat, Escape keeps it while you sit, and P picks the pad up, puts it down, or (not sitting at it) sits you at its first free port's seat; looking at anything else, P is the machine you sit at", () => {
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
        // (another machine: Play sits you at its preferred port, P2, every seat there being free)
        const want = on == null ? null : on !== at ? { label: "Play", title: "Sit at P2 with its pad" } : inHand ? { label: "Put the pad down" } : { label: "Pick up the pad" };
        expect([sat, pad, target, verb]).toEqual([sat, pad, target, want]);
        v.h.play(target);
        // P: the pad down (the port kept), or picked up again; or, at another machine, sat at its P2
        if (on != null && on !== at) {
          expect([v.sits, v.sat]).toEqual([[`${on}:p2`], { of: on, seat: "p2" }]);
          v.frame(); // the port and its pad follow the seat: the old port given back, the new one taken
          expect([v.port("m"), v.port("n"), v.pad()]).toEqual([on === "m" ? 1 : null, on === "n" ? 1 : null, `${on.toUpperCase()} · P2`]);
        } else {
          expect(v.sits).toEqual([]);
          expect(v.pad()).toBe(on === at && at && !inHand ? `${at.toUpperCase()} · P${port + 1}` : null);
          expect([v.port("m"), v.port("n")]).toEqual([at === "m" ? port : null, at === "n" ? port : null]);
        }
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
            : on === "n" ? { label: "Play", title: "Sit at P2 with its pad" }
            : inHand ? { label: "Put the pad down" }
            : first === null ? { label: "Play (every port is taken)", disabled: true, title: "Every port is taken" }
            : { label: "Play" };
          expect([held, pad, sat, target, verb]).toEqual([held, pad, sat, target, want]);
          const notices = v.notices.length;
          v.h.play(target);
          if (on === "m" && inHand) expect([v.port("m"), v.pad()]).toEqual([null, null]); // put down: the port given back
          else if (on === "m" && first !== null) expect([v.port("m"), v.pad()]).toEqual([first, "M · P" + (first + 1)]);
          else if (on === "m") expect(v.notices.slice(notices)).toEqual(["Every port on that machine is taken"]);
          else if (on === "n") {
            // n has seats: sat at its P2; the pad on m (if any) is put down when n's comes into hand
            expect(v.sat).toEqual({ of: "n", seat: "p2" });
            v.frame();
            expect([v.port("n"), v.pad()]).toEqual([1, "N · P2"]);
          } else expect(v.port("m")).toBe(inHand ? first : null);
          // Escape gives back whatever port the pad held on m (n's is its seat's)
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

// Play's way in at a machine with seats, not sitting at it, over everything
// that decides it: who holds each port (the host's), each port's seat as the
// roster has it (free or taken), seats the roster refuses although they read
// free (a race lost), where this view sits now (nowhere, another machine's
// port, the room's table), and whether anything owns seats here at all. P
// sits you at the first port, the preferred (P2) first, that nobody holds,
// whose seat is free and that takes you; the port and pad follow next frame.
// None: it says every port is taken, and nothing changes. No roster: it says
// what's missing.
test("Play sits you at a seated machine's first free port's seat (the preferred first), the port and pad following; every port taken, it says so; no seats package, it says that", () => {
  const SUBSETS = [[], [0], [1], [0, 1]];
  const ELSEWHERE = [null, { of: "n", seat: "p1" }, { of: null, seat: "p1" }];
  let cases = 0;
  for (const roster of ["seats", null, "sitting only"])
    for (const held of SUBSETS)
      for (const taken of SUBSETS)
        for (const refused of SUBSETS)
          for (const sat of ELSEWHERE) {
            const states = Object.fromEntries(taken.map((p) => [`m:p${p + 1}`, "taken"]));
            const v = view({ m: { seats: SEATS, held }, n: { seats: SEATS } }, sat, { states, refuse: refused.map((p) => `m:p${p + 1}`), roster });
            v.frame();
            const before = { n: v.port("n"), pad: v.pad() };
            // the ports Play offers, in order, and the one that takes you
            const offered = [1, 0].filter((p) => !held.includes(p) && !taken.includes(p));
            const takes = offered.find((p) => !refused.includes(p)) ?? null;
            const verb = v.h.verb("m");
            const sits = roster === "seats";
            const want = !sits ? { label: "Play (needs the seats package)", disabled: true, title: "Its seats need the seats package" } : offered.length ? { label: "Play", title: `Sit at P${offered[0] + 1} with its pad` } : { label: "Play (every port is taken)", disabled: true, title: "Every port is taken" };
            expect([roster, held, taken, refused, sat, verb]).toEqual([roster, held, taken, refused, sat, want]);
            v.h.play("m");
            // it asked the roster for each offered port in order, until one took it
            const asked = sits ? offered.slice(0, takes === null ? offered.length : offered.indexOf(takes) + 1).map((p) => `m:p${p + 1}`) : [];
            expect(v.sits).toEqual(asked);
            if (sits && takes !== null) {
              expect([v.sat, v.notices]).toEqual([{ of: "m", seat: `p${takes + 1}` }, []]);
              v.frame();
              // the port follows the seat, its pad in hand; the one held elsewhere given back
              expect([v.port("m"), v.port("n"), v.pad()]).toEqual([takes, null, `M · P${takes + 1}`]);
              // and getting up gives it back, the pad with it
              v.sat = null;
              v.frame();
              expect([v.port("m"), v.pad()]).toEqual([null, null]);
            } else {
              expect(v.notices).toEqual([sits ? "Every port on that machine is taken" : "Its seats need the seats package"]);
              v.frame();
              expect([v.sat, v.port("m"), v.port("n"), v.pad()]).toEqual([sat, null, before.n, before.pad]);
            }
            cases++;
          }
  expect(cases).toBe(3 * 4 * 4 * 4 * 3);
});

// A click on a machine, over everything that decides it: what's clicked (a
// machine with seats, one without, one still starting, the floor, nothing),
// where this view sits (nowhere, at the machine's seat, at a seat of no
// machine's), the pad of the seatless machine in hand or not, who holds that
// one's ports, whether the seated one's seats are taken, whether anything
// owns seats, and whether the stage lets the verb run there (within reach or
// not). `run` is the stage's api.run as it is: it runs Play only where Play's
// state is enabled and within reach, and answers whether it ran.
test("a click is Play while it's the way in (no pad in hand, sitting nowhere): it runs, or says why Play can't; sitting or holding a pad, or out of reach, it goes on", () => {
  const TARGETS_C = ["m", "n", "s", "floor", null];
  const SAT = [null, { of: "m", seat: "p1" }, { of: null, seat: "p1" }];
  const FULLNESS = [[], [1], [0, 1]];
  let cases = 0;
  for (const target of TARGETS_C)
    for (const sat of SAT)
      for (const padOnN of [false, true])
        for (const nHeld of FULLNESS)
          for (const mTaken of [false, true])
            for (const roster of ["seats", null])
              for (const reach of ["within", "beyond"]) {
                if (padOnN && nHeld.length === 2) continue; // no port free on n to take its pad with
                const states = mTaken ? { "m:p1": "taken", "m:p2": "taken" } : {};
                const v = view({ m: { seats: SEATS }, n: { held: nHeld }, s: { seats: SEATS, started: false } }, sat, { states, roster });
                v.frame();
                if (padOnN) v.h.play("n");
                const before = { sat: v.sat, m: v.port("m"), n: v.port("n"), pad: v.pad(), notices: v.notices.length };
                let ran = 0;
                const run = () => {
                  ran++;
                  const st = v.h.verb(target);
                  if (reach !== "within" || !st || st.disabled) return false;
                  v.h.play(target);
                  return true;
                };
                const holding = before.pad !== null;
                const machine = ["m", "n", "s"].includes(target);
                const clicks = machine && !holding && sat === null;
                expect([target, sat, padOnN, v.h.clicks(target)]).toEqual([target, sat, padOnN, clicks]);
                const verb = v.h.verb(target);
                const taken = v.h.click(target, run);
                const said = v.notices.slice(before.notices);
                const label = [target, sat, padOnN, nHeld, mTaken, roster, reach];
                if (!clicks) {
                  // not Play's: the stage isn't asked, and nothing changes
                  expect([label, taken, ran, said, v.sat, v.pad()]).toEqual([label, false, 0, [], before.sat, before.pad]);
                } else if (verb.disabled) {
                  // Play can't, for the machine's own reason: it says that reason, and takes the click
                  expect([label, taken, ran, said, v.sat, v.pad()]).toEqual([label, true, 1, [verb.title], before.sat, before.pad]);
                } else if (reach === "beyond") {
                  // the stage refuses it (too far): the click goes on, nothing said
                  expect([label, taken, ran, said, v.sat, v.pad()]).toEqual([label, false, 1, [], before.sat, before.pad]);
                } else {
                  // Play ran (what it does is the Play tests' above): the click is taken, nothing said
                  expect([label, taken, said]).toEqual([label, true, []]);
                }
                // a machine still starting refuses Play, and says so
                if (clicks && target === "s") expect([label, verb.disabled, verb.title]).toEqual([label, true, "Starting…"]);
                cases++;
              }
  // 5 targets × 3 sittings × (2 × 3 − 1) pad and n's ports × 2 × 2 × 2
  expect(cases).toBe(5 * 3 * 5 * 2 * 2 * 2);
});
