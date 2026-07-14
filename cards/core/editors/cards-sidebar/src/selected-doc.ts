import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import type { OpenDocumentEvent } from "@inkandswitch/patchwork-elements";

// Track the frame's currently selected document, frame-agnostically — the
// same mechanism the Open Documents card uses. `patchwork:open-document`
// events are `bubbles + composed`, so every open anywhere in the frame
// reaches document.body (which we listen on, working even while the Cards
// host is parked outside the frame). The initial value (and back/forward
// navigation) comes from the `#doc=<documentId>` hash the frame's router
// maintains. Calls `onChange` immediately with the current value; returns a
// stopper.
export function trackSelectedDocument(
  onChange: (url: AutomergeUrl | undefined) => void,
): () => void {
  const onOpenDocument = (event: Event) => {
    const url = (event as OpenDocumentEvent).detail?.url;
    onChange(normalizeDocUrl(url));
  };
  const onHashChange = () => onChange(selectedFromHash());

  document.body.addEventListener(
    "patchwork:open-document",
    onOpenDocument as EventListener,
  );
  window.addEventListener("hashchange", onHashChange);
  onChange(selectedFromHash());

  return () => {
    document.body.removeEventListener(
      "patchwork:open-document",
      onOpenDocument as EventListener,
    );
    window.removeEventListener("hashchange", onHashChange);
  };
}

// The frame's hash routing carries the selection as `#doc=<documentId>` (with
// optional `&tool=`/`&heads=` params). Normalized down to a bare document url.
function selectedFromHash(): AutomergeUrl | undefined {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const doc = params.get("doc");
  if (!doc) return undefined;
  return normalizeDocUrl(
    doc.startsWith("automerge:") ? doc : `automerge:${doc}`,
  );
}

// Normalize any automerge url (possibly carrying heads or a sub-path) to its
// bare document url; undefined when it isn't a valid url at all.
function normalizeDocUrl(url: string | undefined): AutomergeUrl | undefined {
  if (!url || !isValidAutomergeUrl(url)) return undefined;
  return `automerge:${parseAutomergeUrl(url).documentId}` as AutomergeUrl;
}
