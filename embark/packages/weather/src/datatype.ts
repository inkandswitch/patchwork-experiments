import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// A day's forecast for a place. The place isn't duplicated here — `place` links
// to a poi-card (the canonical holder of the name and coordinates), which the
// board and token faces resolve live. Only the weather-specific fields live on
// the card itself.
export type WeatherCardDoc = {
  "@patchwork": { type: "weather-card"; title?: string };
  place?: AutomergeUrl;
  date: string;
  tempMax: number;
  tempMin: number;
  emoji: string;
  summary: string;
};

export const WeatherCardDatatype: DatatypeImplementation<WeatherCardDoc> = {
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
