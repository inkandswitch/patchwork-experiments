import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { CardDoc } from "@embark/card";
import type { DeckCard, DeckDoc } from "../deck/types";

// The parts bin is code-defined: this module *is* the bin. Each entry is
// display data plus a factory that mints the document backing its preview, so
// shipping a new module version updates every bin — nothing about the bin is
// persisted per browser (which is also why there is no delete or rename: the
// catalog here is the single source of truth).
export type BinEntry = {
  // Shown as the entry's heading and on its drag token.
  label: string;
  // Which tool renders the preview (and the dropped embed); the minted
  // document's datatype when unset.
  toolId?: string;
  // The canvas footprint to recreate when this example is dropped; the canvas
  // default is used when unset.
  width?: number;
  height?: number;
  // Mint the session-local document backing this entry's preview. Dragging the
  // entry out clones that document (see PartsBinList), so it stays pristine.
  create: (repo: Repo) => DocHandle<unknown>;
};

// Berlin, matching @embark/map's defaults, inlined so the parts bin mints a
// fresh map without depending on the map feature package.
const DEFAULT_CENTER: [number, number] = [13.388, 52.517];
const DEFAULT_ZOOM = 9.5;

// Every card in the bin is one `card` document (see @embark/card): it names the
// behavior module it loads and carries the chrome the shell draws around it.
// This one table is the whole card catalog — a uniform row per card, minted into
// an identical document shape. Because each row is a real document the bin hands
// out clones of, formerly handle-less cards (weather, timer, …) get their own
// per-instance state when dragged out.
type CardSeed = {
  // The card feature package's head-less rootUrl. The service worker redirects
  // it to the latest heads, so a fresh mint always loads the newest published
  // `card.js`.
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
    rootUrl: "automerge:41HBbYkbrqYd9STaojjQUsFc1jDW",
    title: "Routes",
    description:
      "Type /Drive, /Walk, or /Transit to route between two places. Data from OSRM.",
    icon: "route",
    accent: "#8b5cf6",
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
    rootUrl: "automerge:3daZBaqA2YR5nEhTmRQoYz6coLhV",
    title: "Geo Zoom",
    description:
      "Zooms maps in on highlighted shapes, and back out when the highlight clears.",
    icon: "zoom",
    accent: "#059669",
  },
];

// Pre-made piles: themed sets of cards, each minted as its own deck document.
// Every card in a deck is a fresh `card` document (via the same CARD_SEEDS
// rows, matched by title), so a deck's cards are independent of the loose
// examples in the bin.
const DECK_SEEDS: { title: string; cardTitles: string[] }[] = [
  {
    title: "Core",
    cardTitles: ["Open Documents", "Schema Matcher"],
  },
  {
    title: "Maps",
    cardTitles: ["Geo Shapes", "Geo Markers", "Geo Zoom"],
  },
  {
    title: "Embark",
    cardTitles: ["Place Finder", "Routes", "Schedule"],
  },
  {
    title: "Markdown",
    cardTitles: ["Mentions", "Stickers", "Commands"],
  },
];

