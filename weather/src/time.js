// When the weather is (WEATHER.md, "The data"): a local calendar date and
// clock hour in an IANA time zone, turned into the one instant every peer
// computes the sun at. Pure: the zone's rules come from the runtime's Intl
// time-zone data, the same on every up-to-date browser and node.
//
// A local time names zero, one or two instants. At a fall-back overlap
// (01:30 on 2026-11-01 in Vancouver happens twice) it is the earlier one; in a
// spring-forward gap (02:30 on 2026-03-08 never happens) it is the later one,
// the clock pushed forward by the gap, 03:30 PDT. That is Temporal's and
// JavaScript Date's "compatible" rule, so a time read off any clock lands
// where that clock would put it (Decision 13).

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of a proleptic Gregorian Y-M-D, valid for every year 1..9999 (Date.UTC maps 0..99 to 1900..1999). */
function utcMidnight(y, m, d) {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return t.getTime();
}

/** True for a real calendar date written YYYY-MM-DD, year 1 to 9999. */
export function validDate(date) {
  const m = typeof date === "string" && DATE.exec(date);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const t = new Date(utcMidnight(y, mo, d));
  return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

const formatters = new Map();

function formatter(zone) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      era: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** True for a time zone this runtime's Intl knows (IANA names, and UTC). */
export function validZone(zone) {
  if (typeof zone !== "string" || zone === "") return false;
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** The zone's wall clock at instant t, as if that clock read UTC (ms, whole seconds). */
function wallAt(zone, t) {
  const p = {};
  for (const { type, value } of formatter(zone).formatToParts(t)) p[type] = value;
  const year = p.era === "BC" || p.era === "B" ? 1 - +p.year : +p.year;
  return utcMidnight(year, +p.month, +p.day) + ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000;
}

/** The zone's offset from UTC at instant t, in ms (PDT is -7 h). */
export function offsetAt(zone, t) {
  const whole = t - (((t % 1000) + 1000) % 1000);
  return wallAt(zone, whole) - whole;
}

/**
 * The instant (UTC ms) at which the clock in `zone` reads `hour` on `date`.
 * hour is any finite number of hours after local midnight: 24 is the next
 * day's 00:00, 15.25 is 15:15. Throws RangeError on an invalid date or zone;
 * the weather's params fall back to defaults before they get here.
 */
export function instantOf({ date, hour, zone }) {
  if (!validDate(date)) throw new RangeError(`not a date: ${date}`);
  if (!validZone(zone)) throw new RangeError(`not a time zone: ${zone}`);
  if (!Number.isFinite(hour)) throw new RangeError(`not an hour: ${hour}`);
  const [y, m, d] = date.split("-").map(Number);
  const wall = utcMidnight(y, m, d) + Math.round(hour * HOUR);
  // The offsets in force a day either side bracket any transition at this
  // wall time (no zone changes its offset twice within two days).
  const offsets = [...new Set([offsetAt(zone, wall - DAY), offsetAt(zone, wall + DAY)])];
  const fits = offsets.map((o) => wall - o).filter((t) => offsetAt(zone, t) === wall - t);
  if (fits.length) return Math.min(...fits); // one instant, or the overlap's earlier
  return Math.max(...offsets.map((o) => wall - o)); // the gap: the later instant
}

/** The clock in `zone` at instant t: { date: "YYYY-MM-DD", hour } with hour fractional (inverse of instantOf outside a gap). */
export function localOf(t, zone) {
  const wall = t + offsetAt(zone, t);
  const day = Math.floor(wall / DAY) * DAY;
  const d = new Date(day);
  const y = d.getUTCFullYear();
  const date = `${String(y).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { date, hour: (wall - day) / HOUR };
}
