import { useDocHandle } from "@automerge/automerge-repo-solid-primitives";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { DocWithComments } from "@inkandswitch/annotations-comments";
import type { AccountDoc } from "../types";
import {
  useSidebarState,
  useSidebarResize,
  useSelectedDocument,
  useAnnotations,
  useCommentThreads,
  useDebugRegistryToast,
  DebugRegistryToast,
} from "./hooks";
import { Sidebar } from "./components/Sidebar";
import { MainDocumentView } from "./components/MainDocumentView";
import { ensureAccountSubdocs } from "./account/ensureSubdocs";
import CommandPalette from "../commands/CommandPalette";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import "./styles.css";

const MIN_SIDEBAR_WIDTH = 48;
const MAX_SIDEBAR_WIDTH = 600;
const DRAG_THRESHOLD = 3;

export const PatchworkFrame = ({
  handle,
  element,
  repo,
}: {
  handle: DocHandle<AccountDoc>;
  element: HTMLElement | ShadowRoot;
  repo: Repo;
}) => {
  const accountDocHandle = useDocHandle<AccountDoc>(() => handle.url, { repo });

  // Lazily populate subdoc fields (rootFolderUrl, moduleSettingsUrl, contactUrl)
  // on first mount. Each is created via createDocOfDatatype2 of its own
  // datatype, so defaults and shape are owned by the datatype, not the frame.
  void ensureAccountSubdocs(handle, repo);

  const [docVersion, setDocVersion] = createSignal(0);

  createEffect(() => {
    const h = accountDocHandle();
    if (!h) return;
    const onChange = () => setDocVersion((v) => v + 1);
    h.on("change", onChange);
    onCleanup(() => h.off("change", onChange));
  });

  const accountDoc = createMemo(() => {
    docVersion();
    return accountDocHandle()?.doc();
  });

  // Sidebar state management
  const sidebarState = useSidebarState();

  // Sidebar resize handlers
  const { handleMouseDown, handleToggleClick } = useSidebarResize({
    setLeftSidebarWidth: sidebarState.setLeftSidebarWidth,
    setRightSidebarWidth: sidebarState.setRightSidebarWidth,
    setIsSidebarCollapsed: sidebarState.setIsSidebarCollapsed,
    setIsRightSidebarCollapsed: sidebarState.setIsRightSidebarCollapsed,
    minWidth: MIN_SIDEBAR_WIDTH,
    maxWidth: MAX_SIDEBAR_WIDTH,
    dragThreshold: DRAG_THRESHOLD,
  });

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
    <div class="frame">
      <DebugRegistryToast
        events={debugEvents()}
        onDismiss={dismissEvent}
        onClearAll={clearAll}
      />

      <CommandPalette
        repo={repo}
        accountDocHandle={handle}
        hive={(element as any).hive}
        sidebarState={{
          setIsSidebarCollapsed: (v: boolean) => sidebarState.setIsSidebarCollapsed(v),
          setIsRightSidebarCollapsed: (v: boolean) => sidebarState.setIsRightSidebarCollapsed(v),
          isSidebarCollapsed: sidebarState.isSidebarCollapsed,
          isRightSidebarCollapsed: sidebarState.isRightSidebarCollapsed,
        }}
      />

      {/* Left Sidebar */}
      {accountDoc()?.accountSidebarToolId && (
        <Sidebar
          side="left"
          isCollapsed={sidebarState.isSidebarCollapsed}
          width={sidebarState.leftSidebarWidth}
          toolId={accountDoc()!.accountSidebarToolId}
          docUrl={handle.url}
          onMouseDown={handleMouseDown}
          onToggleClick={handleToggleClick}
        />
      )}

      {/* Main Content Area */}
      <div class="main-area">
        <MainDocumentView
          viewKey={selectedDoc.viewKey}
          selectedDocUrl={selectedDoc.selectedDocUrl}
          toolId={() => selectedDoc.selectedView()?.toolId}
        />
      </div>

      {/* Right Sidebar */}
      {accountDoc()?.contextSidebarToolId && (
        <Sidebar
          side="right"
          isCollapsed={sidebarState.isRightSidebarCollapsed}
          width={sidebarState.rightSidebarWidth}
          toolId={accountDoc()!.contextSidebarToolId}
          docUrl={handle.url}
          onMouseDown={handleMouseDown}
          onToggleClick={handleToggleClick}
        />
      )}
    </div>
  );
};

export const renderPatchworkFrame: ToolImplementation<AccountDoc> = (
  handle,
  element
) => {
  return render(
    () => <PatchworkFrame handle={handle} element={element} repo={element.repo} />,
    element
  );
};
