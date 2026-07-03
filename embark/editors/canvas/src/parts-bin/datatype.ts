import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { CardDoc } from "@embark/card";
import type { PartsBinDoc, PartsBinItem } from "./types";

// Berlin, matching @embark/map's defaults, inlined so the parts bin seeds a
// fresh map without depending on the map feature package.
const DEFAULT_CENTER: [number, number] = [13.388, 52.517];
const DEFAULT_ZOOM = 9.5;

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

// Every card in the bin is one `card` document (see @embark/card): it names the
// behavior module it loads and carries the chrome the shell draws around it.
// This one table is the whole card catalog — a uniform row per card, minted into
// an identical document shape. Because each row is a real document the bin hands
// out clones of, formerly handle-less cards (weather, timer, …) now get their
// own per-instance state when dragged out.
type CardSeed = {
  // The card feature package's head-less rootUrl. The service worker redirects
  // it to the latest heads, so a fresh bin always loads the newest published
  // `dist/card.js`.
  rootUrl: string;
  title: string;
  description: string;
  // A glyph name in the card icon registry (see @embark/card icons), drawn as
  // the mirrored corner pips.
  icon: string;
  accent: string;
  // Extra persisted fields the card's module reads off its own document (e.g.
  // the bird card's madlib choices).
  state?: Record<string, unknown>;
};

const CARD_SEEDS: CardSeed[] = [
  // Debug pair (see @embark/context-reader / @embark/context-writer): drop the
  // Writer on the context sidebar and a Reader on a normal canvas (or vice
  // versa) to observe, in the console and each card's face, which store each
  // lands on and whether a write on one is visible to a read on the other.
  {
    rootUrl: "automerge:2X9ez2i9PUiiBWMCPzqqFc2xG1Af",
    title: "Context Reader (debug)",
    description:
      "Logs the context store it lands on and every channel's merged value. Watch the console for [ctx-reader].",
    icon: "at",
    accent: "#2563eb",
  },
  {
    rootUrl: "automerge:3ESd7vZNGbYghq6KyixNduTZmLGh",
    title: "Context Writer (debug)",
    description:
      "Writes a heartbeat mark into the debug:context channel of its store. Watch the console for [ctx-writer].",
    icon: "clock",
    accent: "#dc2626",
  },
  {
    rootUrl: "automerge:r1gkpehGtt4WTR1pz7mBac9SnJp",
    title: "Place Finder",
    description:
      "Answers place searches on the canvas, dropping a pin per result.",
    icon: "pin",
    accent: "#0ea5e9",
  },
  {
    rootUrl: "automerge:2gtsy4b6hU38DQAMPk6kYHLwxrxE",
    title: "Weather",
    description:
      "Type /weather to add today's forecast for a place. Data from Open-Meteo.",
    icon: "sun",
    accent: "#f59e0b",
  },
  {
    rootUrl: "automerge:41HBbYkbrqYd9STaojjQUsFc1jDW",
    title: "Routes",
    description:
      "Type /Drive, /Walk, or /Transit to route between two places. Data from OSRM.",
    icon: "route",
    accent: "#8b5cf6",
  },
  {
    rootUrl: "automerge:2qhWc5S2pg83z2xutpiCkafYkdSN",
    title: "Mention Finder",
    description: "Answers @mention searches with matching documents.",
    icon: "at",
    accent: "#6366f1",
  },
  {
    rootUrl: "automerge:2nay83Kjg393HEaXwerXpHMnDDWw",
    title: "Bird Sightings",
    description:
      "Watches a map and asks eBird what's been seen there, minting a pin per species.",
    icon: "bird",
    accent: "#16a34a",
    state: { kind: "all", period: "week" },
  },
  {
    rootUrl: "automerge:2YXL4FwZ7crmDpgcm2FobPGpQyE7",
    title: "Convert to metric",
    description:
      "Scans text and annotates imperial quantities with their metric equivalents.",
    icon: "ruler",
    accent: "#0d9488",
  },
  {
    rootUrl: "automerge:2otX5sW1C3cozUnmGiKZKviSHAaQ",
    title: "Convert to imperial",
    description:
      "Scans text and annotates metric quantities with their imperial equivalents.",
    icon: "ruler",
    accent: "#0d9488",
  },
  {
    rootUrl: "automerge:27NZacXx1DQVusdWaNS9US9t5spB",
    title: "Currency Converter",
    description:
      "Annotates foreign amounts with their converted value at today's rate.",
    icon: "dollar",
    accent: "#059669",
  },
  {
    rootUrl: "automerge:3wGbMYtuZ7EtBvDsbuwRBcP6v7P2",
    title: "Timer",
    description: "Turns @timer tokens into a live countdown.",
    icon: "clock",
    accent: "#dc2626",
  },
  {
    rootUrl: "automerge:3jBqTXqoHp8pyXeUZKbXcJch7qxm",
    title: "Schedule",
    description:
      "Highlights times and durations and runs a per-paragraph running clock.",
    icon: "clock",
    accent: "#ca8a04",
  },
  {
    rootUrl: "automerge:2BkapPQei7cVRiWryrVPQEQQKCJ9",
    title: "Make stickerable",
    description:
      "Bridges other cards' text into the sticker system so any source can annotate it.",
    icon: "sparkles",
    accent: "#b45309",
  },
  {
    rootUrl: "automerge:2xYFYSsg6LhiPE719qB6nCZT9Zyh",
    title: "Mentions",
    description:
      "While on the canvas, turns on inline @mentions for every editor here.",
    icon: "at",
    accent: "#6366f1",
  },
  {
    rootUrl: "automerge:2Tjy4kfsDHyv7xLCZtuf8dHAWbDy",
    title: "Stickers",
    description:
      "While on the canvas, renders sticker annotations in every editor here.",
    icon: "sparkles",
    accent: "#db2777",
  },
];

