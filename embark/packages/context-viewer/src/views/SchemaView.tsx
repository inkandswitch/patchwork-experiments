import type { AutomergeUrl } from "@automerge/automerge-repo";
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
import type { ContextStore } from "@embark/core";
import {
  SchemaMatches,
  SchemaQueries,
  type SchemaQuery,
} from "@embark/core";
import { splitDocUrl, useDocTitles, useHighlight } from "./tokens";

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

  const titles = useDocTitles(props.element);
  const highlight = useHighlight(props.store);

  // Lazily-resolved match values, filled in as `repo.find` settles (the sub-url
  // resolves straight to the matched subtree). `resolving` dedupes lookups.
  const [resolved, setResolved] = createSignal<Record<string, Resolved>>({});
  const resolving = new Set<string>();

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
      const { docUrl } = splitDocUrl(url);
      setResolved((prev) => ({ ...prev, [url]: { docUrl, value: handle.doc() } }));
      titles.request(docUrl);
    } catch {
      // Leave it unresolved; the token shows a placeholder.
    } finally {
      resolving.delete(url);
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
        const { docUrl, docId } = splitDocUrl(url);
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
                            highlight.highlightedDocIds().has(group.docId),
                        }}
                        on:mouseenter={() => highlight.hover([group.docUrl])}
                        on:mouseleave={() => highlight.clear()}
                      >
                        <div class="embark-schema__doc">
                          {titles.titleOf(group.docUrl)}
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
