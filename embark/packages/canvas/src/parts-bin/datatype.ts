import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { PartsBinDoc, PartsBinItem } from "./types";

// Berlin, matching @embark/map's defaults, inlined so the parts bin seeds a
// fresh map without depending on the map feature package.
const DEFAULT_CENTER: [number, number] = [13.388, 52.517];
const DEFAULT_ZOOM = 9.5;

// The behavioral-role features (Place Finder, Weather, Routes) are
// `patchwork:component`s, not documents — the bin seeds them by url so dropping
// one creates a component embed pointing at the shared module rather than a
// minted provider document. The urls are head-less (the service worker redirects
// to the latest heads on load), so a fresh bin always wires up the newest
// published component. Each is `automerge:<package rootUrl>/component.js`,
// encoded the way the worker serves module files.
const componentUrl = (rootUrl: string): string =>
  `/${encodeURIComponent(rootUrl)}/component.js`;

const POI_COMPONENT_URL = componentUrl(
  "automerge:r1gkpehGtt4WTR1pz7mBac9SnJp",
);
const WEATHER_COMPONENT_URL = componentUrl(
  "automerge:2gtsy4b6hU38DQAMPk6kYHLwxrxE",
);
const ROUTE_COMPONENT_URL = componentUrl(
  "automerge:41HBbYkbrqYd9STaojjQUsFc1jDW",
);

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

// The starter set: a search box; the Place Finder, Weather and Routes
// components; a map; the three sticker sources; and a demo markdown note for
// them to annotate. Documents are real docs the bin previews live and hands out
// clones of; the behavioral-role features are components the bin references by
// url. `repo.create` doesn't run a datatype's `init`, so each child doc's
// initial value is set inline here.
export function seedExampleItems(repo: Repo): PartsBinItem[] {
  const search = repo.create({
    "@patchwork": { type: "search" },
    query: "",
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
    { id: crypto.randomUUID(), url: search.url, toolId: "search" },
    {
      id: crypto.randomUUID(),
      componentUrl: POI_COMPONENT_URL,
      label: "Place Finder",
    },
    {
      id: crypto.randomUUID(),
      componentUrl: WEATHER_COMPONENT_URL,
      label: "Weather",
    },
    {
      id: crypto.randomUUID(),
      componentUrl: ROUTE_COMPONENT_URL,
      label: "Routes",
    },
    { id: crypto.randomUUID(), url: map.url, toolId: "map" },
    { id: crypto.randomUUID(), url: colorStyler.url, toolId: "color-styler" },
    {
      id: crypto.randomUUID(),
      url: unitConverter.url,
      toolId: "unit-converter",
    },
    {
      id: crypto.randomUUID(),
      url: currencyConverter.url,
      toolId: "currency-converter",
    },
    { id: crypto.randomUUID(), url: timerSource.url, toolId: "timer-source" },
    { id: crypto.randomUUID(), url: note.url, toolId: "codemirror-base" },
  ];
}
