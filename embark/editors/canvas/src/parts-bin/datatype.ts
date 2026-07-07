import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { CardDoc } from "@embark/card";
import type { PartsBinDoc, PartsBinItem } from "./types";

// Berlin, matching @embark/map's defaults, inlined so the parts bin seeds a
// fresh map without depending on the map feature package.
const DEFAULT_CENTER: [number, number] = [13.388, 52.517];
const DEFAULT_ZOOM = 9.5;

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
  {
    rootUrl: "automerge:472iiEQWMcQp48hdNQAoDuvhS1cx",
    title: "Open Documents",
    description:
      "Shares the document you have open (and docs it links to) so other cards can find them.",
    icon: "file",
    accent: "#64748b",
  },
  {
    rootUrl: "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC",
    title: "Schema Matcher",
    description:
      "Answers schema queries by matching them against the open documents.",
    icon: "braces",
    accent: "#7c3aed",
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
    rootUrl: "automerge:asYz1WKN9GHigxdQPVVfr5h8MuW",
    title: "Commands",
    description:
      "While on the canvas, turns on the / command menu for every editor here.",
    icon: "slash",
    accent: "#0891b2",
  },
  {
    rootUrl: "automerge:2Tjy4kfsDHyv7xLCZtuf8dHAWbDy",
    title: "Stickers",
    description:
      "While on the canvas, renders sticker annotations in every editor here.",
    icon: "sparkles",
    accent: "#db2777",
  },
  {
    rootUrl: "automerge:uMCUHr7SvWiwF1YtmZsWhnUhWY2",
    title: "Pointer",
    description:
      "Shares where the pointer is and which embed it's over; the context viewer follows it to preview embeds.",
    icon: "pointer",
    accent: "#ea580c",
  },
  {
    rootUrl: "automerge:7tDif9cz12ZQXv55Yo73io1UUw4",
    title: "Geo Shapes",
    description:
      "While on the canvas, draws the markers and lines other cards publish on every map here.",
    icon: "shapes",
    accent: "#3b82f6",
  },
  {
    rootUrl: "automerge:25PPbHiDGuNmsTGSvCgiPnas8iqD",
    title: "Geo Markers",
    description:
      "Finds places in the open documents and publishes a map marker for each.",
    icon: "pin",
    accent: "#2563eb",
  },
  {
    rootUrl: "automerge:FBLNJtT5p4RcTEFErfZTNjswqNP",
    title: "Geo Lines",
    description:
      "Finds routes in the open documents and publishes a map line for each.",
    icon: "route",
    accent: "#0284c7",
  },
  {
    rootUrl: "automerge:3daZBaqA2YR5nEhTmRQoYz6coLhV",
    title: "Geo Zoom",
    description:
      "Zooms maps in on highlighted shapes, and back out when the highlight clears.",
    icon: "zoom",
    accent: "#059669",
  },
];

// The starter set: every card (one uniform `card` document each), plus a
// blank placeholder card, a map, an empty markdown note, an empty deck, and
// the context viewer (still its own tool). `repo.create` doesn't run a
// datatype's `init`, so each child doc's initial value is set inline here.
export function seedExampleItems(repo: Repo): PartsBinItem[] {
  const cardItems: PartsBinItem[] = CARD_SEEDS.map((seed) => ({
    id: crypto.randomUUID(),
    url: mintCard(repo, seed).url,
    toolId: "card",
  }));

  cardItems.push({
    id: crypto.randomUUID(),
    url: mintPlaceholderCard(repo).url,
    toolId: "card",
  });

  // The map and note carry an explicit `@patchwork.title`: their names can't
  // come from content (the note is deliberately empty, and a map has no text),
  // and without one the bin token would fall back to the raw datatype id.
  const map = repo.create({
    "@patchwork": { type: "map", title: "Map" },
    center: [...DEFAULT_CENTER],
    zoom: DEFAULT_ZOOM,
  });
  const note = repo.create({
    "@patchwork": { type: "markdown", title: "Note" },
    content: "",
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
    // No pinned tool id: the note resolves its editor from its "markdown"
    // datatype — the same fallback the canvas uses when the example is dropped,
    // so the preview always matches the dragged-out embed. Pinning a stale id
    // here (e.g. the legacy "codemirror-base") silently blanks the preview
    // whenever that id isn't registered in the host.
    { id: crypto.randomUUID(), url: note.url },
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

// The starting spec of a blank card: instructions for turning it into a real
// one via the inspector's regenerate loop.
const PLACEHOLDER_SPEC = `# Blank Card

This card has no behavior yet.

Describe what it should do here, then right-click the card on the canvas,
choose Inspect, and press "Regenerate code" under this spec.
`;

// The no-op behavior module the blank card ships with: it only labels the
// middle slot so the card reads as intentionally empty.
const PLACEHOLDER_MODULE = `// A placeholder behavior. Regenerate this module from the card's spec.
export default (handle, element) => {
  const note = document.createElement("div");
  note.textContent = "No behavior yet";
  note.style.cssText =
    "color: #a8a29e; font-size: 12px; text-align: center; padding: 12px 8px;";
  element.appendChild(note);
  return () => note.remove();
};
`;

// A blank placeholder card, minted entirely client-side: its package is a
// plain folder doc holding a `spec.md` and a bundleless `card.js` — no build
// step, no published module. Editing the spec and regenerating (see
// @embark/inspect) is how it becomes a real card.
function mintPlaceholderCard(repo: Repo) {
  const spec = repo.create({
    "@patchwork": { type: "file" },
    name: "spec.md",
    extension: "md",
    mimeType: "text/markdown",
    content: PLACEHOLDER_SPEC,
  });
  const module = repo.create({
    "@patchwork": { type: "file" },
    name: "card.js",
    extension: "js",
    mimeType: "text/javascript",
    content: PLACEHOLDER_MODULE,
  });
  const pkg = repo.create({
    "@patchwork": { type: "folder" },
    title: "Blank Card",
    docs: [
      { name: "spec.md", type: "file", url: spec.url },
      { name: "card.js", type: "file", url: module.url },
    ],
  });

  return repo.create<CardDoc>({
    "@patchwork": { type: "card", title: "Blank Card" },
    src: `/${encodeURIComponent(pkg.url)}/card.js`,
    description:
      "A card without any behavior. Inspect it and edit the spec to make it do something.",
    icon: "card",
    accent: "#a8a29e",
  });
}