// The starter set: every card (one uniform `card` document each), plus a map, a
// demo markdown note, an empty deck, and the context viewer (still its own
// tool). `repo.create` doesn't run a datatype's `init`, so each child doc's
// initial value is set inline here.
export function seedExampleItems(repo: Repo): PartsBinItem[] {
  const cardItems: PartsBinItem[] = CARD_SEEDS.map((seed) => ({
    id: crypto.randomUUID(),
    url: mintCard(repo, seed).url,
    toolId: "card",
  }));

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
  // The context viewer: an anchor doc that, once on the canvas, shows a live,
  // read-only view of the selected embed's slice of the shared context (see
  // @embark/context-viewer). It stays its own tool rather than a card.
  const contextViewer = repo.create({
    "@patchwork": { type: "context-viewer" },
  });

  return [
    ...cardItems,
    { id: crypto.randomUUID(), url: map.url, toolId: "map" },
    { id: crypto.randomUUID(), url: note.url, toolId: "codemirror-base" },
    { id: crypto.randomUUID(), url: deck.url, toolId: "deck" },
    {
      id: crypto.randomUUID(),
      url: contextViewer.url,
      toolId: "context-viewer",
    },
  ];
}

// The urls are head-less (the service worker redirects to the latest heads on
// load), so a fresh bin always wires up the newest published module. A package's
// build output lives under `dist/`, so the card module is served at
// `automerge:<package rootUrl>/dist/card.js` (this raw module path bypasses the
// package.json `exports`, so it spells out `dist/`).
function mintCard(repo: Repo, seed: CardSeed) {
  return repo.create<CardDoc>({
    "@patchwork": { type: "card", title: seed.title },
    src: `/${encodeURIComponent(seed.rootUrl)}/dist/card.js`,
    description: seed.description,
    icon: seed.icon,
    accent: seed.accent,
    ...(seed.state as Partial<CardDoc>),
  });
}