// The standard set: every card, a blank placeholder card, a map, an empty
// markdown note, the pre-made decks, an empty deck, and the context viewer
// (still its own tool). `repo.create` doesn't run a datatype's `init`, so each
// factory sets the document's initial value inline.
export const DEFAULT_BIN: BinEntry[] = [
  ...CARD_SEEDS.map(
    (seed): BinEntry => ({
      label: seed.title,
      toolId: "card",
      create: (repo) => mintCard(repo, seed),
    }),
  ),
  { label: "Blank Card", toolId: "card", create: mintPlaceholderCard },
  {
    label: "Map",
    toolId: "map",
    create: (repo) =>
      repo.create({
        // An explicit `@patchwork.title`: a map has no text to derive a name
        // from, and without one the bin token falls back to the raw datatype id.
        "@patchwork": { type: "map", title: "Map" },
        center: [...DEFAULT_CENTER],
        zoom: DEFAULT_ZOOM,
      }),
  },
  {
    // No pinned tool id: the note resolves its editor from its "markdown"
    // datatype — the same fallback the canvas uses when the example is dropped,
    // so the preview always matches the dragged-out embed. Pinning a stale id
    // here (e.g. the legacy "codemirror-base") silently blanks the preview
    // whenever that id isn't registered in the host.
    label: "Note",
    create: (repo) =>
      repo.create({
        "@patchwork": { type: "markdown", title: "Note" },
        content: "",
      }),
  },
  // The pre-made decks. Dragging one out deep-clones the deck *and* its cards
  // (the drag-out rewrite follows the card references), so each canvas gets an
  // independent pile.
  ...DECK_SEEDS.map(
    (seed): BinEntry => ({
      label: seed.title,
      toolId: "deck",
      create: (repo) => mintDeck(repo, seed),
    }),
  ),
  {
    // A fresh, empty deck: each drag-out starts its own pile; cards are added
    // by dragging embeds into it.
    label: "Deck",
    toolId: "deck",
    create: (repo) =>
      repo.create({
        "@patchwork": { type: "deck" },
        title: "Deck",
        fanned: false,
        cards: [],
      }),
  },
  {
    // The context viewer: an anchor doc that, once on the canvas, shows a live,
    // read-only view of the selected embed's slice of the shared context (see
    // @embark/context-viewer). It stays its own tool rather than a card.
    label: "Context Viewer",
    toolId: "context-viewer",
    create: (repo) =>
      repo.create({
        "@patchwork": { type: "context-viewer" },
      }),
  },
];

// The @embark/page-url package (patchwork-tools/embark/cards/legacy/page-url),
// published with pushwork; the minted card's src points at its root card.js.
const PAGE_URL_CARD_PACKAGE = "automerge:eXE2Kjh1YkQEkYS6aAMoAAfYZXn";

// What the browser extension's side panel offers (see cards-browser-extension):
// just the current-page card, whose module talks to the extension's bridge via
// window.patchworkCards. Same shape the extension seeds its stack with.
export const BROWSER_BIN: BinEntry[] = [
  {
    label: "Current page",
    toolId: "card",
    create: (repo) =>
      repo.create({
        "@patchwork": { type: "card", title: "Current page" },
        src: `/${encodeURIComponent(PAGE_URL_CARD_PACKAGE)}/card.js`,
        description: "The web page open in the browser",
        icon: "at",
        accent: "#2563eb",
        url: null,
        pageTitle: null,
      }),
  },
];

// Resolve a card-stack document's `binPreset` to catalog entries. Unset (the
// in-app stacks) and unknown values fall back to the standard set.
export function binEntriesForPreset(preset: string | undefined): BinEntry[] {
  return preset === "browser" ? BROWSER_BIN : DEFAULT_BIN;
}

// The urls are head-less (the service worker redirects to the latest heads on
// load), so a fresh mint always wires up the newest published module. Cards
// are bundleless plain-JS packages, so the behavior module is served straight
// from the package root at `automerge:<package rootUrl>/card.js`.
function mintCard(repo: Repo, seed: CardSeed) {
  return repo.create<CardDoc>({
    "@patchwork": { type: "card", title: seed.title },
    src: `/${encodeURIComponent(seed.rootUrl)}/card.js`,
    description: seed.description,
    icon: seed.icon,
    accent: seed.accent,
    ...(seed.state as Partial<CardDoc>),
  });
}

// A pre-made deck: a folded pile of freshly minted cards, one per named
// CARD_SEEDS row. A missing title is a programming error in DECK_SEEDS, so it
// throws rather than silently dealing a thinner deck.
function mintDeck(repo: Repo, seed: { title: string; cardTitles: string[] }) {
  const cards: DeckCard[] = seed.cardTitles.map((cardTitle) => {
    const cardSeed = CARD_SEEDS.find((entry) => entry.title === cardTitle);
    if (!cardSeed) throw new Error(`Unknown card seed: ${cardTitle}`);
    return {
      id: crypto.randomUUID(),
      url: mintCard(repo, cardSeed).url,
      toolId: "card",
    };
  });

  return repo.create<DeckDoc>({
    "@patchwork": { type: "deck" },
    title: seed.title,
    fanned: false,
    cards,
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
