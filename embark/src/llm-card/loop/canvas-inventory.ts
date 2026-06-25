import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { JsonSchema } from "../../lib/schema";
import {
  SchemaMatches,
  SchemaQueries,
  schemaKey,
} from "../../canvas/channels";
import type { LoopApi } from "../types";

// One document reachable on the canvas: its url plus the bare metadata the model
// needs to orient itself. Content is deliberately omitted - the model can read
// any doc it cares about via its own <script> tool calls.
export type CanvasDocInfo = {
  url: AutomergeUrl;
  type: string;
  title: string;
};

// A JSON Schema that matches only document *roots*: `@patchwork.type` (a string)
// lives at the top of every patchwork document and nowhere else, so the schema
// resolver returns one bare document url per reachable doc rather than a sub-url
// for every nested object.
const ROOT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    "@patchwork": {
      type: "object",
      properties: { type: { type: "string" } },
      required: ["type"],
    },
  },
  required: ["@patchwork"],
};

const ROOT_KEY = schemaKey(ROOT_SCHEMA);

// How long to wait for the schema resolver's first emit. It debounces 50ms
// (schema-resolver.ts), so this is comfortable headroom.
const SETTLE_MS = 300;

// Snapshot the documents currently on the canvas so the prompt can tell the
// model what it's working with. Subscribes to the root schema, lets it settle,
// then resolves each match to its type/title. The card's own document is
// excluded so it doesn't list itself.
export async function gatherCanvasInventory(
  api: LoopApi,
  selfUrl: AutomergeUrl,
): Promise<CanvasDocInfo[]> {
  const urls = await collectMatchUrls(api);
  const infos = await Promise.all(
    urls
      .filter((url) => url !== selfUrl)
      .map((url) => describeDoc(api, url)),
  );
  return infos.filter((info): info is CanvasDocInfo => info !== undefined);
}

// Render the inventory as a name + type bullet list for the prompt.
export function formatInventory(items: CanvasDocInfo[]): string {
  if (items.length === 0) return "No other documents are on the canvas yet.";
  return items.map((item) => `- "${item.title}" (${item.type})`).join("\n");
}

// Publish a transient root-schema query into the context, wait for the resolver
// to settle, capture the matched urls, then withdraw the query.
function collectMatchUrls(api: LoopApi): Promise<AutomergeUrl[]> {
  return new Promise((resolve) => {
    const store = api.findContextStore(api.element);
    if (!store) {
      resolve([]);
      return;
    }
    const queries = store.handle(SchemaQueries);
    queries.change((slice) => {
      slice[ROOT_KEY] = { name: "Documents", schema: ROOT_SCHEMA };
    });
    setTimeout(() => {
      const matches = store.read(SchemaMatches)[ROOT_KEY] ?? [];
      queries.release();
      resolve(matches);
    }, SETTLE_MS);
  });
}

// Resolve a document url to its `@patchwork` type/title, ignoring docs that
// can't be loaded or don't carry the metadata.
async function describeDoc(
  api: LoopApi,
  url: AutomergeUrl,
): Promise<CanvasDocInfo | undefined> {
  try {
    const handle = await api.repo.find<DocWithMetadata>(url);
    const meta = handle.doc()?.["@patchwork"];
    if (!meta || typeof meta.type !== "string") return undefined;
    return { url, type: meta.type, title: meta.title || "(untitled)" };
  } catch {
    return undefined;
  }
}

type DocWithMetadata = {
  "@patchwork"?: { type?: string; title?: string };
};
