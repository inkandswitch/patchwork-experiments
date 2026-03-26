import { createRoot } from 'react-dom/client';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';

import { useDocumentTree } from './use-document-tree';
import type { TreeEdge } from './use-document-tree';
import './index.css';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'patchwork-view': {
        'doc-url'?: string;
        'tool-id'?: string;
        class?: string;
        key?: string | number;
      };
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export const DocCopyHistoryTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <DocCopyHistoryView handle={handle as DocHandle<Record<string, unknown>>} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ─── Layout ───────────────────────────────────────────────────────────────────

type Point = { x: number; y: number };

function computeLayout(
  urls: AutomergeUrl[],
  edges: TreeEdge[],
  width: number,
  height: number,
): Map<AutomergeUrl, Point> {
  if (urls.length === 0) return new Map();
  if (urls.length === 1) return new Map([[urls[0], { x: width / 2, y: height / 2 }]]);

  const childrenOf = new Map<AutomergeUrl, AutomergeUrl[]>(urls.map((u) => [u, []]));
  const parentsOf = new Map<AutomergeUrl, AutomergeUrl[]>(urls.map((u) => [u, []]));

  for (const { source, target } of edges) {
    childrenOf.get(source)?.push(target);
    parentsOf.get(target)?.push(source);
  }

  // Find roots (no known parent edges)
  const roots = urls.filter((u) => (parentsOf.get(u)?.length ?? 0) === 0);

  // BFS to assign depths
  const depth = new Map<AutomergeUrl, number>();
  const queue = [...roots];
  for (const r of roots) depth.set(r, 0);

  while (queue.length > 0) {
    const url = queue.shift()!;
    const d = depth.get(url)!;
    for (const child of childrenOf.get(url) ?? []) {
      if (!depth.has(child)) {
        depth.set(child, d + 1);
        queue.push(child);
      }
    }
  }

  for (const url of urls) {
    if (!depth.has(url)) depth.set(url, 0);
  }

  // Group into layers
  const layers: AutomergeUrl[][] = [];
  for (const [url, d] of depth) {
    while (layers.length <= d) layers.push([]);
    layers[d].push(url);
  }

  const numLayers = layers.length;
  const PAD_X = 50;
  const PAD_Y = 50;
  const positions = new Map<AutomergeUrl, Point>();

  for (let d = 0; d < numLayers; d++) {
    const layer = layers[d];
    const y =
      numLayers === 1 ? height / 2 : PAD_Y + (d / (numLayers - 1)) * (height - PAD_Y * 2);
    for (let i = 0; i < layer.length; i++) {
      const x =
        layer.length === 1
          ? width / 2
          : PAD_X + (i / (layer.length - 1)) * (width - PAD_X * 2);
      positions.set(layer[i], { x, y });
    }
  }

  return positions;
}

// ─── Main view ────────────────────────────────────────────────────────────────

function DocCopyHistoryView({ handle }: { handle: DocHandle<Record<string, unknown>> }) {
  const rootUrl = handle.url;
  const { docs, edges } = useDocumentTree(rootUrl);
  const [selectedUrl, setSelectedUrl] = useState<AutomergeUrl | null>(null);

  const urls = Array.from(docs.keys());

  return (
    <div className="dh-root">
      <div className="dh-left">
        <div className="dh-left-header">
          <span className="dh-label">Copy History</span>
          <span className="dh-count">
            {urls.length} document{urls.length !== 1 ? 's' : ''}
          </span>
        </div>
        <TreeGraph
          urls={urls}
          edges={edges}
          rootUrl={rootUrl}
          docs={docs}
          selectedUrl={selectedUrl}
          onSelect={setSelectedUrl}
        />
      </div>
      <div className="dh-right">
        {selectedUrl ? (
          <patchwork-view key={selectedUrl} doc-url={selectedUrl} class="dh-patchwork" />
        ) : (
          <div className="dh-empty">
            <div className="dh-empty-icon">◎</div>
            <div className="dh-empty-text">Select a document in the tree to view it</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tree graph ───────────────────────────────────────────────────────────────

const NODE_R = 10;

function getDocTitle(doc: Record<string, unknown> | undefined, url: AutomergeUrl): string {
  if (!doc) return shortUrl(url);
  if (typeof doc['title'] === 'string' && doc['title']) return doc['title'];
  if (typeof doc['name'] === 'string' && doc['name']) return doc['name'];
  const meta = doc['@patchwork'] as Record<string, unknown> | undefined;
  if (meta && typeof meta['type'] === 'string') return meta['type'];
  return shortUrl(url);
}

function shortUrl(url: AutomergeUrl): string {
  return url.replace('automerge:', '').slice(0, 8) + '…';
}

function TreeGraph({
  urls,
  edges,
  rootUrl,
  docs,
  selectedUrl,
  onSelect,
}: {
  urls: AutomergeUrl[];
  edges: TreeEdge[];
  rootUrl: AutomergeUrl;
  docs: Map<AutomergeUrl, Record<string, unknown>>;
  selectedUrl: AutomergeUrl | null;
  onSelect: (url: AutomergeUrl | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 320, h: 400 });

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSvgSize({ w: Math.max(width, 100), h: Math.max(height, 100) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const positions = useMemo(
    () => computeLayout(urls, edges, svgSize.w, svgSize.h),
    [urls, edges, svgSize],
  );

  const handleNodeClick = useCallback(
    (e: React.MouseEvent, url: AutomergeUrl) => {
      e.stopPropagation();
      onSelect(url);
    },
    [onSelect],
  );

  return (
    <svg
      ref={svgRef}
      className="dh-graph"
      width={svgSize.w}
      height={svgSize.h}
      onClick={() => onSelect(null)}
    >
      <defs>
        <marker id="dh-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" className="dh-arrowhead" />
        </marker>
      </defs>

      <g className="dh-edges">
        {edges.map((edge) => {
          const src = positions.get(edge.source);
          const tgt = positions.get(edge.target);
          if (!src || !tgt) return null;
          const dx = tgt.x - src.x;
          const dy = tgt.y - src.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) return null;
          const nx = dx / len;
          const ny = dy / len;
          return (
            <line
              key={`${edge.source}->${edge.target}`}
              className="dh-edge"
              x1={src.x + nx * NODE_R}
              y1={src.y + ny * NODE_R}
              x2={tgt.x - nx * NODE_R}
              y2={tgt.y - ny * NODE_R}
              markerEnd="url(#dh-arrow)"
            />
          );
        })}
      </g>

      <g className="dh-nodes">
        {urls.map((url) => {
          const pos = positions.get(url);
          if (!pos) return null;
          const isRoot = url === rootUrl;
          const isSelected = url === selectedUrl;
          const doc = docs.get(url);
          const title = getDocTitle(doc, url);

          return (
            <g
              key={url}
              className={['dh-node', isRoot && 'dh-node--root', isSelected && 'dh-node--selected']
                .filter(Boolean)
                .join(' ')}
              transform={`translate(${pos.x},${pos.y})`}
              onClick={(e) => handleNodeClick(e, url)}
              role="button"
              tabIndex={0}
              aria-label={title}
            >
              <circle className="dh-node-circle" r={NODE_R} />
              <text className="dh-node-label" dy={NODE_R + 14}>
                {title.length > 16 ? title.slice(0, 14) + '…' : title}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
