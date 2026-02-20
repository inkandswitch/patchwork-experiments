import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { toolify } from "@inkandswitch/patchwork-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createWorkspaceRepo, type WorkspaceOverlay } from "./scoped-elements/workspace-repo";
import { OpenDocumentEvent } from "./scoped-elements/events";
import type { WorkspaceDoc } from "./types";

type ReactToolProps = {
  docUrl: AutomergeUrl;
  element: any;
};

type TreeNode = {
  name: string;
  url: AutomergeUrl;
  type: string;
  docType: string;
  children?: TreeNode[];
};

async function buildTree(repo: Repo, folderUrl: AutomergeUrl): Promise<TreeNode[]> {
  try {
    const handle = await repo.find<any>(folderUrl);
    await handle.whenReady();
    const doc = handle.doc();
    if (!doc?.docs) return [];

    const nodes: TreeNode[] = [];
    for (const link of doc.docs) {
      if (link.type === "folder") {
        const children = await buildTree(repo, link.url);
        nodes.push({
          name: link.name,
          url: link.url,
          type: "folder",
          docType: "folder",
          children,
        });
      } else {
        let docType = "file";
        try {
          const childHandle = await repo.find<any>(link.url);
          await childHandle.whenReady();
          const childDoc = childHandle.doc();
          docType = childDoc?.["@patchwork"]?.type ?? "file";
        } catch {}
        nodes.push({
          name: link.name,
          url: link.url,
          type: link.type || "file",
          docType,
        });
      }
    }
    return nodes;
  } catch {
    return [];
  }
}

const WorkspaceBrowser = ({ docUrl }: ReactToolProps) => {
  const repo = useRepo();
  const scopeRef = useRef<HTMLElement>(null);
  const [selectedUrl, setSelectedUrl] = useState<AutomergeUrl | null>(null);
  const [wsRepo, setWsRepo] = useState<Repo | null>(null);
  const [scopeReady, setScopeReady] = useState(false);
  const [doc] = useDocument<WorkspaceDoc>(docUrl);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    repo.find<WorkspaceOverlay>(docUrl).then((wsHandle) => {
      if (cancelled) return;
      setWsRepo(createWorkspaceRepo(repo, wsHandle));
    });
    return () => {
      cancelled = true;
    };
  }, [repo, docUrl]);

  useLayoutEffect(() => {
    if (scopeRef.current && wsRepo) {
      (scopeRef.current as any).repo = wsRepo;
      setScopeReady(true);
    } else {
      setScopeReady(false);
    }
  }, [wsRepo]);

  useEffect(() => {
    if (!wsRepo || !doc?.rootFolderUrl) return;
    let cancelled = false;

    setLoading(true);
    buildTree(wsRepo, doc.rootFolderUrl).then((nodes) => {
      if (!cancelled) {
        setTree(nodes);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [wsRepo, doc?.rootFolderUrl]);

  if (!wsRepo) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-base-content/30">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <patchwork-scope ref={scopeRef} style={{ display: "contents" }}>
        {scopeReady && (
          <>
            <div className="w-[250px] shrink-0 border-r border-base-content/[0.06] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-sm text-base-content/30">
                  <span className="loading loading-spinner loading-xs mr-2" />
                  Loading…
                </div>
              ) : tree.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-xs text-base-content/30">
                  No files
                </div>
              ) : (
                <FileTree
                  nodes={tree}
                  selectedUrl={selectedUrl}
                  onSelect={setSelectedUrl}
                />
              )}
            </div>
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
              {selectedUrl ? (
                <>
                  <div className="flex items-center justify-end px-3 py-1.5 border-b border-base-content/[0.06] shrink-0">
                    <button
                      className="btn btn-xs btn-ghost gap-1 text-base-content/50 hover:text-base-content"
                      onClick={(e) => {
                        e.currentTarget.dispatchEvent(
                          new OpenDocumentEvent({ url: selectedUrl })
                        );
                      }}
                    >
                      Open
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m21 3-9 9"/><path d="M15 3h6v6"/></svg>
                    </button>
                  </div>
                  <div className="flex-1 min-h-0">
                    <patchwork-view-scoped
                      doc-url={selectedUrl}
                      style={{ display: "block", width: "100%", height: "100%" }}
                    />
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-base-content/30">
                  Select a file to preview
                </div>
              )}
            </div>
          </>
        )}
      </patchwork-scope>
    </div>
  );
};

function FileTree({
  nodes,
  selectedUrl,
  onSelect,
  depth = 0,
}: {
  nodes: TreeNode[];
  selectedUrl: AutomergeUrl | null;
  onSelect: (url: AutomergeUrl) => void;
  depth?: number;
}) {
  return (
    <div className={depth === 0 ? "py-1" : ""}>
      {nodes.map((node) => (
        <FileTreeNode
          key={node.url}
          node={node}
          selectedUrl={selectedUrl}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </div>
  );
}

function FileTreeNode({
  node,
  selectedUrl,
  onSelect,
  depth,
}: {
  node: TreeNode;
  selectedUrl: AutomergeUrl | null;
  onSelect: (url: AutomergeUrl) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = node.type === "folder";
  const isSelected = selectedUrl === node.url;
  const indent = depth * 12 + 8;

  if (isFolder) {
    return (
      <div>
        <div
          className="flex items-center gap-1.5 py-1 cursor-pointer hover:bg-base-content/5 text-xs select-none"
          style={{ paddingLeft: `${indent}px` }}
          onClick={() => setExpanded((e) => !e)}
        >
          <span className="text-base-content/40 w-3 text-center text-[10px]">
            {expanded ? "\u25BE" : "\u25B8"}
          </span>
          <span className="text-base-content/70 font-medium truncate">
            {node.name}
          </span>
        </div>
        {expanded && node.children && (
          <FileTree
            nodes={node.children}
            selectedUrl={selectedUrl}
            onSelect={onSelect}
            depth={depth + 1}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 py-1 cursor-pointer text-xs select-none truncate ${
        isSelected
          ? "bg-primary/15 text-primary"
          : "hover:bg-base-content/5 text-base-content/70"
      }`}
      style={{ paddingLeft: `${indent + 15}px` }}
      onClick={() => onSelect(node.url)}
    >
      <span className="truncate">{node.name}</span>
      {node.docType !== "file" && (
        <span className="text-[10px] text-base-content/30 shrink-0">
          {node.docType}
        </span>
      )}
    </div>
  );
}

export const renderWorkspaceBrowser: ToolImplementation = toolify(WorkspaceBrowser);
