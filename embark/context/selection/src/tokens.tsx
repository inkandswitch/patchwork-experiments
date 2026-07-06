import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type Repo,
} from "@automerge/automerge-repo";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { splitDocUrl, type ContextView } from "@embark/context";
import { Highlight } from "./channels";
import "./tokens.css";

// Shared building blocks for context views. Any channel that points at
// documents (selection, highlight, search results, command suggestions,
// stickers) renders the same embed token and drives the same shared `Highlight`
// channel on hover; string-keyed channels render as chips. These live in
// @embark/selection because the hover interaction writes the `Highlight`
// channel this package owns.

// Token labels are clipped to keep pills short (the full url is in `title`).
const MAX_LABEL = 40;

// An embed's real inline face. Renders the shared `token-view` tool — the same
// one the mention extension uses — so a document draws whatever token-tagged
// tool it registers (upgrading in place when the module loads), falling back to
// a plain title pill. The wrapper keeps the shared hover->Highlight wiring so a
// visualizer's other panels still light up together. A custom `label` (e.g. a
// command suggestion) shows verbatim, skipping the embed face.
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
    const face = document.createElement("patchwork-view");
    face.setAttribute("tool-id", "token-view");
    face.setAttribute("doc-url", props.url);
    host.appendChild(face);
    onCleanup(() => face.remove());
  });

  return (
    <span
      class="embark-embed-token"
      classList={{
        "embark-embed-token--highlighted": props.highlight
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

// Takes a `ContextView` (not the full store): it only needs to read/subscribe
// the shared `Highlight` channel and open a scope to write hovers into it — and
// a filtered view passes `highlight` through to the real store unchanged, so
// hover emphasis still lights up across every panel.
export function useHighlight(store: ContextView): HighlightController {
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

export function useDocTitles(repo: Repo): DocTitles {
  const [titles, setTitles] = createSignal<Record<string, string>>({});
  const pending = new Set<string>();

  const request = (docUrl: AutomergeUrl) => {
    if (pending.has(docUrl) || titles()[docUrl]) return;
    pending.add(docUrl);
    void (async () => {
      try {
        const handle = await repo.find<DocLike>(docUrl);
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
