import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";

const MAX_EMBED_DEPTH = 5;

function getAncestorEmbedInfo(el: HTMLElement): {
  urls: Set<string>;
  depth: number;
} {
  const urls = new Set<string>();
  let depth = 0;
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    if (node.tagName === "PATCHWORK-VIEW") {
      const url = node.getAttribute("doc-url");
      if (url) urls.add(url);
      depth++;
    }
    node = node.parentElement;
  }
  return { urls, depth };
}

export function AutomergeEmbed(props: { docUrl: string }) {
  let containerRef!: HTMLDivElement;
  let viewEl: HTMLElement | null = null;
  const [blocked, setBlocked] = createSignal<string | null>(null);

  function checkBlocked(): string | null {
    const { urls, depth } = getAncestorEmbedInfo(containerRef);
    if (urls.has(props.docUrl)) {
      return "Circular embed detected";
    }
    if (depth >= MAX_EMBED_DEPTH) {
      return "Embed depth limit reached";
    }
    return null;
  }

  function removeViewEl() {
    if (viewEl && viewEl.parentNode) {
      viewEl.parentNode.removeChild(viewEl);
      viewEl = null;
    }
  }

  function createViewEl() {
    viewEl = document.createElement("patchwork-view");
    viewEl.setAttribute("doc-url", props.docUrl);
    viewEl.style.display = "block";
    viewEl.style.width = "100%";
    viewEl.style.height = "100%";
    viewEl.style.contain = "layout";
    containerRef.appendChild(viewEl);
  }

  onMount(() => {
    const reason = checkBlocked();
    if (reason) {
      setBlocked(reason);
      return;
    }
    createViewEl();
  });

  createEffect(() => {
    // Track props.docUrl reactively
    const url = props.docUrl;
    const reason = checkBlocked();
    if (reason) {
      setBlocked(reason);
      removeViewEl();
    } else {
      setBlocked(null);
      if (viewEl) {
        viewEl.setAttribute("doc-url", url);
      } else if (containerRef) {
        createViewEl();
      }
    }
  });

  onCleanup(() => {
    removeViewEl();
  });

  return (
    <Show
      when={!blocked()}
      fallback={<div class="embed-blocked">{blocked()}</div>}
    >
      <div ref={containerRef} class="automerge-embed-container" />
    </Show>
  );
}
