import { useDocHandle } from "@automerge/automerge-repo-solid-primitives";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { DocWithComments } from "@inkandswitch/annotations-comments";
import type { AccountDoc } from "../types";
import {
  useSelectedDocument,
  useAnnotations,
  useCommentThreads,
  useDebugRegistryToast,
  DebugRegistryToast,
} from "./hooks";
import { MainDocumentView } from "./components/MainDocumentView";
import { ensureAccountSubdocs } from "./account/ensureSubdocs";
import CommandPalette from "../commands/CommandPalette";
import "./styles.css";

export const PatchworkFrame = ({
  handle,
  element,
  repo,
}: {
  handle: DocHandle<AccountDoc>;
  element: HTMLElement | ShadowRoot;
  repo: Repo;
}) => {
  // Lazily populate subdoc fields (rootFolderUrl, moduleSettingsUrl, contactUrl)
  // on first mount. Each is created via createDocOfDatatype2 of its own
  // datatype, so defaults and shape are owned by the datatype, not the frame.
  void ensureAccountSubdocs(handle, repo);

  // Selected document management
  const selectedDoc = useSelectedDocument({
    element,
    repo,
  });

  // Comment threads for selected document
  const commentThreadsWithRef = useCommentThreads(
    () =>
      selectedDoc.selectedDocHandle() as DocHandle<DocWithComments> | undefined,
    repo
  );

  // Annotations management
  useAnnotations({
    selectedDocRef: selectedDoc.selectedDocRef,
    commentThreadsWithRef,
  });

  // Debug registry toast
  const {
    events: debugEvents,
    dismissEvent,
    clearAll,
  } = useDebugRegistryToast();

  return (
    <div class="flex w-full h-full">
      <DebugRegistryToast
        events={debugEvents()}
        onDismiss={dismissEvent}
        onClearAll={clearAll}
      />

      <CommandPalette
        repo={repo}
        accountDocHandle={handle}
        hive={(element as any).hive}
      />

      {/* Main Content Area */}
      <div class="flex flex-col flex-1 h-full">
        <MainDocumentView
          viewKey={selectedDoc.viewKey}
          selectedDocUrl={selectedDoc.selectedDocUrl}
          toolId={() => selectedDoc.selectedView()?.toolId}
        />
      </div>
    </div>
  );
};
