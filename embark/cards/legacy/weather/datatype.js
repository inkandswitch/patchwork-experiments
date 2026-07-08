// A day's forecast for a place. The place isn't duplicated here — `place` links
// to a poi-card (the canonical holder of the name and coordinates), which the
// board and token faces resolve live. Only the weather-specific fields live on
// the card itself.

/**
 * @typedef {{
 *   "@patchwork": { type: "weather-card", title?: string },
 *   place?: string,
 *   date: string,
 *   tempMax: number,
 *   tempMin: number,
 *   emoji: string,
 *   summary: string,
 * }} WeatherCardDoc
 */

export const WeatherCardDatatype = {
  init(doc) {
    doc["@patchwork"] = { type: "weather-card" };
    doc.date = "";
    doc.tempMax = Number.NaN;
    doc.tempMin = Number.NaN;
    doc.emoji = "";
    doc.summary = "";
  },
  getTitle(doc) {
    const title = doc["@patchwork"]?.title;
    return typeof title === "string" && title ? title : "Weather";
  },
  setTitle(doc, title) {
    doc["@patchwork"].title = title;
  },
};
