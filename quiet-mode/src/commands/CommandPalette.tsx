import "./styles.css";
import {
  createSignal,
  createEffect,
  onCleanup,
  Show,
  type Accessor,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import {
  type DatatypeDescription,
  type ToolDescription,
  type Plugin,
  getSupportedToolsForType,
} from "@inkandswitch/patchwork-plugins";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import type { AutomergeRepoKeyhive } from "@automerge/automerge-repo-keyhive";

import {
  getCurrentDocHandle,
  dispatchOpenEvent,
  createNewDoc,
  filterMatches,
  useFilteredDatatypes,
  makeListKeyHandler,
} from "./utils.js";
import {
  saveDocToRootFolder as doSave,
  removeDocFromRootFolder as doRemove,
  submitRename as doRename,
} from "./actions.js";
import type {
  AccountDoc,
  Command,
  CommandCategory,
  CopyOption,
  DocLink,
  PanelMode,
  SidebarControls,
} from "./types.js";
import { CATEGORY_ORDER, CATEGORY_LABELS } from "./types.js";
import ButtonRow from "./ButtonRow.jsx";
import PanelArea from "./PanelArea.jsx";

export default function CommandPalette(props: {
  repo: Repo;
  accountDocHandle: DocHandle<AccountDoc>;
  hive?: AutomergeRepoKeyhive;
  sidebarState?: SidebarControls;
}) {
  // --- State ---

  const [isOpen, setIsOpen] = createSignal(false);
  const [panelMode, setPanelMode] = createSignal<PanelMode>("commands");

  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchHighlight, setSearchHighlight] = createSignal(0);
  const [docs, setDocs] = createStore<DocLink[]>([]);

  const [cmdQuery, setCmdQuery] = createSignal("");
  const [cmdHighlight, setCmdHighlight] = createSignal(0);

  const [createQuery, setCreateQuery] = createSignal("");
  const [createHighlight, setCreateHighlight] = createSignal(0);
  const datatypes = useFilteredDatatypes((item) => !item.unlisted);

  const [toolQuery, setToolQuery] = createSignal("");
  const [toolHighlight, setToolHighlight] = createSignal(0);
  const [availableTools, setAvailableTools] = createStore<
    Plugin<ToolDescription>[]
  >([]);

  const [renameValue, setRenameValue] = createSignal("");

  // Copy-url panel state
  const [copyQuery, setCopyQuery] = createSignal("");
  const [copyHighlight, setCopyHighlight] = createSignal(0);
  const [copyOptions, setCopyOptions] = createStore<CopyOption[]>([]);

  // Copy-url-tool panel state
  const [copyToolQuery, setCopyToolQuery] = createSignal("");
  const [copyToolHighlight, setCopyToolHighlight] = createSignal(0);
  const [copyToolOptions, setCopyToolOptions] = createStore<
    Plugin<ToolDescription>[]
  >([]);

  let folderHandle: DocHandle<FolderDoc> | undefined;

  // --- Derived state ---

  const isCurrentDocSaved = () => {
    const handle = getCurrentDocHandle();
    if (!handle) return true;
    return docs.some((d) => d.url === handle.url);
  };

  const filteredDocs: Accessor<DocLink[]> = () => {
    const q = searchQuery().toLowerCase();
    if (!q) return docs;
    return docs.filter((doc) => filterMatches(doc.name || "", q));
  };

  const filteredDatatypes = () => {
    const q = createQuery().toLowerCase();
    if (!q) return datatypes;
    return datatypes.filter((d) => d.name.toLowerCase().includes(q));
  };

  const filteredTools = () => {
    const q = toolQuery().toLowerCase();
    if (!q) return availableTools;
    return availableTools.filter((t) => t.name.toLowerCase().includes(q));
  };

  const filteredCopyOptions = () => {
    const q = copyQuery().toLowerCase();
    if (!q) return copyOptions;
    return copyOptions.filter((o) => o.label.toLowerCase().includes(q));
  };

  const filteredCopyToolOptions = () => {
    const q = copyToolQuery().toLowerCase();
    if (!q) return copyToolOptions;
    return copyToolOptions.filter((t) => t.name.toLowerCase().includes(q));
  };

  // --- Commands ---

  const commands = (): Command[] => {
    const cmds: Command[] = [];
    const accountDoc = props.accountDocHandle.doc();

    cmds.push({
      name: "/new",
      description: "Create a new document",
      category: "create",
      action: openNew,
    });

    cmds.push({
      name: "/copy-url",
      description: "Copy document URL to clipboard",
      category: "document",
      action: openCopyUrl,
    });

    if (isCurrentDocSaved()) {
      cmds.push({
        name: "/remove",
        description: "Remove current document from account root folder",
        category: "document",
        action: removeDocFromRootFolder,
      });
      cmds.push({
        name: "/rename",
        description: "Rename current document",
        category: "document",
        action: openRename,
      });
    }

    if (!isCurrentDocSaved()) {
      cmds.push({
        name: "/save",
        description: "Add current document to account root folder",
        category: "document",
        action: saveDocToRootFolder,
      });
    }

    cmds.push({
      name: "/tool",
      description: "Switch tool for current document",
      category: "document",
      action: openToolPicker,
    });

    cmds.push({
      name: "/account",
      description: "Open account picker",
      category: "account",
      action: () => {
        dispatchOpenEvent({
          url: props.accountDocHandle.url,
          toolId: "account-picker",
        });
        close();
      },
    });

    if (accountDoc?.accountHistoryUrl) {
      cmds.push({
        name: "/history",
        description: "Open account history",
        category: "account",
        action: () => {
          dispatchOpenEvent({
            url: accountDoc.accountHistoryUrl!,
            toolId: "account-history-viewer",
          });
          close();
        },
      });
    }

    if (accountDoc?.moduleSettingsUrl) {
      cmds.push({
        name: "/packages",
        description: "Open package manager",
        category: "account",
        action: () => {
          dispatchOpenEvent({ url: accountDoc.moduleSettingsUrl! });
          close();
        },
      });
    }

    cmds.push({
      name: "/search",
      description: "Search documents by title",
      category: "account",
      action: openSearch,
    });

    cmds.push({
      name: "/settings",
      description: "Open frame settings",
      category: "account",
      action: () => {
        dispatchOpenEvent({
          url: props.accountDocHandle.url,
          toolId: "frame-configurator",
        });
        close();
      },
    });

    if (props.sidebarState) {
      const sb = props.sidebarState;

      if (sb.isSidebarCollapsed()) {
        cmds.push({
          name: "/show left-sidebar",
          description: "Show the left sidebar",
          category: "view",
          action: () => { sb.setIsSidebarCollapsed(false); close(); },
        });
      }
      if (sb.isRightSidebarCollapsed()) {
        cmds.push({
          name: "/show right-sidebar",
          description: "Show the right sidebar",
          category: "view",
          action: () => { sb.setIsRightSidebarCollapsed(false); close(); },
        });
      }
      if (!sb.isSidebarCollapsed()) {
        cmds.push({
          name: "/hide left-sidebar",
          description: "Hide the left sidebar",
          category: "view",
          action: () => { sb.setIsSidebarCollapsed(true); close(); },
        });
      }
      if (!sb.isRightSidebarCollapsed()) {
        cmds.push({
          name: "/hide right-sidebar",
          description: "Hide the right sidebar",
          category: "view",
          action: () => { sb.setIsRightSidebarCollapsed(true); close(); },
        });
      }
    }

    return cmds;
  };

  const filteredCommands = () => {
    const q = cmdQuery().toLowerCase().trim();
    if (!q) return commands();
    const withSlash = q.startsWith("/") ? q : "/" + q;
    return commands().filter((c) => c.name.toLowerCase().startsWith(withSlash));
  };

  const groupedCommands = () => {
    const cmds = filteredCommands();
    const groups: {
      category: CommandCategory;
      label: string;
      items: Command[];
    }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const items = cmds.filter((c) => c.category === cat);
      if (items.length > 0) {
        groups.push({ category: cat, label: CATEGORY_LABELS[cat], items });
      }
    }
    return groups;
  };

  // --- Effects ---

  createEffect(() => {
    if (!isOpen()) return;
    const accountDoc = props.accountDocHandle.doc();
    if (!accountDoc?.rootFolderUrl) return;
    const loadDocs = async () => {
      const handle = await props.repo.find<FolderDoc>(accountDoc.rootFolderUrl);
      folderHandle = handle;
      const folder = handle.doc();
      if (folder?.docs) {
        setDocs(reconcile(folder.docs as DocLink[]));
      }
    };
    loadDocs();
  });

  // --- Lifecycle ---

  function open() {
    setIsOpen(true);
    setPanelMode("commands");
    setCmdQuery("");
    setCmdHighlight(0);
  }

  function close() {
    queueMicrotask(() => {
      setPanelMode("commands");
      setCmdQuery("");
      setCmdHighlight(0);
      setSearchQuery("");
      setSearchHighlight(0);
      setCreateQuery("");
      setCreateHighlight(0);
      setToolQuery("");
      setToolHighlight(0);
      setRenameValue("");
      setCopyQuery("");
      setCopyHighlight(0);
      setCopyToolQuery("");
      setCopyToolHighlight(0);
      setIsOpen(false);
    });
  }

  function backToCommands() {
    setPanelMode("commands");
  }

  // --- Panel openers ---

  function openSearch() {
    setPanelMode("search");
    setSearchQuery("");
    setSearchHighlight(0);
  }

  function openNew() {
    setPanelMode("new");
    setCreateQuery("");
    setCreateHighlight(0);
  }

  function openToolPicker() {
    const handle = getCurrentDocHandle();
    if (!handle) return;
    const doc = handle.doc();
    const docType = doc?.["@patchwork"]?.type;
    if (!docType) return;
    setAvailableTools(
      reconcile(getSupportedToolsForType(docType).filter((t) => !t.unlisted))
    );
    setPanelMode("tool");
    setToolQuery("");
    setToolHighlight(0);
  }

  function openRename() {
    const handle = getCurrentDocHandle();
    if (!handle) return;
    const docLink = docs.find((d) => d.url === handle.url);
    setRenameValue(docLink?.name || "Untitled");
    setPanelMode("rename");
  }

  function openCopyUrl() {
    const handle = getCurrentDocHandle();
    if (!handle) return;

    const url = handle.url;
    const patchworkBase = `${location.protocol}//${location.host}/#doc=${handle.documentId}`;

    const doc = handle.doc();
    const docType = doc?.["@patchwork"]?.type;
    const hasTools =
      docType &&
      getSupportedToolsForType(docType).filter((t) => !t.unlisted).length > 0;

    const options: CopyOption[] = [
      { label: "Automerge URL", url },
      { label: "Patchwork URL", url: patchworkBase },
    ];
    if (hasTools) {
      options.push({ label: "Patchwork URL with tool...", url: "" });
    }

    setCopyOptions(reconcile(options));
    setPanelMode("copy-url");
    setCopyQuery("");
    setCopyHighlight(0);
  }

  function openCopyUrlTool() {
    const handle = getCurrentDocHandle();
    if (!handle) return;

    const doc = handle.doc();
    const docType = doc?.["@patchwork"]?.type;
    if (!docType) return;

    const tools = getSupportedToolsForType(docType).filter((t) => !t.unlisted);
    setCopyToolOptions(reconcile(tools));
    setPanelMode("copy-url-tool");
    setCopyToolQuery("");
    setCopyToolHighlight(0);
  }

  async function selectCopyOption(option: CopyOption) {
    if (!option.url) {
      openCopyUrlTool();
      return;
    }
    await navigator.clipboard.writeText(option.url);
    close();
  }

  async function selectCopyTool(tool: Plugin<ToolDescription>) {
    const handle = getCurrentDocHandle();
    if (!handle) return;
    const patchworkBase = `${location.protocol}//${location.host}/#doc=${handle.documentId}`;
    await navigator.clipboard.writeText(`${patchworkBase}&tool=${tool.id}`);
    close();
  }

  // --- Actions (delegate to actions.ts) ---

  function selectTool(tool: Plugin<ToolDescription>) {
    const handle = getCurrentDocHandle();
    if (!handle) return;
    dispatchOpenEvent({ url: handle.url, toolId: tool.id });
    close();
  }

  async function selectDatatype(datatype: Plugin<DatatypeDescription>) {
    const freshy = await createNewDoc(props.repo, datatype, props.hive);
    if (folderHandle) {
      folderHandle.change((doc: FolderDoc) => {
        doc.docs.push(freshy);
      });
    }
    dispatchOpenEvent(freshy);
    close();
  }

  async function saveDocToRootFolder() {
    await doSave(props.accountDocHandle, props.repo, isCurrentDocSaved);
    close();
  }

  async function removeDocFromRootFolder() {
    await doRemove(props.accountDocHandle, props.repo);
    close();
  }

  async function handleSubmitRename() {
    await doRename(renameValue(), props.accountDocHandle, props.repo);
    close();
  }

  // --- Keyboard ---

  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      isOpen() ? close() : open();
    }
    if (e.key === "Escape" && isOpen()) {
      e.preventDefault();
      if (panelMode() === "copy-url-tool") {
        openCopyUrl();
      } else if (panelMode() !== "commands") {
        backToCommands();
      } else {
        close();
      }
    }
  };

  document.addEventListener("keydown", handleGlobalKeyDown);
  onCleanup(() => document.removeEventListener("keydown", handleGlobalKeyDown));

  const handleCmdKeyDown = makeListKeyHandler(
    () => filteredCommands().length,
    cmdHighlight,
    setCmdHighlight,
    () => {
      const cmd = filteredCommands()[cmdHighlight()];
      if (cmd) cmd.action();
    }
  );

  const handleSearchKeyDown = makeListKeyHandler(
    () => filteredDocs().length,
    searchHighlight,
    setSearchHighlight,
    () => {
      const doc = filteredDocs()[searchHighlight()];
      if (doc) {
        dispatchOpenEvent({ url: doc.url, title: doc.name, type: doc.type });
        close();
      }
    }
  );

  const handleNewKeyDown = makeListKeyHandler(
    () => filteredDatatypes().length,
    createHighlight,
    setCreateHighlight,
    () => {
      const dt = filteredDatatypes()[createHighlight()];
      if (dt) selectDatatype(dt);
    }
  );

  const handleToolKeyDown = makeListKeyHandler(
    () => filteredTools().length,
    toolHighlight,
    setToolHighlight,
    () => {
      const tool = filteredTools()[toolHighlight()];
      if (tool) selectTool(tool);
    }
  );

  const handleCopyKeyDown = makeListKeyHandler(
    () => filteredCopyOptions().length,
    copyHighlight,
    setCopyHighlight,
    () => {
      const option = filteredCopyOptions()[copyHighlight()];
      if (option) selectCopyOption(option);
    }
  );

  const handleCopyToolKeyDown = makeListKeyHandler(
    () => filteredCopyToolOptions().length,
    copyToolHighlight,
    setCopyToolHighlight,
    () => {
      const tool = filteredCopyToolOptions()[copyToolHighlight()];
      if (tool) selectCopyTool(tool);
    }
  );

  function togglePanel(mode: PanelMode) {
    const openers: Record<string, () => void> = {
      new: openNew,
      search: openSearch,
      tool: openToolPicker,
      rename: openRename,
      "copy-url": openCopyUrl,
    };
    panelMode() === mode ? backToCommands() : openers[mode]?.();
  }

  // --- Render ---

  return (
    <Show when={isOpen()}>
      <div class="cmd-palette-backdrop" onClick={close}>
        <div class="cmd-palette-layout">
          <ButtonRow
            panelMode={panelMode}
            isCurrentDocSaved={isCurrentDocSaved}
            accountDocHandle={props.accountDocHandle}
            togglePanel={togglePanel}
            saveDocToRootFolder={saveDocToRootFolder}
            removeDocFromRootFolder={removeDocFromRootFolder}
            close={close}
          />
          <PanelArea
            panelMode={panelMode}
            backToCommands={backToCommands}
            close={close}
            cmdQuery={cmdQuery}
            setCmdQuery={setCmdQuery}
            cmdHighlight={cmdHighlight}
            setCmdHighlight={setCmdHighlight}
            filteredCommands={filteredCommands}
            groupedCommands={groupedCommands}
            handleCmdKeyDown={handleCmdKeyDown}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchHighlight={searchHighlight}
            setSearchHighlight={setSearchHighlight}
            filteredDocs={filteredDocs}
            handleSearchKeyDown={handleSearchKeyDown}
            createQuery={createQuery}
            setCreateQuery={setCreateQuery}
            createHighlight={createHighlight}
            setCreateHighlight={setCreateHighlight}
            filteredDatatypes={filteredDatatypes}
            handleNewKeyDown={handleNewKeyDown}
            selectDatatype={selectDatatype}
            toolQuery={toolQuery}
            setToolQuery={setToolQuery}
            toolHighlight={toolHighlight}
            setToolHighlight={setToolHighlight}
            filteredTools={filteredTools}
            handleToolKeyDown={handleToolKeyDown}
            selectTool={selectTool}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            submitRename={handleSubmitRename}
            copyQuery={copyQuery}
            setCopyQuery={setCopyQuery}
            copyHighlight={copyHighlight}
            setCopyHighlight={setCopyHighlight}
            filteredCopyOptions={filteredCopyOptions}
            handleCopyKeyDown={handleCopyKeyDown}
            selectCopyOption={selectCopyOption}
            copyToolQuery={copyToolQuery}
            setCopyToolQuery={setCopyToolQuery}
            copyToolHighlight={copyToolHighlight}
            setCopyToolHighlight={setCopyToolHighlight}
            filteredCopyToolOptions={filteredCopyToolOptions}
            handleCopyToolKeyDown={handleCopyToolKeyDown}
            selectCopyTool={selectCopyTool}
            openCopyUrl={openCopyUrl}
          />
        </div>
      </div>
    </Show>
  );
}
