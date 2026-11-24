// quietClock: the clock stops exactly when nobody holds a port and it runs.
// Every seating of up to two seats on a two-port machine, each seat on port
// 0, 1 or an invalid one, held (no `until`), ended, or ended before it began
// (dropped by seating()), × the clock running or stopped. A seat that
// begins on a port another still holds isn't its holder (session.js).
import { describe, it, expect } from "vitest";
import { quietClock } from "./quiet.js";

const HZ = 35;
const PORTS = 2;
const SEAT = [];
for (const port of [0, 1, 7]) for (const end of ["held", "ended", "never"]) SEAT.push({ port, end });
const seatDoc = ({ port, end }, i) => ({ port, from: 10 * (i + 1), ...(end === "ended" ? { until: 10 * (i + 1) + 70 } : end === "never" ? { until: 10 * (i + 1) } : {}) });

describe("quietClock", () => {
  it("stops the clock where the last seat ended exactly when no valid seat is held and the clock runs", () => {
    let cases = 0;
    const seatings = [[]];
    for (const a of SEAT) seatings.push([a]);
    for (const a of SEAT) for (const b of SEAT) seatings.push([a, b]);
    for (const seats of seatings)
      for (const running of [true, false]) {
        const doc = {
          seats: Object.fromEntries(seats.map((s, i) => [`s${i}`, seatDoc(s, i)])),
          clock: running ? { t: 0, at: 0 } : { t: 0, at: 0, until: 3 },
        };
        // a seat holds its port if it is on a real port, lasts, and doesn't begin while an earlier one there
        // still holds it (session.js seating: the earlier stands); s0 begins before s1
        const valid = (s) => s.port < PORTS && s.end !== "never";
        const holds = (s, i) => valid(s) && s.end === "held" && !(i === 1 && valid(seats[0]) && seats[0].port === s.port);
        const held = seats.some(holds);
        const got = quietClock(doc, PORTS, HZ, 1234);
        if (held || !running) expect(got, JSON.stringify(doc)).toBeNull();
        else {
          const last = Math.max(0, ...Object.values(doc.seats).map((x) => (x.until ?? 0) / HZ));
          expect(got, JSON.stringify(doc)).toEqual({ t: last, at: 1234, until: last });
        }
        cases++;
      }
    expect(cases).toBe(2 * (1 + 9 + 81));
  });

  it("a doc with no seats or clock yet: stopped at 0", () => {
    expect(quietClock({}, PORTS, HZ, 5)).toEqual({ t: 0, at: 5, until: 0 });
    expect(quietClock(null, PORTS, HZ, 5)).toEqual({ t: 0, at: 5, until: 0 });
  });
});
