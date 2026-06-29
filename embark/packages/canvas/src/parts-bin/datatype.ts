import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { PartsBinDoc, PartsBinItem } from "./types";

// Berlin, matching @embark/map's defaults, inlined so the parts bin seeds a
// fresh map without depending on the map feature package.
const DEFAULT_CENTER: [number, number] = [13.388, 52.517];
const DEFAULT_ZOOM = 9.5;

// A sample note exercising every sticker source at once: a named color and a
// hex color (styler), imperial quantities (unit converter), a foreign amount
// (currency converter), and a timer token.
const DEMO_MARKDOWN = `# Trip notes

The route is about 5 miles along a red trail.
Take a break partway: @timer 5m

Bring 10 lb of gear; the permit costs €20.
The summit hut is painted #2f80ed.
`;

export const PartsBinDatatype: DatatypeImplementation<PartsBinDoc> = {
  init(doc, repo) {
    doc["@patchwork"] = { type: "parts-bin" };
    doc.title = "Parts bin";
    doc.items = seedExampleItems(repo);
  },
  getTitle(doc) {
    return doc.title || "Parts bin";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};

// The starter set: a search box, a POI provider, a map, the three sticker
// sources, and a demo markdown note for them to annotate. Each is a real
// document; the bin previews them live and hands out clones on drag.
// `repo.create` doesn't run a datatype's `init`, so each child doc's initial
// value is set inline here.
function seedExampleItems(repo: Repo): PartsBinItem[] {
  const search = repo.create({
    "@patchwork": { type: "search" },
    query: "",
  });
  const poi = repo.create({
    "@patchwork": { type: "poi-provider" },
  });
  const weather = repo.create({
    "@patchwork": { type: "weather-provider" },
  });
  const map = repo.create({
    "@patchwork": { type: "map" },
    center: [...DEFAULT_CENTER],
    zoom: DEFAULT_ZOOM,
  });
  const colorStyler = repo.create({
    "@patchwork": { type: "color-styler" },
  });
  const unitConverter = repo.create({
    "@patchwork": { type: "unit-converter" },
  });
  const currencyConverter = repo.create({
    "@patchwork": { type: "currency-converter" },
  });
  const timerSource = repo.create({
    "@patchwork": { type: "timer-source" },
  });
  const note = repo.create({
    "@patchwork": { type: "markdown" },
    content: DEMO_MARKDOWN,
  });

  return [
    { url: search.url, toolId: "search" },
    { url: poi.url, toolId: "poi-provider" },
    { url: weather.url, toolId: "weather-provider" },
    { url: map.url, toolId: "map" },
    { url: colorStyler.url, toolId: "color-styler" },
    { url: unitConverter.url, toolId: "unit-converter" },
    { url: currencyConverter.url, toolId: "currency-converter" },
    { url: timerSource.url, toolId: "timer-source" },
    { url: note.url, toolId: "codemirror-base" },
  ];
}
