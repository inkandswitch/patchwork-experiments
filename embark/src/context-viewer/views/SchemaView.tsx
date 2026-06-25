import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import type { ContextStore } from "../../lib/context";
import {
  Highlight,
  SchemaMatches,
  SchemaQueries,
  type SchemaQuery,
} from "../../canvas/channels";

// A domain-specific view over the schema channels: instead of dumping the raw
// `schema:queries` / `schema:matches` JSON, it shows each registered schema by
// name, groups its matches by owning document, and renders each match as a
// token carrying the value we actually extracted from the document. Hovering a
// group writes the document into the shared `Highlight` channel (so its other
// views light up), and incoming highlights are reflected back here.

// Tokens show the extracted value verbatim, truncated past this many chars.
const MAX_TOKEN_LEN = 48;

type DocGroup = { docUrl: AutomergeUrl; docId: string; matches: AutomergeUrl[] };
type SchemaBlock = {
  key: string;
  name: string;
  groups: DocGroup[];
  matchCount: number;
};
type Resolved = { docUrl: AutomergeUrl; value: unknown };

export function SchemaView(props: {
  store: ContextStore;
  element: ToolElement;
}) {
  // The two schema channels, seeded with the current value (subscribe fires
  // only on change).
  const [queries, setQueries] = createSignal(props.store.read(SchemaQueries));
  const [matches, setMatches] = createSignal(props.store.read(SchemaMatches));
  onCleanup(props.store.subscribe(SchemaQueries, (q) => setQueries(() => q)));
  onCleanup(props.store.subscribe(SchemaMatches, (m) => setMatches(() => m)));

  // Lazily-resolved match values + document titles, filled in as `repo.find`
  // settles. The `*ing` sets dedupe in-flight lookups.
  const [resolved, setResolved] = createSignal<Record<string, Resolved>>({});
  const [titles, setTitles] = createSignal<Record<string, string>>({});
  const resolving = new Set<string>();
  const resolvingTitle = new Set<string>();

  // Resolve any match urls we haven't seen yet whenever the match set changes.
  // `untrack` keeps the effect keyed to `matches()` only (the resolution writes
  // would otherwise re-trigger it).
  createEffect(() => {
    const all = matches();
    untrack(() => {
      for (const list of Object.values(all)) {
        for (const url of list) {
          if (resolving.has(url) || resolved()[url]) continue;
          resolving.add(url);
          void resolveMatch(url);
        }
      }
    });
  });

  const resolveMatch = async (url: AutomergeUrl) => {
    try {
      const handle = await props.element.repo.find<unknown>(url);
      const { docUrl } = splitMatch(url);
      setResolved((prev) => ({ ...prev, [url]: { docUrl, value: handle.doc() } }));
      void resolveTitle(docUrl);
    } catch {
      // Leave it unresolved; the token shows a placeholder.
    } finally {
      resolving.delete(url);
    }
  };

  const resolveTitle = async (docUrl: AutomergeUrl) => {
    if (resolvingTitle.has(docUrl) || titles()[docUrl]) return;
    resolvingTitle.add(docUrl);
    try {
      const handle = await props.element.repo.find<DocLike>(docUrl);
      const title = docTitle(handle.doc());
      setTitles((prev) => ({ ...prev, [docUrl]: title ?? shortId(docUrl) }));
    } catch {
      setTitles((prev) => ({ ...prev, [docUrl]: shortId(docUrl) }));
    } finally {
      resolvingTitle.delete(docUrl);
    }
  };

  // Each registered schema, with its matches grouped by owning document.
  const blocks = createMemo<SchemaBlock[]>(() => {
    const q = queries();
    const m = matches();
    return Object.keys(q).map((key) => {
      const urls = m[key] ?? [];
      const byDoc = new Map<string, DocGroup>();
      for (const url of urls) {
        const { docUrl, docId } = splitMatch(url);
        let group = byDoc.get(docId);
        if (!group) {
          group = { docUrl, docId, matches: [] };
          byDoc.set(docId, group);
        }
        group.matches.push(url);
      }
      return {
        key,
        name: queryName(q[key], key),
        groups: [...byDoc.values()],
        matchCount: urls.length,
      };
    });
  });

  // The document ids currently highlighted by anyone, so groups light up when a
  // sibling view (e.g. a map pin) highlights the same document.
  const [highlight, setHighlight] = createSignal(props.store.read(Highlight));
  onCleanup(props.store.subscribe(Highlight, (h) => setHighlight(() => h)));
  const highlightedDocIds = createMemo(() => {
    const ids = new Set<string>();
    for (const url of Object.keys(highlight())) {
      if (isValidAutomergeUrl(url)) ids.add(parseAutomergeUrl(url).documentId);
    }
    return ids;
  });

  // This view's own Highlight slice — rewritten to exactly the hovered document.
  const highlightHandle = props.store.handle(Highlight);
  onCleanup(() => highlightHandle.release());
  const writeHighlight = (urls: AutomergeUrl[]) => {
    highlightHandle.change((slice) => {
      const entries = slice as Record<string, true>;
      for (const key of Object.keys(entries)) delete entries[key];
      for (const url of urls) entries[url] = true;
    });
  };

  const docLabel = (docUrl: AutomergeUrl) => titles()[docUrl] ?? shortId(docUrl);

  return (
    <div class="embark-context__channel embark-schema">
      <div class="embark-context__name">schema</div>
      <div class="embark-schema__body">
        <Show
          when={blocks().length > 0}
          fallback={
            <div class="embark-schema__empty">no schemas registered</div>
          }
        >
          <For each={blocks()}>
            {(block) => (
              <div class="embark-schema__item">
                <div class="embark-schema__schema-name">{block.name}</div>
                <Show
                  when={block.matchCount > 0}
                  fallback={
                    <div class="embark-schema__no-matches">no matches</div>
                  }
                >
                  <For each={block.groups}>
                    {(group) => (
                      <div
                        class="embark-schema__group"
                        classList={{
                          "embark-schema__group--highlighted":
                            highlightedDocIds().has(group.docId),
                        }}
                        on:mouseenter={() => writeHighlight([group.docUrl])}
                        on:mouseleave={() => writeHighlight([])}
                      >
                        <div class="embark-schema__doc">
                          {docLabel(group.docUrl)}
                        </div>
                        <div class="embark-schema__tokens">
                          <For each={group.matches}>
                            {(matchUrl) => {
                              const value = () => resolved()[matchUrl]?.value;
                              return (
                                <span
                                  class="embark-schema__token"
                                  title={fullValue(value())}
                                >
                                  {tokenLabel(value())}
                                </span>
                              );
                            }}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

// The schema's human name, defended against legacy cards that wrote a bare JSON
// Schema (no `name`) before queries carried one.
function queryName(query: SchemaQuery | undefined, key: string): string {
  const name = query?.name;
  return typeof name === "string" && name.trim() ? name : key;
}

// Split a match sub-url (`automerge:<id>/seg/seg`) into its owning document url
// and id. Match urls always validate, but fall back to the raw url defensively.
function splitMatch(url: AutomergeUrl): { docUrl: AutomergeUrl; docId: string } {
  try {
    const { documentId } = parseAutomergeUrl(url);
    return { docUrl: `automerge:${documentId}` as AutomergeUrl, docId: documentId };
  } catch {
    return { docUrl: url, docId: url };
  }
}

// The truncated token label: the value we actually extracted from the document,
// stringified compactly and cut to MAX_TOKEN_LEN. `undefined` means "still
// resolving".
function tokenLabel(value: unknown): string {
  if (value === undefined) return "…";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "…";
  return text.length > MAX_TOKEN_LEN ? `${text.slice(0, MAX_TOKEN_LEN)}…` : text;
}

// The full (untruncated) value for the token's hover tooltip.
function fullValue(value: unknown): string {
  if (value === undefined) return "resolving…";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

type DocLike = {
  "@patchwork"?: { title?: unknown };
  props?: { name?: unknown };
  title?: unknown;
  name?: unknown;
};

// A human label for a document, trying the common title-bearing fields without
// pulling in the datatype registry.
function docTitle(doc: DocLike | undefined): string | undefined {
  if (!doc) return undefined;
  const candidates = [
    doc["@patchwork"]?.title,
    doc.props?.name,
    doc.title,
    doc.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

function shortId(docUrl: AutomergeUrl): string {
  const id = docUrl.replace(/^automerge:/, "");
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
