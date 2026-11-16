// When the weather is (time.js): a local date and clock hour in an IANA zone
// to the one instant, DST-correct (a fall-back overlap takes the earlier
// instant; every hour of a spring-forward gap is the transition instant), and
// back. Finite tables: named instants; every quarter hour of a summer day, a
// spring-forward day and a fall-back day in Vancouver, round-tripped; and
// every quarter hour around every transition of a year in eight zones, where
// instantOf is non-decreasing and every hour either round-trips or lies in a
// gap.
import { describe, expect, it } from "vitest";
import { instantOf, localOf, offsetAt, validDate, validZone } from "./time.js";

const VAN = "America/Vancouver";
const HOUR = 3_600_000;
const iso = (t) => new Date(t).toISOString();

describe("instantOf", () => {
  it.each([
    ["PDT: 15:00 on 15 July (the default)", "2026-07-15", 15, VAN, "2026-07-15T22:00:00.000Z"],
    ["PST: 15:00 on 15 January", "2026-01-15", 15, VAN, "2026-01-15T23:00:00.000Z"],
    ["the spring-forward gap: 02:30 on 8 March is the transition, 10:00Z", "2026-03-08", 2.5, VAN, "2026-03-08T10:00:00.000Z"],
    ["the gap's start: 02:00 is the transition", "2026-03-08", 2, VAN, "2026-03-08T10:00:00.000Z"],
    ["the gap's last quarter: 02:45 is the transition", "2026-03-08", 2.75, VAN, "2026-03-08T10:00:00.000Z"],
    ["a gap hour with milliseconds is the transition, to the millisecond", "2026-03-08", 2.5 + 0.0001 / 3600, VAN, "2026-03-08T10:00:00.000Z"],
    ["just after the gap: 03:00 PDT", "2026-03-08", 3, VAN, "2026-03-08T10:00:00.000Z"],
    ["just before the gap: 01:45 PST", "2026-03-08", 1.75, VAN, "2026-03-08T09:45:00.000Z"],
    ["the fall-back overlap: 01:30 on 1 November is the first, 01:30 PDT", "2026-11-01", 1.5, VAN, "2026-11-01T08:30:00.000Z"],
    ["the overlap's start: 01:00 PDT", "2026-11-01", 1, VAN, "2026-11-01T08:00:00.000Z"],
    ["after the overlap: 02:00 PST", "2026-11-01", 2, VAN, "2026-11-01T10:00:00.000Z"],
    ["UTC", "2026-07-15", 15, "UTC", "2026-07-15T15:00:00.000Z"],
    ["hour 24 is the next day's 00:00", "2026-07-15", 24, VAN, "2026-07-16T07:00:00.000Z"],
    ["hour 24 at the year's end", "2026-12-31", 24, "UTC", "2027-01-01T00:00:00.000Z"],
    ["hour 15.25 is 15:15", "2026-07-15", 15.25, VAN, "2026-07-15T22:15:00.000Z"],
    ["hour 0 is local midnight", "2026-07-15", 0, VAN, "2026-07-15T07:00:00.000Z"],
    ["a half-hour zone: Kolkata, +5:30", "2026-07-15", 12, "Asia/Kolkata", "2026-07-15T06:30:00.000Z"],
    ["a quarter-hour zone across the date line: Chatham, +12:45 in July", "2026-07-15", 12, "Pacific/Chatham", "2026-07-14T23:15:00.000Z"],
    ["the south's fall-back overlap: Sydney 02:30 on 5 April is 02:30 AEDT", "2026-04-05", 2.5, "Australia/Sydney", "2026-04-04T15:30:00.000Z"],
    ["the south's spring-forward gap: Sydney 02:30 on 4 October is the transition, 02:00 AEST", "2026-10-04", 2.5, "Australia/Sydney", "2026-10-03T16:00:00.000Z"],
    ["a half-hour gap: Lord Howe 02:15 on 4 October is the transition, 02:00 +10:30", "2026-10-04", 2.25, "Australia/Lord_Howe", "2026-10-03T15:30:00.000Z"],
    ["a whole day gap: Apia skipped 30 December 2011; its noon is the transition, 24:00 on the 29th at -10", "2011-12-30", 12, "Pacific/Apia", "2011-12-30T10:00:00.000Z"],
    ["the archive's first year: Ucluelet in 1940, PST", "1940-01-15", 12, VAN, "1940-01-15T20:00:00.000Z"],
    ["a year below 100 is not 19xx", "0050-06-01", 0, "UTC", "0050-06-01T00:00:00.000Z"],
  ])("%s", (_, date, hour, zone, want) => expect(iso(instantOf({ date, hour, zone }))).toBe(want));

  it.each([
    ["a malformed date", { date: "2026-7-15", hour: 15, zone: VAN }],
    ["an impossible date", { date: "2026-02-30", hour: 15, zone: VAN }],
    ["an unknown zone", { date: "2026-07-15", hour: 15, zone: "Mars/Olympus" }],
    ["an empty zone", { date: "2026-07-15", hour: 15, zone: "" }],
    ["a missing hour", { date: "2026-07-15", zone: VAN }],
    ["a NaN hour", { date: "2026-07-15", hour: NaN, zone: VAN }],
  ])("throws RangeError on %s (the params fall back before calling)", (_, args) => {
    expect(() => instantOf(args)).toThrow(RangeError);
  });
});

