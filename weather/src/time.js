// When the weather is (WEATHER.md, "The data"): a calendar date and a clock
// hour on a clock `offset` hours from UTC, turned into the one instant every
// peer computes the sun at. Pure arithmetic: no time-zone data, so no two
// peers can read the same doc as different instants (Decision 15). Every
// clock reading names exactly one instant, so there is no gap and no
// overlap, and the instant is increasing in the hour.

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

/**
 * The instant (UTC ms, whole) at which a clock `offset` hours from UTC
 * reads `hour` on `date`: the date's midnight UTC + hour - offset. hour is
 * hours after the clock's midnight (24 is the next day's 00:00, 15.25 is
 * 15:15). Throws RangeError on an invalid date, or an hour or offset that
 * isn't finite; the weather's params fall back to defaults before they get
 * here.
 */
export function instantOf({ date, hour, offset }) {
  if (!validDate(date)) throw new RangeError(`not a date: ${date}`);
  if (!Number.isFinite(hour)) throw new RangeError(`not an hour: ${hour}`);
  if (!Number.isFinite(offset)) throw new RangeError(`not an offset: ${offset}`);
  const [y, m, d] = date.split("-").map(Number);
  return utcMidnight(y, m, d) + Math.round((hour - offset) * HOUR);
}

/**
 * The clock `offset` hours from UTC at instant t: { date: "YYYY-MM-DD",
 * hour } with 0 <= hour < 24, fractional. The inverse of instantOf.
 */
export function localOf(t, offset) {
  const wall = t + Math.round(offset * HOUR);
  const day = Math.floor(wall / DAY) * DAY;
  const d = new Date(day);
  const y = d.getUTCFullYear();
  const date = `${String(y).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { date, hour: (wall - day) / HOUR };
}
