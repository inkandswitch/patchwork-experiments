// The session's pure functions, exhaustively over small cases, each against
// an independent statement of what it should be.
import { seating, seatingKey, holder, firstDifference, chunkSpan, unpack, pack, gzip, gunzip } from "./session.js";

const FROMS = [0, 1, 2];
const UNTILS = [undefined, 0, 1, 2, 3];
const ONE = FROMS.flatMap((from) => UNTILS.map((until) => ({ from, until })));

// The declarative statement: the accepted set S is the one where each seat c
// is in S exactly when no seat of S before it, in (from, id) order and on the
// same port, holds the port at c.from. Found by trying every subset; there is
// exactly one.
function accepted(seats) {
  const list = Object.entries(seats).map(([id, s]) => ({ id, ...s, end: s.until ?? Infinity }));
  const before = (a, c) => a.from < c.from || (a.from === c.from && a.id < c.id);
  const fits = [];
  for (let m = 0; m < 1 << list.length; m++) {
    const S = list.filter((_, i) => m & (1 << i));
    const ok = list.every((c) => {
      const blocked = S.some((a) => a !== c && a.port === c.port && before(a, c) && a.from <= c.from && c.from < a.end);
      return S.includes(c) === (c.end > c.from && !blocked);
    });
    if (ok) fits.push(new Set(S.map((s) => s.id)));
  }
  expect(fits.length).toBe(1);
  return fits[0];
}

test("seating: every set of up to three seats on one port, against the declarative statement", () => {
  let cases = 0;
  const ids = ["b", "a", "c"]; // not in order, so the id tiebreak is exercised
  for (let k = 1; k <= 3; k++) {
    const combos = ONE.length ** k;
    for (let m = 0; m < combos; m++) {
      const seats = {};
      for (let i = 0; i < k; i++) seats[ids[i]] = { port: 0, ...ONE[Math.floor(m / ONE.length ** i) % ONE.length] };
      const want = accepted(seats);
      const got = seating(seats, 1)[0];
      expect(new Set(got.map((s) => s.id))).toEqual(want);
      // Accepted seats are disjoint and in order, so each tick has one holder.
      for (let i = 1; i < got.length; i++) expect(got[i].from).toBeGreaterThanOrEqual(got[i - 1].until);
      cases++;
    }
  }
  expect(cases).toBe(15 + 15 ** 2 + 15 ** 3);
});

test("seating: ports are independent, and a seat on a port that does not exist is ignored", () => {
  const seats = { a: { port: 0, from: 0 }, b: { port: 1, from: 0 }, c: { port: 4, from: 0 }, d: { port: 1, from: 2 } };
  const s = seating(seats, 2);
  expect(s[0].map((x) => x.id)).toEqual(["a"]);
  expect(s[1].map((x) => x.id)).toEqual(["b"]);
  expect(seating(undefined, 2)).toEqual([[], []]);
});

test("firstDifference: every pair of seatings of up to two seats on two ports, against tick-by-tick comparison", () => {
  const configs = [];
  for (const a of [null, ...ONE]) for (const b of [null, ...ONE]) {
    const seats = {};
    if (a) seats.x = { port: 0, ...a };
    if (b) seats.y = { port: b.from % 2, ...b };
    configs.push(seating(seats, 2));
  }
  let pairs = 0;
  for (const s of configs)
    for (const r of configs) {
      let want = Infinity;
      for (let t = 0; t < 6 && want === Infinity; t++)
        for (let p = 0; p < 2; p++) if (holder(s, p, t) !== holder(r, p, t)) want = t;
      expect(firstDifference(s, r)).toBe(want);
      pairs++;
    }
  expect(pairs).toBe(256 ** 2);
});

test("seatingKey: equal exactly when the same seat holds every port at every tick before t", () => {
  // The same 256 seatings of two ports as above, every pair, at t = 0..5.
  const configs = [];
  for (const a of [null, ...ONE]) for (const b of [null, ...ONE]) {
    const seats = {};
    if (a) seats.x = { port: 0, ...a };
    if (b) seats.y = { port: b.from % 2, ...b };
    configs.push(seating(seats, 2));
  }
  // Tallied, not one expect per case: 393,216 expects take seconds, which
  // under load is past the test's timeout.
  let cases = 0, equal = 0;
  const wrong = [];
  for (let t = 0; t <= 5; t++) {
    const keys = configs.map((s) => seatingKey(s, t));
    for (let i = 0; i < configs.length; i++)
      for (let j = 0; j < configs.length; j++) {
        let want = true;
        for (let k = 0; k < t && want; k++)
          for (let p = 0; p < 2; p++) if (holder(configs[i], p, k) !== holder(configs[j], p, k)) want = false;
        if ((keys[i] === keys[j]) !== want && wrong.length < 5) wrong.push({ t, i, j, want });
        if (want) equal++;
        cases++;
      }
  }
  expect(wrong).toEqual([]);
  expect(cases).toBe(6 * 256 ** 2);
  expect(equal).toBeGreaterThan(256 * 6);
});

test("chunks: spans clip to the seat, and pack and unpack are inverse", () => {
  expect(chunkSpan(0, 35, { from: 10 })).toEqual([10, 35]);
  expect(chunkSpan(2, 35, { from: 10, until: 80 })).toEqual([70, 80]);
  expect(chunkSpan(1, 35, { from: 0 })).toEqual([35, 70]);
  const map = new Map();
  for (let t = 5; t < 12; t++) map.set(t, new Uint8Array([t, 255 - t]));
  const bytes = pack(map, 5, 12, 2);
  const back = [...unpack(5, bytes, 2)];
  expect(back.map(([t]) => t)).toEqual([5, 6, 7, 8, 9, 10, 11]);
  for (const [t, b] of back) expect([...b]).toEqual([...map.get(t)]);
});

test("gzip round-trips", async () => {
  const b = new Uint8Array(70000).map((_, i) => (i * 7) & 0xff);
  const z = await gzip(b);
  expect(z.length).toBeLessThan(b.length);
  expect(Buffer.compare(await gunzip(z), b)).toBe(0);
});