describe("every quarter hour, round-tripped through localOf", () => {
  // A summer day: 97 quarter hours, each its own instant, evenly spaced.
  it("15 July in Vancouver: instantOf is hour · 1 h after midnight, and localOf inverts it", () => {
    const midnight = instantOf({ date: "2026-07-15", hour: 0, zone: VAN });
    for (let q = 0; q < 96; q++) {
      const t = instantOf({ date: "2026-07-15", hour: q / 4, zone: VAN });
      expect(t - midnight).toBe((q / 4) * HOUR);
      expect(localOf(t, VAN)).toEqual({ date: "2026-07-15", hour: q / 4 });
    }
    expect(localOf(instantOf({ date: "2026-07-15", hour: 24, zone: VAN }), VAN)).toEqual({ date: "2026-07-16", hour: 0 });
  });

  it("8 March (spring forward): every hour outside [2, 3) round-trips; inside it is the transition, which reads 03:00", () => {
    for (let q = 0; q < 96; q++) {
      const hour = q / 4;
      const back = localOf(instantOf({ date: "2026-03-08", hour, zone: VAN }), VAN);
      expect(back).toEqual({ date: "2026-03-08", hour: hour >= 2 && hour < 3 ? 3 : hour });
    }
  });

  it("1 November (fall back): every hour round-trips, and [1, 2) is PDT, the earlier pass", () => {
    for (let q = 0; q < 96; q++) {
      const hour = q / 4;
      const t = instantOf({ date: "2026-11-01", hour, zone: VAN });
      expect(localOf(t, VAN)).toEqual({ date: "2026-11-01", hour });
      expect(offsetAt(VAN, t)).toBe(hour < 2 ? -7 * HOUR : -8 * HOUR);
    }
  });
});

describe("every quarter hour around every transition of a year: instantOf never goes backwards, and an hour either round-trips or lies in a gap", () => {
  // The hour is the sun slider, so this is "the slider never moves the sun
  // backwards". Away from a transition the offset is constant and instantOf
  // is wall - offset, increasing by construction; so the table walks every
  // quarter hour of the local days around each UTC day the offset changes in
  // (found by scanning offsetAt day by day). Zones: Vancouver (the default),
  // Sydney (the south), Lord Howe (a 30-minute DST), Santiago and Havana
  // (transitions at local midnight), Kolkata (none), Chatham (+12:45/+13:45)
  // and Apia's 2011 (an hour in September, then a whole day skipped). The
  // last columns count the transitions and the quarter hours inside a gap: 4
  // for an hour's jump, 2 for Lord Howe's half hour, 96 for Apia's day.
  const DAY = 24 * HOUR;
  const date = (t) => new Date(t).toISOString().slice(0, 10);
  it.each([
    [VAN, 2026, 2, 4],
    ["Australia/Sydney", 2026, 2, 4],
    ["Australia/Lord_Howe", 2026, 2, 2],
    ["America/Santiago", 2026, 2, 4],
    ["America/Havana", 2026, 2, 4],
    ["Asia/Kolkata", 2026, 0, 0],
    ["Pacific/Chatham", 2026, 2, 4],
    ["Pacific/Apia", 2011, 3, 4 + 96],
  ])("%s, %i: %i transitions, %i quarter hours in a gap", (zone, year, transitions, gapQuarters) => {
    const changes = [];
    for (let day = Date.UTC(year, 0, 1); day < Date.UTC(year + 1, 0, 1); day += DAY) {
      if (offsetAt(zone, day) !== offsetAt(zone, day + DAY)) changes.push(day);
    }
    expect(changes.length).toBe(transitions);
    let gaps = 0;
    for (const change of changes) {
      let prev = -Infinity;
      for (let day = change - DAY; day <= change + 2 * DAY; day += DAY) {
        for (let q = 0; q < 96; q++) {
          const x = { date: date(day), hour: q / 4 };
          const t = instantOf({ ...x, zone });
          expect(t, `${x.date} ${x.hour}`).toBeGreaterThanOrEqual(prev);
          prev = t;
          const back = localOf(t, zone);
          if (back.date === x.date && back.hour === x.hour) continue;
          // Not a round trip: then t is a forward transition, and x is a wall
          // time inside the gap it opens, [T + before, T + after).
          gaps++;
          const before = offsetAt(zone, t - 1000);
          const after = offsetAt(zone, t);
          expect(after, `${x.date} ${x.hour}`).toBeGreaterThan(before);
          const wall = day + x.hour * HOUR;
          expect(wall).toBeGreaterThanOrEqual(t + before);
          expect(wall).toBeLessThan(t + after);
        }
      }
    }
    expect(gaps).toBe(gapQuarters);
  });
});

