// One recent sighting, minted per species found. Coordinates live at the TOP
// level (not under `props`) so the canvas's `{ lat, lon }` schema matcher finds
// them directly and the map drops a pin — identical to poi-card. The image and
// learn-more link are resolved once at mint time so the board face and hover
// popup don't each re-fetch.

/**
 * The two swappable madlib choices, persisted on the card document so the
 * phrasing (and the search it drives) survives a reload and syncs to peers.
 * @typedef {"all" | "rare"} BirdKind
 * @typedef {"today" | "week" | "month"} BirdPeriod
 *
 * @typedef {{
 *   "@patchwork": { type: "bird-card", title?: string },
 *   name: string,
 *   sciName: string,
 *   lat: number,
 *   lon: number,
 *   locName?: string,
 *   obsDt?: string,
 *   howMany?: number,
 *   imageUrl?: string,
 *   learnMoreUrl?: string,
 * }} BirdCardDoc
 */

export const BirdCardDatatype = {
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
