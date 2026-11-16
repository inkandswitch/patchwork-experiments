// When the weather is (time.js): a date and clock hour on a clock `offset`
// hours from UTC to the one instant, and back. Arithmetic, so no time-zone
// data: finite tables of named instants, the throws, and every quarter hour
// of four dates on every quarter-hour clock from UTC-12 to UTC+14,
// round-tripped, with the instant exactly hour · 1 h after the clock's
// midnight (so increasing in the hour: the slider never moves the sun
// backwards). And the proof that nothing here reads the runtime's zone
// data: with Intl gone, every answer is the same.
import { afterEach, describe, expect, it, vi } from "vitest";
import { instantOf, localOf, validDate } from "./time.js";

const HOUR = 3_600_000;
const iso = (t) => new Date(t).toISOString();

describe("instantOf", () => {
  it.each([
    ["PDT: 15:00 on 15 July (the default)", "2026-07-15", 15, -7, "2026-07-15T22:00:00.000Z"],
    ["PST: 15:00 on 15 January", "2026-01-15", 15, -8, "2026-01-15T23:00:00.000Z"],
    ["British Columbia's winter from November 2026, still UTC-7", "2026-12-15", 15, -7, "2026-12-15T22:00:00.000Z"],
    ["UTC", "2026-07-15", 15, 0, "2026-07-15T15:00:00.000Z"],
    ["hour 24 is the next day's 00:00", "2026-07-15", 24, -7, "2026-07-16T07:00:00.000Z"],
    ["hour 24 at the year's end", "2026-12-31", 24, 0, "2027-01-01T00:00:00.000Z"],
    ["hour 15.25 is 15:15", "2026-07-15", 15.25, -7, "2026-07-15T22:15:00.000Z"],
    ["hour 0 is the clock's midnight", "2026-07-15", 0, -7, "2026-07-15T07:00:00.000Z"],
    ["a half-hour clock: Kolkata, +5:30", "2026-07-15", 12, 5.5, "2026-07-15T06:30:00.000Z"],
    ["a quarter-hour clock: Nepal, +5:45", "2026-07-15", 12, 5.75, "2026-07-15T06:15:00.000Z"],
    ["across the date line: Chatham, +12:45", "2026-07-15", 12, 12.75, "2026-07-14T23:15:00.000Z"],
    ["the east end: Kiribati, +14", "2026-07-15", 0, 14, "2026-07-14T10:00:00.000Z"],
    ["the west end: -12", "2026-07-15", 0, -12, "2026-07-15T12:00:00.000Z"],
    ["the archive's first year: Ucluelet in 1940, PST", "1940-01-15", 12, -8, "1940-01-15T20:00:00.000Z"],
    ["a year below 100 is not 19xx", "0050-06-01", 0, 0, "0050-06-01T00:00:00.000Z"],
    ["an hour with a fraction of a millisecond rounds to the nearest whole one", "2026-07-15", 15 + 0.6 / HOUR, 0, "2026-07-15T15:00:00.001Z"],
  ])("%s", (_, date, hour, offset, want) => expect(iso(instantOf({ date, hour, offset }))).toBe(want));

  it.each([
    ["a malformed date", { date: "2026-7-15", hour: 15, offset: -7 }],
    ["an impossible date", { date: "2026-02-30", hour: 15, offset: -7 }],
    ["a missing hour", { date: "2026-07-15", offset: -7 }],
    ["a NaN hour", { date: "2026-07-15", hour: NaN, offset: -7 }],
    ["a missing offset", { date: "2026-07-15", hour: 15 }],
    ["an infinite offset", { date: "2026-07-15", hour: 15, offset: Infinity }],
    ["an offset as a string", { date: "2026-07-15", hour: 15, offset: "-7" }],
  ])("throws RangeError on %s (the params fall back before calling)", (_, args) => {
    expect(() => instantOf(args)).toThrow(RangeError);
  });
});

describe("every quarter hour on every quarter-hour clock, round-tripped through localOf", () => {
  const OFFSETS = Array.from({ length: 105 }, (_, i) => -12 + i / 4);
  it.each(["2026-07-15", "2026-03-08", "2026-11-01", "1940-01-15"])("%s: the instant is hour · 1 h after the clock's midnight, and localOf inverts it", (date) => {
    expect(OFFSETS[0]).toBe(-12);
    expect(OFFSETS.at(-1)).toBe(14);
    for (const offset of OFFSETS) {
      const midnight = instantOf({ date, hour: 0, offset });
      expect(midnight).toBe(Date.parse(`${date}T00:00:00Z`) - offset * HOUR);
      for (let q = 0; q < 96; q++) {
        const t = instantOf({ date, hour: q / 4, offset });
        expect(t - midnight).toBe((q / 4) * HOUR);
        expect(localOf(t, offset)).toEqual({ date, hour: q / 4 });
      }
      const next = localOf(instantOf({ date, hour: 24, offset }), offset);
      expect(next.hour).toBe(0);
      expect(Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)).toBe(24 * HOUR);
    }
  });
});

describe("localOf", () => {
  it.each([
    ["1940, PST: the archive's first year, before the epoch", "1940-01-15", 12, -8],
    ["1969-12-31 23:45, the epoch's last quarter before", "1969-12-31", 23.75, -8],
    ["year 1, 03:00", "0001-01-01", 3, -8],
  ])("%s round-trips", (_, date, hour, offset) => {
    expect(localOf(instantOf({ date, hour, offset }), offset)).toEqual({ date, hour });
  });
  it("east of Greenwich, year 1's first midnight is an instant in UTC's year 0, and round-trips", () => {
    const t = instantOf({ date: "0001-01-01", hour: 0, offset: 5.5 });
    expect(new Date(t).getUTCFullYear()).toBe(0);
    expect(localOf(t, 5.5)).toEqual({ date: "0001-01-01", hour: 0 });
  });
  it("keeps an instant's seconds and milliseconds as a fraction of the hour", () => {
    expect(localOf(Date.parse("2026-07-15T22:07:30.500Z"), -7)).toEqual({ date: "2026-07-15", hour: 15 + 450.5 / 3600 });
  });
});

describe("no time-zone data: with Intl gone, every answer is the same", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("instantOf and localOf over the named rows and a sweep of clocks", () => {
    const rows = [];
    for (const date of ["2026-07-15", "2026-11-01", "2026-12-15", "0001-01-01"])
      for (const offset of [-12, -8, -7, 0, 5.5, 5.75, 12.75, 14]) for (const hour of [0, 1.5, 15, 23.75, 24]) rows.push({ date, hour, offset });
    const want = rows.map((r) => [instantOf(r), localOf(instantOf(r), r.offset)]);
    vi.stubGlobal("Intl", undefined);
    expect(globalThis.Intl).toBe(undefined);
    expect(rows.map((r) => [instantOf(r), localOf(instantOf(r), r.offset)])).toEqual(want);
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
