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
// published component. The package folder doc mirrors the package directory, and
// the build output lives under `dist/`, so the component file is served at
// `automerge:<package rootUrl>/dist/component.js` (this raw module path bypasses
// package.json `exports`, so it must spell out `dist/`).
const componentUrl = (rootUrl: string): string =>
  `/${encodeURIComponent(rootUrl)}/dist/component.js`;

const POI_COMPONENT_URL = componentUrl(
  "automerge:r1gkpehGtt4WTR1pz7mBac9SnJp",
);
const WEATHER_COMPONENT_URL = componentUrl(
  "automerge:2gtsy4b6hU38DQAMPk6kYHLwxrxE",
);
const ROUTE_COMPONENT_URL = componentUrl(
  "automerge:41HBbYkbrqYd9STaojjQUsFc1jDW",
);
const UNIT_COMPONENT_URL = componentUrl(
  "automerge:2YXL4FwZ7crmDpgcm2FobPGpQyE7",
);
const CURRENCY_COMPONENT_URL = componentUrl(
  "automerge:27NZacXx1DQVusdWaNS9US9t5spB",
);
const TIMER_COMPONENT_URL = componentUrl(
  "automerge:3wGbMYtuZ7EtBvDsbuwRBcP6v7P2",
);
const SCHEDULE_COMPONENT_URL = componentUrl(
  "automerge:3jBqTXqoHp8pyXeUZKbXcJch7qxm",
);

// A sample note exercising every sticker source at once: imperial quantities
// (unit converter), a foreign amount (currency converter), a timer token, and a
// running schedule of times + durations (schedule card).
const DEMO_MARKDOWN = `# Trip notes

The route is about 5 miles along the ridge trail.
Take a break partway: @timer 5m

Bring 10 lb of gear; the permit costs €20.

Morning plan:
- start at 8:00
- pack the car for 30 minutes
- drive to the trailhead for 1 hour
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

// The starter set: the Place Finder, Weather and Routes components; a map; the
// four sticker-source components (Unit/Currency/Timer/Schedule); and a demo
// markdown note for them to annotate. Documents are real docs the bin previews
// live and hands out clones of; the behavioral-role features are components the
// bin references by url. `repo.create` doesn't run a datatype's `init`, so each
// child doc's initial value is set inline here.
export function seedExampleItems(repo: Repo): PartsBinItem[] {
  const map = repo.create({
    "@patchwork": { type: "map" },
    center: [...DEFAULT_CENTER],
    zoom: DEFAULT_ZOOM,
  });
  const note = repo.create({
    "@patchwork": { type: "markdown" },
    content: DEMO_MARKDOWN,
  });
  // A fresh, empty deck. Dragging the example out clones it, so each canvas
  // starts its own pile; cards are added by dragging embeds into it.
  const deck = repo.create({
    "@patchwork": { type: "deck" },
    title: "Deck",
    fanned: false,
    cards: [],
  });

  return [
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
    {
      id: crypto.randomUUID(),
      componentUrl: UNIT_COMPONENT_URL,
      label: "Unit Converter",
    },
    {
      id: crypto.randomUUID(),
      componentUrl: CURRENCY_COMPONENT_URL,
      label: "Currency Converter",
    },
    {
      id: crypto.randomUUID(),
      componentUrl: TIMER_COMPONENT_URL,
      label: "Timer",
    },
    {
      id: crypto.randomUUID(),
      componentUrl: SCHEDULE_COMPONENT_URL,
      label: "Schedule",
    },
    { id: crypto.randomUUID(), url: note.url, toolId: "codemirror-base" },
    { id: crypto.randomUUID(), url: deck.url, toolId: "deck" },
  ];
}
