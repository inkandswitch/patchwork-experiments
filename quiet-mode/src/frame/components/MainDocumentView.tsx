import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { Accessor } from "solid-js";
import { Show } from "solid-js";

interface MainDocumentViewProps {
  viewKey: Accessor<string | undefined>;
  selectedDocUrl: Accessor<AutomergeUrl | undefined>;
  toolId: Accessor<string | undefined>;
}

/**
 * Renders the main document view with proper keying for remounting
 */
export function MainDocumentView({
  viewKey,
  selectedDocUrl,
  toolId,
}: MainDocumentViewProps) {
  return (
    <div class="main-document-view">
      <Show when={viewKey()} keyed>
        {(key) => {
          return (
            <patchwork-view doc-url={selectedDocUrl()!} tool-id={toolId()} />
          );
        }}
      </Show>
      {!selectedDocUrl() && (
        <div class="main-document-view__empty">
          Select a document in the sidebar
        </div>
      )}
    </div>
  );
}
