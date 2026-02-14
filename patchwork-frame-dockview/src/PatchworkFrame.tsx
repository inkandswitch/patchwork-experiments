import {
  useDocHandle,
  useDocument,
  useDocuments,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import { DocHandle } from "@automerge/automerge-repo";
import {
  AutomergeUrl,
  encodeHeads,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
} from "@automerge/vanillajs";
import { OpenDocumentEvent } from "@inkandswitch/patchwork-elements";
import { AnnotationSet } from "@inkandswitch/annotations";
import { annotations as globalAnnotations } from "@inkandswitch/annotations-context";
import { ViewHeads } from "@inkandswitch/annotations-diff";
import { IsSelected } from "@inkandswitch/annotations-selection";
import { useSubscribe } from "@inkandswitch/subscribables-react";
import { ref, RefOfType } from "@inkandswitch/patchwork-refs";
import {
  DatatypeDescription,
  DatatypeImplementation,
  getRegistry,
} from "@inkandswitch/patchwork-plugins";
import { PluginRegistry } from "@inkandswitch/patchwork-plugins/dist/registry/registry";
import { HasPatchworkMetadata } from "@inkandswitch/patchwork-filesystem";
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  startTransition,
  type CSSProperties,
} from "react";
import { useUpdateDocLinksOfActiveDocumentsEffect } from "./effects";
import "./styles.css";
import { TinyPatchworkConfigDoc } from "./types";
import {
  DebugRegistryToast,
  useDebugRegistryToast,
} from "./useDebugRegistryToast";
import {
  CommentThread,
  DocWithComments,
  SerializedCommentThread,
} from "@inkandswitch/annotations-comments";
import { commentThreadsWithRefOfDoc } from "@inkandswitch/annotations-comments";
import {
  DockviewApi,
  DockviewReact,
  DockviewReadyEvent,
  IDockviewPanelProps,
} from "dockview";

// Declare the patchwork-view custom element for TypeScript
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "patchwork-view": {
        "doc-url"?: string;
        "tool-id"?: string;
        class?: string;
        key?: string | number;
        style?: CSSProperties;
      };
    }
  }
}

type OpenView = { url: AutomergeUrl; toolId?: string };
type DockviewPanelParams = {
  docUrl: AutomergeUrl;
  toolId?: string;
  documentToolbarToolIds?: string[];
};

const LEFT_SIDEBAR_PANEL_ID = "sidebar-left";
const RIGHT_SIDEBAR_PANEL_ID = "sidebar-right";

const PatchworkDocPanel = ({
  params,
}: IDockviewPanelProps<DockviewPanelParams>) => {
  return (
    <div className="w-full h-full">
      {params.documentToolbarToolIds &&
        params.documentToolbarToolIds.length > 0 && (
          <div className="p-2 bg-base-200 border-b border-base-300 flex items-center gap-2 flex-start">
            {params.documentToolbarToolIds.map((toolId, index) => (
              <patchwork-view
                class="!w-fit !h-8 !overflow-hidden !flex"
                doc-url={params.docUrl}
                tool-id={toolId}
                key={index}
              />
            ))}
          </div>
        )}
      <patchwork-view
        key={`${params.docUrl}::${params.toolId ?? ""}`}
        doc-url={params.docUrl}
        tool-id={params.toolId}
      />
    </div>
  );
};

const PatchworkSidebarPanel = ({
  params,
}: IDockviewPanelProps<DockviewPanelParams>) => {
  return (
    <div className="w-full h-full">
      <patchwork-view doc-url={params.docUrl} tool-id={params.toolId} />
    </div>
  );
};

