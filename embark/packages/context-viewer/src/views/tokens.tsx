import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { type ContextStore, Highlight, renderEmbedView } from "@embark/core";

// Shared building blocks for the context viewer's domain-specific views. Every
// channel that points at documents (selection, highlight, search results,
// command suggestions, schema matches) renders the same mention-style token and
// drives the same shared `Highlight` channel on hover.

// Doc-token labels are clipped to keep pills short (the full url is in `title`).
const MAX_LABEL = 40;

// A mention-style pill for one document. Hovering writes the document into the
// shared Highlight channel (so its other views light up) and the pill lights up
// whenever its document is highlighted by anyone. Pass an explicit `label` for
// tokens whose text isn't the document's title (e.g. a command suggestion).
export function DocToken(props: {
  url: AutomergeUrl;
  titles: DocTitles;
  highlight: HighlightController;
  label?: string;
}) {
  const { docUrl, docId } = splitDocUrl(props.url);
  if (props.label === undefined) props.titles.request(docUrl);
  const text = () => clip(props.label ?? props.titles.titleOf(docUrl));

  return (
    <span
      class="embark-token"
      classList={{
        "embark-token--highlighted": props.highlight.highlightedDocIds().has(docId),
      }}
      title={props.url}
      on:mouseenter={() => props.highlight.hover([docUrl])}
      on:mouseleave={() => props.highlight.clear()}
    >
      {text()}
    </span>
  );
}

// An embed's real inline face. Delegates to @embark/core's shared embed
// renderer — the same one the mention extension uses — so a document draws
// whatever token-tagged tool it registers (upgrading in place when the module
// loads), falling back to a plain title pill. The wrapper keeps the shared
// hover→Highlight wiring so the viewer's other panels still light up together.
// A custom `label` (e.g. a command suggestion) shows verbatim, skipping the
// embed face.
export function EmbedToken(props: {
  url: AutomergeUrl;
  highlight: HighlightController;
  label?: string;
}) {
  const { docUrl, docId } = splitDocUrl(props.url);
  let host!: HTMLSpanElement;

  onMount(() => {
    if (props.label !== undefined) {
      host.className = "embark-token";
      host.textContent = clip(props.label);
      return;
    }
    const teardown = renderEmbedView(host, props.url, host, {
      fallback: (node, handle) => {
        node.className = "embark-token";
        node.textContent = clip(
          docTitle(handle.doc() as DocLike) ?? shortId(props.url),
        );
      },
      onError: () => {
        host.className = "embark-token";
        host.textContent = shortId(props.url);
      },
    });
    onCleanup(teardown);
  });

  return (
    <span
      class="embark-embed"
      classList={{
        "embark-embed--highlighted": props.highlight
          .highlightedDocIds()
          .has(docId),
      }}
      title={props.url}
      on:mouseenter={() => props.highlight.hover([docUrl])}
      on:mouseleave={() => props.highlight.clear()}
    >
      <span ref={host} />
    </span>
  );
}

// The set of document ids currently highlighted (by any scope), plus this
// view's own writable Highlight slice. Hover/clear rewrite the slice to exactly
// the hovered documents; the slice is released when the view unmounts.
export type HighlightController = {
  highlightedDocIds: () => Set<string>;
  hover: (urls: AutomergeUrl[]) => void;
  clear: () => void;
};

export function useHighlight(store: ContextStore): HighlightController {
  const [incoming, setIncoming] = createSignal(store.read(Highlight));
  onCleanup(store.subscribe(Highlight, (next) => setIncoming(() => next)));

  const highlightedDocIds = createMemo(() => {
    const ids = new Set<string>();
    for (const url of Object.keys(incoming())) {
      if (isValidAutomergeUrl(url)) ids.add(parseAutomergeUrl(url).documentId);
    }
    return ids;
  });

  const handle = store.handle(Highlight);
  onCleanup(() => handle.release());
  const write = (urls: AutomergeUrl[]) => {
    handle.change((slice) => {
      const entries = slice as Record<string, true>;
      for (const key of Object.keys(entries)) delete entries[key];
      for (const url of urls) entries[url] = true;
    });
  };

  return { highlightedDocIds, hover: write, clear: () => write([]) };
}

// A lazily-populated cache of document titles. `request(url)` kicks off a
// (deduped) async resolve; `titleOf(url)` reactively returns the resolved title
// or a short id placeholder.
export type DocTitles = {
  titleOf: (url: AutomergeUrl) => string;
  request: (url: AutomergeUrl) => void;
};

export function useDocTitles(element: ToolElement): DocTitles {
  const [titles, setTitles] = createSignal<Record<string, string>>({});
  const pending = new Set<string>();

  const request = (docUrl: AutomergeUrl) => {
    if (pending.has(docUrl) || titles()[docUrl]) return;
    pending.add(docUrl);
    void (async () => {
      try {
        const handle = await element.repo.find<DocLike>(docUrl);
        const title = docTitle(handle.doc());
        setTitles((prev) => ({ ...prev, [docUrl]: title ?? shortId(docUrl) }));
      } catch {
        setTitles((prev) => ({ ...prev, [docUrl]: shortId(docUrl) }));
      } finally {
        pending.delete(docUrl);
      }
    })();
  };

  const titleOf = (docUrl: AutomergeUrl) => titles()[docUrl] ?? shortId(docUrl);
  return { titleOf, request };
}

// Whether `url` (a document url or a match sub-url) belongs to the same document
// as `focus`. Compares by document id, so a sub-url pointing inside the focused
// document still counts. Used by the focused views to keep only rows that touch
// the selected embed's document.
export function belongsToDoc(url: AutomergeUrl, focus: AutomergeUrl): boolean {
  return splitDocUrl(url).docId === splitDocUrl(focus).docId;
}

// Split a doc or match sub-url (`automerge:<id>/seg/seg`) into its owning
// document url and id. Falls back to the raw url if it can't be parsed.
export function splitDocUrl(url: AutomergeUrl): {
  docUrl: AutomergeUrl;
  docId: string;
} {
  try {
    const { documentId } = parseAutomergeUrl(url);
    return {
      docUrl: `automerge:${documentId}` as AutomergeUrl,
      docId: documentId,
    };
  } catch {
    return { docUrl: url, docId: url };
  }
}

type DocLike = {
  "@patchwork"?: { title?: unknown };
  props?: { name?: unknown };
  place?: { name?: unknown };
  content?: unknown;
  title?: unknown;
  name?: unknown;
};

// A human label for a document, trying the common title-bearing fields (the
// same ones the search box reads) without pulling in the datatype registry.
function docTitle(doc: DocLike | undefined): string | undefined {
  if (!doc) return undefined;
  const candidates = [
    doc["@patchwork"]?.title,
    doc.props?.name,
    doc.place?.name,
    doc.content,
    doc.title,
    doc.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

export function shortId(docUrl: AutomergeUrl): string {
  const id = docUrl.replace(/^automerge:/, "");
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function clip(text: string): string {
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL)}…` : text;
}
