import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import {
  SchemaMatches,
  SchemaQueries,
  SearchQueries,
  SearchResults,
  schemaKey,
  readContext,
  useContextHandle,
  type JsonSchema,
  type SchemaQuery,
} from "@embark/core";
import "./doc-finder.css";

// A JSON Schema that matches only document *roots*: `@patchwork.type` (a string)
// lives at the top of every patchwork document and nowhere else, so the schema
// resolver returns one bare document url per reachable doc rather than a sub-url
// for every nested object. The "has a title" part isn't expressed here — we keep
// the schema loose and decide it later by resolving each doc's display title.
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
const ROOT_QUERY: SchemaQuery = { name: "Documents", schema: ROOT_SCHEMA };

// Tool entry point: a contributor that answers the canvas search channel with
// documents already on the canvas. It reads the active queries and the set of
// reachable documents, and writes back the urls of those whose (fuzzily
// resolved) title contains the query. The card itself only shows a title and a
// description of what it does — like a playing card in a game.
export const DocFinderProviderTool: ToolRender = (_handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <DocFinderProvider element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
};

function DocFinderProvider(props: { element: ToolElement }) {
  const repo = props.element.repo;
  // Read the active queries from the context and write results back as our own
  // scoped slice. The two are separate channels, so writing results never
  // retriggers the query effect.
  const searchQueries = readContext(props.element, SearchQueries);
  const results = useContextHandle(props.element, SearchResults);

  // Ask the canvas "which documents are reachable here?" by publishing the root
  // schema and reading its matches. Each match url is a bare document url.
  const schemaQueries = useContextHandle(props.element, SchemaQueries);
  schemaQueries.change((slice) => {
    slice[ROOT_KEY] = ROOT_QUERY;
  });
  const schemaMatches = readContext(props.element, SchemaMatches);
  const candidates = createMemo(() => schemaMatches()[ROOT_KEY] ?? []);

  // A lazily-populated cache of resolved display titles, keyed by doc url. A
  // signal so the search effect re-runs as titles arrive. An empty string means
  // "resolved, but the doc carries no title" — such docs are never surfaced.
  const [titles, setTitles] = createSignal<Record<AutomergeUrl, string>>({});
  const pending = new Set<string>();
  const ensureTitle = (url: AutomergeUrl) => {
    if (pending.has(url) || titles()[url] !== undefined) return;
    pending.add(url);
    void repo
      .find<unknown>(url)
      .then((handle) => {
        setTitles((prev) => ({ ...prev, [url]: docTitle(handle.doc()) }));
      })
      .catch(() => {})
      .finally(() => pending.delete(url));
  };
  createEffect(() => candidates().forEach(ensureTitle));

  // Answer each active query with the reachable docs whose title contains it
  // (case-insensitive). We own this result slice outright, so it's a plain
  // clear-and-rebuild on every change of the queries, matches, or titles.
  createEffect(() => {
    const active = Object.keys(searchQueries());
    const known = titles();
    const urls = candidates();
    results.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      for (const query of active) {
        const needle = query.toLowerCase();
        slice[query] = urls.filter((url) => {
          const title = known[url];
          return !!title && title.toLowerCase().includes(needle);
        });
      }
    });
  });

  onCleanup(() => {
    results.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
    });
  });

  return (
    <div class="embark-docfinder-card">
      <span class="embark-docfinder-card__pip embark-docfinder-card__pip--tl">
        <AtIcon />
      </span>
      <div class="embark-docfinder-card__body">
        <div class="embark-docfinder-card__title">Mention Finder</div>
        <p class="embark-docfinder-card__desc">
          Watches the canvas for active @mention searches and answers each one
          with the documents already here whose title matches — so you can
          mention runs and other docs from a note.
        </p>
        <div class="embark-docfinder-card__source">Canvas documents</div>
      </div>
      <span class="embark-docfinder-card__pip embark-docfinder-card__pip--br">
        <AtIcon />
      </span>
    </div>
  );
}

// A small "@" glyph used as the card's corner "pips", the way a playing card
// carries its suit in opposite corners.
function AtIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </svg>
  );
}

// A human display title for a document, trying the common title-bearing fields
// (the same ones the mention menu and context viewer read) so the card reads
// the same name as the rest of the app. Returns "" when nothing matches, which
// the caller treats as "untitled, don't surface".
function docTitle(doc: unknown): string {
  const record = (doc ?? {}) as {
    "@patchwork"?: { title?: unknown };
    title?: unknown;
    content?: unknown;
    name?: unknown;
    props?: { name?: unknown };
    place?: { name?: unknown };
  };
  const candidates = [
    record["@patchwork"]?.title,
    record.props?.name,
    record.place?.name,
    record.content,
    record.title,
    record.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return "";
}
