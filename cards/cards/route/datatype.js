// A computed trip between two places. The endpoints aren't duplicated — `from`
// and `to` link to poi-cards (their canonical names + coordinates), which the
// board and token faces resolve live. The decoded polyline stays on the card
// (`route`): the schema matcher surfaces it as a "geo line" so the map draws
// the trip.

/**
 * @typedef {{
 *   "@patchwork": { type: "route-card", title?: string },
 *   mode: string,
 *   emoji: string,
 *   from?: string,
 *   to?: string,
 *   distanceKm: number,
 *   duration: number,
 *   route: { lat: number, lon: number }[],
 * }} RouteCardDoc
 *   `duration` is travel time in seconds (what both routers report), named
 *   without a unit suffix so other features (e.g. the schedule card) can read
 *   a generic `duration`.
 */

export const RouteCardDatatype = {
  init(doc) {
    doc["@patchwork"] = { type: "route-card" };
    doc.mode = "";
    doc.emoji = "";
    doc.distanceKm = Number.NaN;
    doc.duration = Number.NaN;
    doc.route = [];
  },
  getTitle(doc) {
    const title = doc["@patchwork"]?.title;
    return typeof title === "string" && title ? title : "Route";
  },
  setTitle(doc, title) {
    doc["@patchwork"].title = title;
  },
};
