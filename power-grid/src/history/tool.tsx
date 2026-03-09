import { createRoot } from 'react-dom/client';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeTree, type NodeInfo } from './useNodeTree';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const HistoryTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <HistoryViewer initialUrl={handle.url} repo={repo} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ---------------------------------------------------------------------------
// Main viewer
// ---------------------------------------------------------------------------

function HistoryViewer({ initialUrl, repo }: { initialUrl: AutomergeUrl; repo: Repo }) {
  const [selectedUrl, setSelectedUrl] = useState<AutomergeUrl>(initialUrl);
  const { nodes, rootUrl } = useNodeTree(initialUrl);

  // Build the fixed spine: root → initialUrl (always from initialUrl's ancestry)
  const spine = useMemo<AutomergeUrl[]>(() => {
    const chain: AutomergeUrl[] = [];
    let current: AutomergeUrl | undefined = initialUrl;
    const visited = new Set<AutomergeUrl>();
    while (current && !visited.has(current)) {
      visited.add(current);
      chain.unshift(current); // prepend so index 0 = root
      current = nodes.get(current)?.copyOf;
    }
    return chain; // [root, ..., initialUrl]
  }, [nodes, initialUrl]);

  // Ancestors of selectedUrl (inclusive), as a set for O(1) lookup
  const ancestorSet = useMemo<Set<AutomergeUrl>>(() => {
    const set = new Set<AutomergeUrl>();
    let current: AutomergeUrl | undefined = selectedUrl;
    const visited = new Set<AutomergeUrl>();
    while (current && !visited.has(current)) {
      visited.add(current);
      set.add(current);
      current = nodes.get(current)?.copyOf;
    }
    return set;
  }, [nodes, selectedUrl]);

  // Copies of selectedUrl that diverge off the spine
  const selectedNode = nodes.get(selectedUrl);
  const spineSet = useMemo(() => new Set(spine), [spine]);

  const divergingCopies = useMemo<AutomergeUrl[]>(() => {
    if (!selectedNode) return [];
    return selectedNode.copies.filter((url) => !spineSet.has(url));
  }, [selectedNode, spineSet]);

  async function handleCreateCopy() {
    const sourceHandle = await repo.find<Record<string, unknown>>(selectedUrl);
    const newHandle = repo.clone(sourceHandle);

    newHandle.change((doc) => {
      const pm = doc['@patchwork'] as Record<string, unknown>;
      pm.copyOf = selectedUrl;
      pm.copies = [];
    });

    sourceHandle.change((doc) => {
      const pm = doc['@patchwork'] as Record<string, unknown>;
      if (!Array.isArray(pm.copies)) {
        pm.copies = [];
      }
      (pm.copies as AutomergeUrl[]).push(newHandle.url);
    });

    setSelectedUrl(newHandle.url);
  }

  return (
    <div style={styles.root}>
      <div style={styles.treePanel}>
        <TreePanel
          spine={spine}
          nodes={nodes}
          selectedUrl={selectedUrl}
          ancestorSet={ancestorSet}
          divergingCopies={divergingCopies}
          onSelect={setSelectedUrl}
        />
        <button onClick={handleCreateCopy} style={styles.createCopyBtn}>
          + Create Copy
        </button>
      </div>
      <div style={styles.viewPanel}>
        <PatchworkViewPanel docUrl={selectedUrl} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree panel
// ---------------------------------------------------------------------------

interface TreePanelProps {
  spine: AutomergeUrl[];
  nodes: Map<AutomergeUrl, NodeInfo>;
  selectedUrl: AutomergeUrl;
  ancestorSet: Set<AutomergeUrl>;
  divergingCopies: AutomergeUrl[];
  onSelect: (url: AutomergeUrl) => void;
}

function TreePanel({
  spine,
  nodes,
  selectedUrl,
  ancestorSet,
  divergingCopies,
  onSelect,
}: TreePanelProps) {
  // Display spine bottom-to-top: reverse so root is last rendered (visually at bottom)
  const spineBottomToTop = [...spine].reverse(); // [initialUrl, ..., root]

  return (
    <div style={styles.tree}>
      {spineBottomToTop.map((url, i) => {
        const isSelected = url === selectedUrl;
        const isAncestor = ancestorSet.has(url);
        // "above" selected = descendants of selected on the spine (toward initialUrl)
        const isGray = !isSelected && !isAncestor;

        const showCopies = isSelected && divergingCopies.length > 0;

        return (
          <div key={url} style={styles.spineRow}>
            {/* Connector line above (between this node and the one above it in the list,
                which is the next ancestor going toward root) */}
            {i < spineBottomToTop.length - 1 && (
              <div
                style={{
                  ...styles.connector,
                  borderColor: ancestorSet.has(spineBottomToTop[i + 1]) ? '#1a1a1a' : '#bbb',
                }}
              />
            )}

            <div style={styles.spineNodeRow}>
              <NodeBubble
                url={url}
                node={nodes.get(url)}
                isSelected={isSelected}
                isGray={isGray}
                onClick={() => onSelect(url)}
              />

              {showCopies && (
                <div style={styles.copiesRow}>
                  <div style={styles.copiesBranch} />
                  {divergingCopies.map((copyUrl) => (
                    <NodeBubble
                      key={copyUrl}
                      url={copyUrl}
                      node={nodes.get(copyUrl)}
                      isSelected={false}
                      isGray={false}
                      isCopy
                      onClick={() => onSelect(copyUrl)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node bubble
// ---------------------------------------------------------------------------

interface NodeBubbleProps {
  url: AutomergeUrl;
  node: NodeInfo | undefined;
  isSelected: boolean;
  isGray: boolean;
  isCopy?: boolean;
  onClick: () => void;
}

function NodeBubble({ url, node, isSelected, isGray, isCopy = false, onClick }: NodeBubbleProps) {
  const label = node?.title ?? url.slice(-8);
  const type = node?.type ?? '';

  let borderColor = '#1a1a1a';
  let textColor = '#1a1a1a';
  if (isSelected) {
    borderColor = '#2563eb';
    textColor = '#2563eb';
  } else if (isGray) {
    borderColor = '#bbb';
    textColor = '#999';
  } else if (isCopy) {
    borderColor = '#e53e3e';
    textColor = '#e53e3e';
  }

  return (
    <button
      onClick={onClick}
      title={url}
      style={{
        ...styles.bubble,
        borderColor,
        color: textColor,
        background: isSelected ? '#eff6ff' : '#fff',
      }}
    >
      <span style={styles.bubbleType}>{type}</span>
      <span style={styles.bubbleLabel}>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Patchwork view panel
// ---------------------------------------------------------------------------

function PatchworkViewPanel({ docUrl }: { docUrl: AutomergeUrl }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!viewRef.current) {
      const el = document.createElement('patchwork-view');
      containerRef.current.appendChild(el);
      viewRef.current = el;
    }
    viewRef.current.setAttribute('doc-url', docUrl);
  }, [docUrl]);

  useEffect(() => {
    return () => {
      if (viewRef.current && containerRef.current?.contains(viewRef.current)) {
        containerRef.current.removeChild(viewRef.current);
      }
      viewRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={styles.viewContainer} />;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  root: {
    display: 'flex',
    height: '100%',
    width: '100%',
    overflow: 'hidden',
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: '13px',
  } satisfies React.CSSProperties,

  treePanel: {
    width: '280px',
    minWidth: '220px',
    flexShrink: 0,
    borderRight: '1px solid #e5e7eb',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  } satisfies React.CSSProperties,

  tree: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 0,
  } satisfies React.CSSProperties,

  spineRow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    width: '100%',
  } satisfies React.CSSProperties,

  spineNodeRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8px',
  } satisfies React.CSSProperties,

  connector: {
    width: 0,
    height: '20px',
    borderLeft: '2px solid',
    marginLeft: '20px', // center on the bubble (half of 40px bubble width)
    flexShrink: 0,
  } satisfies React.CSSProperties,

  copiesRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8px',
  } satisfies React.CSSProperties,

  copiesBranch: {
    width: '24px',
    height: '2px',
    background: '#e53e3e',
    flexShrink: 0,
  } satisfies React.CSSProperties,

  bubble: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '72px',
    minHeight: '40px',
    padding: '4px 6px',
    border: '2px solid',
    borderRadius: '8px',
    cursor: 'pointer',
    gap: '1px',
    textAlign: 'center',
    transition: 'opacity 0.1s',
    flexShrink: 0,
  } satisfies React.CSSProperties,

  bubbleType: {
    fontSize: '9px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    opacity: 0.7,
    lineHeight: 1.2,
  } satisfies React.CSSProperties,

  bubbleLabel: {
    fontSize: '11px',
    fontWeight: 500,
    lineHeight: 1.3,
    wordBreak: 'break-all' as const,
    maxWidth: '100%',
  } satisfies React.CSSProperties,

  createCopyBtn: {
    margin: '12px 16px',
    padding: '8px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    background: '#f9fafb',
    color: '#374151',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    flexShrink: 0,
    textAlign: 'left' as const,
  } satisfies React.CSSProperties,

  viewPanel: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  } satisfies React.CSSProperties,

  viewContainer: {
    position: 'absolute',
    inset: 0,
  } satisfies React.CSSProperties,
} as const;
