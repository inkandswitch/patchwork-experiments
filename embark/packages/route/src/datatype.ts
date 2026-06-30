import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// A computed trip between two places. The endpoints aren't duplicated — `from`
// and `to` link to poi-cards (their canonical names + coordinates), which the
// board and token faces resolve live. The decoded polyline stays on the card
// (`route`): the canvas schema resolver surfaces it as a "geo line" so the map
// draws the trip.
export type RouteCardDoc = {
  "@patchwork": { type: "route-card"; title?: string };
  mode: string;
  emoji: string;
  from?: AutomergeUrl;
  to?: AutomergeUrl;
  distanceKm: number;
  // Travel time in seconds (Valhalla's unit). Named without a unit suffix so
  // other features (e.g. the schedule card) can read a generic `duration`.
  duration: number;
  route: { lat: number; lon: number }[];
};

export const RouteCardDatatype: DatatypeImplementation<RouteCardDoc> = {
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