describe("localOf", () => {
  it.each([
    ["1940, PST: the archive's first year, before the epoch", "1940-01-15", 12],
    ["1969-12-31 23:45, the epoch's last quarter before", "1969-12-31", 23.75],
    ["year 1, 03:00, local mean time", "0001-01-01", 3],
  ])("%s round-trips", (_, date, hour) => {
    expect(localOf(instantOf({ date, hour, zone: VAN }), VAN)).toEqual({ date, hour });
  });
  it("east of Greenwich, year 1's first midnight is an instant in UTC's year 0, and round-trips", () => {
    const t = instantOf({ date: "0001-01-01", hour: 0, zone: "Asia/Kolkata" });
    expect(new Date(t).getUTCFullYear()).toBe(0);
    expect(localOf(t, "Asia/Kolkata")).toEqual({ date: "0001-01-01", hour: 0 });
  });
});

describe("offsetAt", () => {
  it.each([
    ["PDT", Date.UTC(2026, 6, 15, 22), VAN, -7 * 3600],
    ["PST", Date.UTC(2026, 0, 15, 23), VAN, -8 * 3600],
    ["Vancouver's local mean time before 1884, -8:12:28", Date.UTC(1880, 0, 1), VAN, -(8 * 3600 + 12 * 60 + 28)],
    ["UTC", Date.UTC(2026, 6, 15), "UTC", 0],
    ["Kolkata", Date.UTC(2026, 6, 15), "Asia/Kolkata", 5.5 * 3600],
    ["1 BC, which the formatter writes as year 1 of era BC: local mean time", new Date(0).setUTCFullYear(0, 6, 1), VAN, -(8 * 3600 + 12 * 60 + 28)],
  ])("%s", (_, t, zone, seconds) => expect(offsetAt(zone, t)).toBe(seconds * 1000));
  it("ignores the instant's milliseconds", () => {
    expect(offsetAt(VAN, Date.UTC(2026, 6, 15, 22) + 999)).toBe(-7 * HOUR);
    expect(offsetAt(VAN, Date.UTC(2026, 6, 15, 22) - 1)).toBe(-7 * HOUR);
  });
});

describe("validDate", () => {
  it.each([
    ["2026-07-15", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["1900-02-29", false],
    ["2000-02-29", true],
    ["2026-04-31", false],
    ["2026-7-15", false],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["2026-07-00", false],
    ["0000-01-01", false],
    ["0001-01-01", true],
    ["9999-12-31", true],
    ["2026-07-15T00:00", false],
    [" 2026-07-15", false],
    ["", false],
    [20260715, false],
    [null, false],
    [undefined, false],
  ])("%j → %s", (date, ok) => expect(validDate(date)).toBe(ok));
});

describe("validZone: IANA names only, so every peer agrees (Decision 15)", () => {
  it.each([
    ["America/Vancouver", true],
    ["UTC", true],
    ["Etc/GMT+8", true],
    ["Australia/Sydney", true],
    ["America/Argentina/Buenos_Aires", true],
    ["America/Port-au-Prince", true],
    ["EST5EDT", true],
    ["america/vancouver", true],
    ["Canada/Pacific", true],
    ["US/Pacific", true],
    ["+05:30", false],
    ["-08:00", false],
    ["+0530", false],
    ["\u221208:00", false],
    ["GMT+8", false],
    ["America//Vancouver", false],
    ["/America/Vancouver", false],
    ["Mars/Olympus", false],
    ["America/Vancouver ", false],
    ["", false],
    [null, false],
    [undefined, false],
    [7, false],
  ])("%j → %s", (zone, ok) => expect(validZone(zone)).toBe(ok));
});