export const PatchworkFrame = ({
  docUrl: accountDocUrl,
  element,
}: {
  docUrl: AutomergeUrl;
  element: HTMLElement | ShadowRoot;
}) => {
  const [accountDoc] = useDocument<TinyPatchworkConfigDoc>(
    accountDocUrl,
    {
      suspense: true,
    }
  );

  const { rootFolderUrl, accountSidebarToolId, contextSidebarToolId } =
    accountDoc;

  const [activeView, setActiveView] = useState<OpenView | undefined>(undefined);
  const [dockviewApi, setDockviewApi] = useState<DockviewApi | null>(null);
  const [pendingOpen, setPendingOpen] = useState<OpenView[]>([]);
  const lastOpenRef = useRef<{ id: string; at: number } | null>(null);
  const [openDocPanels, setOpenDocPanels] = useState<Map<string, OpenView>>(
    () => new Map()
  );
  const lastDocPanelIdRef = useRef<string | null>(null);
  const openDocUrls = useMemo(() => {
    return Array.from(new Set(Array.from(openDocPanels.values()).map((v) => v.url)));
  }, [openDocPanels]);
  const [openDocsMap] = useDocuments<HasPatchworkMetadata>(openDocUrls);
  const [dockviewTheme, setDockviewTheme] = useState(() => {
    const dataTheme = document.documentElement.getAttribute("data-theme");
    if (dataTheme === "dark") {
      return "dockview-theme-abyss";
    }
    if (dataTheme === "light") {
      return "dockview-theme-light";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dockview-theme-abyss"
      : "dockview-theme-light";
  });

  // Debug registry toast
  const {
    events: debugEvents,
    dismissEvent,
    clearAll,
  } = useDebugRegistryToast();

  const selectedDocHandle = useDocHandle(activeView?.url);
  const selectedDocRef = useMemo(
    () => (selectedDocHandle ? ref(selectedDocHandle) : undefined),
    [selectedDocHandle]
  );

  const selectedDocAnnotations = useSubscribe(
    useMemo(
      () =>
        selectedDocRef ? globalAnnotations.onRef(selectedDocRef) : undefined,
      [selectedDocRef]
    )
  );

  const viewHeads = selectedDocAnnotations?.lookup(ViewHeads);

  const selectedDocUrl = useMemo(() => {
    if (!activeView?.url) {
      return undefined;
    }

    if (!viewHeads) {
      return activeView.url;
    }

    const currentDocumentId = parseAutomergeUrl(activeView.url).documentId;
    return stringifyAutomergeUrl({
      documentId: currentDocumentId,
      heads: encodeHeads(viewHeads.afterHeads),
    });
  }, [activeView?.url, viewHeads]);

  //  Contribute annotations to the global context
  const commentThreadsWithRef = useCommentThreadsWithRefOfDoc(
    selectedDocHandle as DocHandle<DocWithComments>
  );
  const annotations = useMemo(() => new AnnotationSet(), []);
  useEffect(() => {
    if (!selectedDocRef) {
      return;
    }

    globalAnnotations.add(annotations);

    annotations.change(() => {
      annotations.clear();

      // selection
      annotations.add(selectedDocRef, IsSelected(true));

      // comment threads
      for (const [threadRef, thread] of commentThreadsWithRef) {
        for (const ref of thread.refs) {
          if (threadRef.value()?.isResolved) {
            continue;
          }

          annotations.add(ref, CommentThread(threadRef));
        }
      }
    });

    return () => {
      globalAnnotations.remove(annotations);
    };
  }, [
    annotations,
    selectedDocAnnotations,
    selectedDocRef,
    commentThreadsWithRef,
  ]);

  // Effects
  // this should be probably a plugin type that allows to run code without rendering something

  useUpdateDocLinksOfActiveDocumentsEffect(rootFolderUrl);
  //todo disabling this until it supports folders
  // useAddUnknownDocumentsToSidebarEffect(rootFolderUrl);

  const panelIdFor = useCallback((view: OpenView) => {
    const { documentId } = parseAutomergeUrl(view.url);
    return `${documentId}::${view.toolId ?? ""}`;
  }, []);

  useEffect(() => {
    if (!dockviewApi || !activeView || !selectedDocHandle) {
      return;
    }

    const doc = selectedDocHandle.doc() as HasPatchworkMetadata | undefined;
    const type = doc?.["@patchwork"]?.type;
    if (!type) {
      return;
    }

    let cancelled = false;
    const registry = getRegistry("patchwork:datatype") as PluginRegistry<
      DatatypeDescription,
      DatatypeImplementation
    >;
    registry.load(type).then((datatype) => {
      if (cancelled || !datatype) {
        return;
      }

      const title = datatype.module.getTitle(doc as HasPatchworkMetadata);
      const panel = dockviewApi.getPanel(panelIdFor(activeView)) as
        | { setTitle?: (next: string) => void }
        | undefined;
      if (!panel?.setTitle) {
        return;
      }

      panel.setTitle(
        activeView.toolId ? `${title} · ${activeView.toolId}` : title
      );
    });

    return () => {
      cancelled = true;
    };
  }, [activeView, dockviewApi, panelIdFor, selectedDocHandle]);

  const panelTitleFor = useCallback((view: OpenView) => {
    if (view.toolId) {
      return view.toolId;
    }

    const { documentId } = parseAutomergeUrl(view.url);
    return documentId.slice(0, 8);
  }, []);

  const docPanelPosition = useCallback(() => {
    if (!dockviewApi) {
      return undefined;
    }

    const preferredPanelId = lastDocPanelIdRef.current;
    if (preferredPanelId) {
      return { referencePanel: preferredPanelId, direction: "within" };
    }

    if (dockviewApi.getPanel(LEFT_SIDEBAR_PANEL_ID)) {
      return { referencePanel: LEFT_SIDEBAR_PANEL_ID, direction: "right" };
    }
    if (dockviewApi.getPanel(RIGHT_SIDEBAR_PANEL_ID)) {
      return { referencePanel: RIGHT_SIDEBAR_PANEL_ID, direction: "left" };
    }

    return undefined;
  }, [dockviewApi]);

  const openPanelForDocument = useCallback(
    (view: OpenView) => {
      const id = panelIdFor(view);
      if (!dockviewApi) {
        setPendingOpen((current) => {
          if (current.some((entry) => panelIdFor(entry) === id)) {
            return current;
          }
          return [...current, view];
        });
        return;
      }

      let panel = dockviewApi.getPanel(id) as
        | {
            setActive?: () => void;
            updateParameters?: (params: DockviewPanelParams) => void;
            setTitle?: (title: string) => void;
          }
        | undefined;
      if (!panel) {
        panel = dockviewApi.addPanel({
          id,
          component: "patchwork-doc",
          title: panelTitleFor(view),
          params: {
            docUrl: view.url,
            toolId: view.toolId,
            documentToolbarToolIds: accountDoc.documentToolbarToolIds ?? [],
          },
          position: docPanelPosition(),
        });
      } else {
        panel.updateParameters?.({
          docUrl: view.url,
          toolId: view.toolId,
          documentToolbarToolIds: accountDoc.documentToolbarToolIds ?? [],
        });
        panel.setTitle?.(panelTitleFor(view));
      }

      panel?.setActive?.();
    },
    [
      accountDoc.documentToolbarToolIds,
      dockviewApi,
      docPanelPosition,
      panelIdFor,
      panelTitleFor,
    ]
  );

  useEffect(() => {
    if (!dockviewApi || pendingOpen.length === 0) {
      return;
    }

    pendingOpen.forEach((view) => openPanelForDocument(view));
    setPendingOpen([]);
  }, [dockviewApi, openPanelForDocument, pendingOpen]);

  useEffect(() => {
    if (!dockviewApi) {
      return;
    }

    const addDisposable = dockviewApi.onDidAddPanel((panel) => {
      if (
        panel.id === LEFT_SIDEBAR_PANEL_ID ||
        panel.id === RIGHT_SIDEBAR_PANEL_ID
      ) {
        return;
      }

      const params = panel.params as DockviewPanelParams | undefined;
      if (!params?.docUrl) {
        return;
      }

      lastDocPanelIdRef.current = panel.id;
      setOpenDocPanels((current) => {
        const next = new Map(current);
        next.set(panel.id, { url: params.docUrl, toolId: params.toolId });
        return next;
      });
    });

    const removeDisposable = dockviewApi.onDidRemovePanel((panel) => {
      setOpenDocPanels((current) => {
        if (!current.has(panel.id)) {
          return current;
        }
        const next = new Map(current);
        next.delete(panel.id);
        if (lastDocPanelIdRef.current === panel.id) {
          lastDocPanelIdRef.current = next.keys().next().value ?? null;
        }
        return next;
      });
    });

    return () => {
      addDisposable.dispose();
      removeDisposable.dispose();
    };
  }, [dockviewApi]);

  useEffect(() => {
    if (!dockviewApi || openDocPanels.size === 0) {
      return;
    }

    let cancelled = false;
    const registry = getRegistry("patchwork:datatype") as PluginRegistry<
      DatatypeDescription,
      DatatypeImplementation
    >;

    openDocPanels.forEach((view, panelId) => {
      const doc = openDocsMap.get(view.url);
      const type = doc?.["@patchwork"]?.type;
      if (!doc || !type) {
        return;
      }

      registry.load(type).then((datatype) => {
        if (cancelled || !datatype) {
          return;
        }

        const title = datatype.module.getTitle(doc);
        const panel = dockviewApi.getPanel(panelId) as
          | { setTitle?: (next: string) => void }
          | undefined;
        if (!panel?.setTitle) {
          return;
        }

        panel.setTitle(view.toolId ? `${title} · ${view.toolId}` : title);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [dockviewApi, openDocPanels, openDocsMap]);

  useEffect(() => {
    if (!dockviewApi || openDocPanels.size === 0) {
      return;
    }

    openDocPanels.forEach((view, panelId) => {
      const panel = dockviewApi.getPanel(panelId) as
        | { updateParameters?: (params: DockviewPanelParams) => void }
        | undefined;
      if (!panel?.updateParameters) {
        return;
      }
      panel.updateParameters({
        docUrl: view.url,
        toolId: view.toolId,
        documentToolbarToolIds: accountDoc.documentToolbarToolIds ?? [],
      });
    });
  }, [accountDoc.documentToolbarToolIds, dockviewApi, openDocPanels]);

  useEffect(() => {
    if (!dockviewApi) {
      return;
    }

    const disposable = dockviewApi.onDidActivePanelChange((panel) => {
      if (!panel) {
        return;
      }
      const params = panel?.params as DockviewPanelParams | undefined;
      if (!params?.docUrl) {
        startTransition(() => {
          setActiveView(undefined);
        });
        return;
      }

      if (
        panel.id !== LEFT_SIDEBAR_PANEL_ID &&
        panel.id !== RIGHT_SIDEBAR_PANEL_ID
      ) {
        lastDocPanelIdRef.current = panel.id;
      }

      startTransition(() => {
        setActiveView({ url: params.docUrl, toolId: params.toolId });
      });
    });

    return () => {
      disposable.dispose();
    };
  }, [dockviewApi]);

  const handleDockviewReady = useCallback((event: DockviewReadyEvent) => {
    event.api.updateOptions({
      hideBorders: false,
      singleTabMode: "default",
    });
    setDockviewApi(event.api);
  }, []);

  useEffect(() => {
    if (!dockviewApi) {
      return;
    }

    if (accountSidebarToolId) {
      const existing = dockviewApi.getPanel(LEFT_SIDEBAR_PANEL_ID) as
        | {
            setTitle: (title: string) => void;
            updateParameters?: (params: DockviewPanelParams) => void;
          }
        | undefined;
      if (!existing) {
        dockviewApi.addPanel({
          id: LEFT_SIDEBAR_PANEL_ID,
          component: "patchwork-sidebar",
          title: "Account",
          params: { docUrl: accountDocUrl, toolId: accountSidebarToolId },
          position: { direction: "left" },
          initialWidth: 250,
          minimumWidth: 200,
        });
      } else {
        existing.setTitle("Account");
        existing.updateParameters?.({
          docUrl: accountDocUrl,
          toolId: accountSidebarToolId,
        });
      }
    } else {
      (dockviewApi.getPanel(LEFT_SIDEBAR_PANEL_ID) as { close?: () => void })
        ?.close?.();
    }

    if (contextSidebarToolId) {
      const existing = dockviewApi.getPanel(RIGHT_SIDEBAR_PANEL_ID) as
        | {
            setTitle: (title: string) => void;
            updateParameters?: (params: DockviewPanelParams) => void;
          }
        | undefined;
      if (!existing) {
        dockviewApi.addPanel({
          id: RIGHT_SIDEBAR_PANEL_ID,
          component: "patchwork-sidebar",
          title: "Context",
          params: { docUrl: accountDocUrl, toolId: contextSidebarToolId },
          position: { direction: "right" },
          initialWidth: 250,
          minimumWidth: 200,
        });
      } else {
        existing.setTitle("Context");
        existing.updateParameters?.({
          docUrl: accountDocUrl,
          toolId: contextSidebarToolId,
        });
      }
    } else {
      (dockviewApi.getPanel(RIGHT_SIDEBAR_PANEL_ID) as { close?: () => void })
        ?.close?.();
    }
  }, [accountDocUrl, accountSidebarToolId, contextSidebarToolId, dockviewApi]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      const dataTheme = document.documentElement.getAttribute("data-theme");
      if (dataTheme === "dark") {
        setDockviewTheme("dockview-theme-abyss");
        return;
      }
      if (dataTheme === "light") {
        setDockviewTheme("dockview-theme-light");
        return;
      }
      setDockviewTheme(
        mediaQuery.matches ? "dockview-theme-abyss" : "dockview-theme-light"
      );
    };

    updateTheme();
    mediaQuery.addEventListener("change", updateTheme);

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      mediaQuery.removeEventListener("change", updateTheme);
      observer.disconnect();
    };
  }, []);

  // listen to open document events
  useEffect(() => {
    const onOpenDocument = (event: OpenDocumentEvent) => {
      event.stopPropagation();
      event.stopImmediatePropagation();

      const view = {
        url: event.detail.url,
        toolId: event.detail.toolId,
      };
      const id = panelIdFor(view);
      const now = performance.now();
      if (
        lastOpenRef.current &&
        lastOpenRef.current.id === id &&
        now - lastOpenRef.current.at < 250
      ) {
        return;
      }

      const activePanelId = dockviewApi?.activePanel?.id;
      if (activePanelId === id) {
        return;
      }

      lastOpenRef.current = { id, at: now };
      startTransition(() => {
        openPanelForDocument(view);
      });
    };

    element.addEventListener(
      "patchwork:open-document",
      onOpenDocument as EventListener
    );

    return () => {
      (element as HTMLElement).removeEventListener(
        "patchwork:open-document",
        onOpenDocument
      );
    };
  }, [dockviewApi, element, openPanelForDocument, panelIdFor]);

  // Add current handle to window
  useEffect(() => {
    (window as any).currentDocHandle = selectedDocRef?.docHandle;
  }, [selectedDocRef]);

  return (
    <div className="w-screen h-screen flex">
      <DebugRegistryToast
        events={debugEvents}
        onDismiss={dismissEvent}
        onClearAll={clearAll}
      />
      <div className="flex flex-col flex-1 h-full">
        {/* Dockview workspace (sidebars are dock panels) */}
        <div className="w-full flex-1 min-h-0 relative">
          <DockviewReact
            className={`${dockviewTheme} w-full h-full`}
            components={{
              "patchwork-doc": PatchworkDocPanel,
              "patchwork-sidebar": PatchworkSidebarPanel,
            }}
            onReady={handleDockviewReady}
          />
          {!selectedDocUrl && (
            <div className="absolute inset-0 flex items-center justify-center text-base-content pointer-events-none">
              Select a document in the sidebar
            </div>
          )}
        </div> 
      </div>
    </div>
  );
};

export const useCommentThreadsWithRefOfDoc = (
  docHandle?: DocHandle<DocWithComments>
) => {
  const repo = useRepo();
  const [doc] = useDocument(docHandle?.url);
  const [commentThreadsWithRef, setCommentThreadsWithRef] = useState<
    [RefOfType<SerializedCommentThread>, CommentThread][]
  >([]);

  useEffect(() => {
    let cancelled = false;
    if (!docHandle) {
      return;
    }

    commentThreadsWithRefOfDoc(docHandle, repo).then((threadsWithRef) => {
      if (cancelled) {
        return;
      }
      setCommentThreadsWithRef(threadsWithRef);
    });

    return () => {
      cancelled = true;
    };
  }, [docHandle, repo, doc]);

  return commentThreadsWithRef;
};
