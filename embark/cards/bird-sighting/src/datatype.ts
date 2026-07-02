import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// The two swappable madlib choices, persisted on the card document so the
// phrasing (and the search it drives) survives a reload and syncs to peers.
export type BirdKind = "all" | "rare";
export type BirdPeriod = "today" | "week" | "month";

// One recent sighting, minted per species found. Coordinates live at the TOP
// level (not under `props`) so the canvas's `{ lat, lon }` schema matcher finds
// them directly and the map drops a pin — identical to poi-card. The image and
// learn-more link are resolved once at mint time so the board face and hover
// popup don't each re-fetch.
export type BirdCardDoc = {
  "@patchwork": { type: "bird-card"; title?: string };
  name: string;
  sciName: string;
  lat: number;
  lon: number;
  locName?: string;
  obsDt?: string;
  howMany?: number;
  imageUrl?: string;
  learnMoreUrl?: string;
};

export const BirdCardDatatype: DatatypeImplementation<BirdCardDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "bird-card" };
    doc.name = "";
    doc.sciName = "";
    doc.lat = 0;
    doc.lon = 0;
  },
  getTitle(doc) {
    const title = doc["@patchwork"]?.title;
    if (typeof title === "string" && title) return title;
    return doc.name || "Bird";
  },
  setTitle(doc, title) {
    doc["@patchwork"].title = title;
  },
};
