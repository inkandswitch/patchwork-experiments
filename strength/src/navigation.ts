import type { AutomergeUrl } from "@automerge/automerge-repo";

export function openPatchworkDocument(
  hostElement: HTMLElement,
  url: AutomergeUrl,
  toolId?: string,
) {
  hostElement.dispatchEvent(
    new CustomEvent("patchwork:open-document", {
      detail: { url, toolId },
      bubbles: true,
      composed: true,
    }),
  );
}
