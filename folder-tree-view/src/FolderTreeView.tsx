import {
  makeDocumentProjection,
  useDocument,
} from "@automerge/automerge-repo-solid-primitives";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import type { OpenDocumentEventDetail } from "@inkandswitch/patchwork-elements";
import { createSignal } from "solid-js";

import type { AccountLikeDoc, PatchworkToolProps } from "./types.ts";
import { filter, setFilter } from "./state.ts";
import { createOpenEvent } from "./events.ts";
import { SearchIcon } from "./icons.tsx";
import { DocumentList } from "./document-list/document-list.tsx";
import { handleFilesDrop } from "./document-list/file-drop.ts";
import "./styles.css";

export function FolderTreeView(
  props: PatchworkToolProps<AccountLikeDoc | FolderDoc>,
) {
  const doc = makeDocumentProjection(props.handle);

  // When mounted on an account document, follow rootFolderUrl. When mounted
  // on a folder document, render the handle's own document as the tree.
  const [folder, folderHandle] = useDocument<FolderDoc>(
    () => ("rootFolderUrl" in doc ? doc.rootFolderUrl : props.handle.url),
    props,
  );

  function open(detail: OpenDocumentEventDetail) {
    props.element.dispatchEvent(createOpenEvent(detail));
  }

  const [isDraggingFile, setIsDraggingFile] = createSignal(false);

  return (
    <div class="folder-tree">
      <div class="folder-tree__filter-container">
        <SearchIcon />
        <input
          name="filter"
          class="folder-tree__filter"
          placeholder="Filter by title"
          value={filter()}
          onInput={(event) => setFilter(event.target.value.toLowerCase())}
        />
      </div>
      <nav
        class="folder-tree__doclist"
        classList={{
          "folder-tree__doclist--drag-over": isDraggingFile(),
        }}
        role="tree"
        aria-multiselectable="true"
        onDragOver={(event: DragEvent) => {
          // Only handle file drops from the OS
          if (event.dataTransfer?.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setIsDraggingFile(true);
          }
        }}
        onDragLeave={(event: DragEvent) => {
          const related = event.relatedTarget as Element;
          if (!related || !(event.currentTarget as Element).contains(related)) {
            setIsDraggingFile(false);
          }
        }}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          setIsDraggingFile(false);

          const files = event.dataTransfer?.files;
          if (files && files.length > 0 && folderHandle()) {
            const folderDoc = folderHandle()!.doc();
            const insertIndex = folderDoc?.docs?.length || 0;
            handleFilesDrop(
              files,
              folderHandle()!,
              props.repo,
              "inside",
              insertIndex,
            );
          }
        }}
      >
        <DocumentList
          depth={0}
          repo={props.repo}
          docs={folder()?.docs}
          handle={folderHandle.latest!}
          open={open}
          selectedDocUrls={[] as AutomergeUrl[]}
          element={props.element}
          rootFolderHandle={folderHandle.latest!}
        />
      </nav>
    </div>
  );
}
