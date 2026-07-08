import contextChannels from "./skills/context-channels.md?raw";
import definingAChannel from "./skills/defining-a-channel.md?raw";
import cardPlugins from "./skills/card-plugins.md?raw";
import requestResponseProvider from "./skills/request-response-provider.md?raw";
import findingDocuments from "./skills/finding-documents.md?raw";
import mintingDocuments from "./skills/minting-documents.md?raw";
import externalApis from "./skills/external-apis.md?raw";
import stickerSource from "./skills/sticker-source.md?raw";
import commandProvider from "./skills/command-provider.md?raw";
import searchProvider from "./skills/search-provider.md?raw";
import capabilityToggle from "./skills/capability-toggle.md?raw";
import ambientWatcher from "./skills/ambient-watcher.md?raw";
import mapExtensions from "./skills/map-extensions.md?raw";
import cardUi from "./skills/card-ui.md?raw";

// The skills API handed to the LLM's script blocks: retrievable guides for
// the card archetypes and shared mechanics, baked into this bundle from the
// markdown files in ./skills. The system prompt carries only the index
// (name + one-liner); the model pulls full content for whatever the spec
// needs, keeping the always-on prompt small.
export type Skills = {
  read(name: string): Promise<string>;
};

export function createSkillsApi(): Skills {
  return {
    async read(name) {
      const skill = SKILLS.find((s) => s.name === name);
      if (!skill) {
        throw new Error(
          `Unknown skill: ${name}. Available: ${SKILLS.map((s) => s.name).join(", ")}`,
        );
      }
      return skill.content;
    },
  };
}

// The index lines interpolated into the system prompt, so the roster the
// model sees can never drift from what `skills.read` serves.
export function skillIndex(): string {
  return SKILLS.map((s) => `- \`${s.name}\` — ${s.description}`).join("\n");
}

type Skill = {
  name: string;
  description: string;
  content: string;
};

// Descriptions double as routing hints: they should tell the model, from the
// spec alone, whether a skill applies. Mechanics skills first, archetypes
// after.
const SKILLS: Skill[] = [
  {
    name: "context-channels",
    description:
      "The shared context store: the client to import, subscribe/change/release, merge rules, and the roster of channels with their owning packages and automerge urls. Read this for ANY card that talks to the canvas (almost all do).",
    content: contextChannels,
  },
  {
    name: "defining-a-channel",
    description:
      "Owning a NEW channel from your card's package: the channels.js definition module, definedBy/spec attribution, naming, set channels, designing values for the one-level merge, exporting helpers.",
    content: definingAChannel,
  },
  {
    name: "card-plugins",
    description:
      "Registering datatypes and tools (board views, token faces) from a card via `export const plugins`: descriptor shapes, lazy loading, and the face-up lifecycle. Needed by any card that mints its own document kind.",
    content: cardPlugins,
  },
  {
    name: "request-response-provider",
    description:
      "The reconciliation loop for cards that answer query channels (search or commands): per-query debounce, stale guards, pruning dropped queries. Copyable template.",
    content: requestResponseProvider,
  },
  {
    name: "finding-documents",
    description:
      "Discovering documents on the canvas by shape: subscribing to schema:matches with declared key interest, the schemaKey canonicalization, the supported JSON Schema subset, watching matched docs for changes.",
    content: findingDocuments,
  },
  {
    name: "minting-documents",
    description:
      "Creating documents: @patchwork metadata, matchable root fields, link-don't-copy, announcing via open-documents, caching so nothing is minted twice, when to delete.",
    content: mintingDocuments,
  },
  {
    name: "external-apis",
    description:
      "Fetching outside data: the keyless APIs already proven here (weather, geocoding, routing, exchange rates), debouncing, stale-response guards, module-level caches, rate limits.",
    content: externalApis,
  },
  {
    name: "sticker-source",
    description:
      "Cards that annotate text in the user's notes (converters, highlighters, inline widgets): the full engine template plus the scan-function contract and sticker shapes.",
    content: stickerSource,
  },
  {
    name: "command-provider",
    description:
      "Cards that add a /command to text editors: parsing queries, discovery suggestions, minting the result document, answering commands:suggestions.",
    content: commandProvider,
  },
  {
    name: "search-provider",
    description:
      "Cards that answer canvas searches: the external variant (fetch + mint) and the local variant (filter documents already in scope by title).",
    content: searchProvider,
  },
  {
    name: "capability-toggle",
    description:
      "Cards that switch a canvas feature on while face-up and off when flipped/removed, e.g. publishing a CodeMirror extension. The simplest archetype.",
    content: capabilityToggle,
  },
  {
    name: "ambient-watcher",
    description:
      "Cards that watch for a document kind on the canvas (a map, a table) and react to its changes: adopt a match, listen, debounce, fetch, mint results.",
    content: ambientWatcher,
  },
  {
    name: "map-extensions",
    description:
      "Putting things on the canvas's maps: write geo:shapes for markers/lines, or publish a map extension (element, map) => teardown into map:extensions for camera moves and custom map behavior.",
    content: mapExtensions,
  },
  {
    name: "card-ui",
    description:
      "Rendering into the card's middle slot, persisting settings on the card document, inline CSS, and wiring hover to the highlight channel.",
    content: cardUi,
  },
];
