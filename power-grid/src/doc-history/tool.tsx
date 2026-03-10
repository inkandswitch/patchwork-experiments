import { createRoot } from 'react-dom/client';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';

import { useDocumentTree } from './use-document-tree';
import type { TreeEdge } from './use-document-tree';
import './index.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

export const DocHistoryTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <DocHistoryView handle={handle as DocHandle<Record<string, unknown>>} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodePosition {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// ─── Force simulation ─────────────────────────────────────────────────────────

const REPULSION = 4000;
const SPRING_LENGTH = 100;
const SPRING_STIFFNESS = 0.05;
const GRAVITY = 0.02;
const DAMPING = 0.85;
const MIN_DIST = 10;

function runSimulationTick(
  positions: Map<AutomergeUrl, NodePosition>,
  edges: TreeEdge[],
  centerX: number,
  centerY: number,
): boolean {
  const nodes = Array.from(positions.entries());
  let totalKE = 0;

  // Apply forces
  for (const [urlA, posA] of nodes) {
    let fx = 0;
    let fy = 0;

    // Repulsion between all pairs
    for (const [urlB, posB] of nodes) {
      if (urlA === urlB) continue;
      const dx = posA.x - posB.x;
      const dy = posA.y - posB.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DIST);
      const force = REPULSION / (dist * dist);
      fx += (dx / dist) * force;
      fy += (dy / dist) * force;
    }

    // Spring attraction along edges
    for (const edge of edges) {
      const other = edge.source === urlA ? edge.target : edge.target === urlA ? edge.source : null;
      if (!other) continue;
      const posOther = positions.get(other);
      if (!posOther) continue;
      const dx = posOther.x - posA.x;
      const dy = posOther.y - posA.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DIST);
      const stretch = dist - SPRING_LENGTH;
      fx += (dx / dist) * stretch * SPRING_STIFFNESS;
      fy += (dy / dist) * stretch * SPRING_STIFFNESS;
    }

    // Gravity toward center
    fx += (centerX - posA.x) * GRAVITY;
    fy += (centerY - posA.y) * GRAVITY;

    posA.vx = (posA.vx + fx) * DAMPING;
    posA.vy = (posA.vy + fy) * DAMPING;
    posA.x += posA.vx;
    posA.y += posA.vy;
    totalKE += posA.vx * posA.vx + posA.vy * posA.vy;
  }

  return totalKE > 0.01;
}

// ─── Main view ────────────────────────────────────────────────────────────────

function DocHistoryView({ handle }: { handle: DocHandle<Record<string, unknown>> }) {
  const rootUrl = handle.url;
  const { docs, edges } = useDocumentTree(rootUrl);
  const [selectedUrl, setSelectedUrl] = useState<AutomergeUrl | null>(null);

  const urls = Array.from(docs.keys());

  return (
    <div className="dh-root">
      <div className="dh-left">
        <div className="dh-left-header">
          <span className="dh-label">Copy History</span>
          <span className="dh-count">{urls.length} document{urls.length !== 1 ? 's' : ''}</span>
        </div>
        <ForceGraph
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

// ─── Force graph ──────────────────────────────────────────────────────────────

function getDocTitle(doc: Record<string, unknown> | undefined, url: AutomergeUrl): string {
  if (!doc) return shortUrl(url);
  // Try common title fields
  if (typeof doc['title'] === 'string' && doc['title']) return doc['title'];
  if (typeof doc['name'] === 'string' && doc['name']) return doc['name'];
  const meta = doc['@patchwork'] as Record<string, unknown> | undefined;
  if (meta && typeof meta['type'] === 'string') return meta['type'];
  return shortUrl(url);
}

function shortUrl(url: AutomergeUrl): string {
  const id = url.replace('automerge:', '');
  return id.slice(0, 8) + '…';
}

function ForceGraph({
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
  onSelect: (url: AutomergeUrl) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const positionsRef = useRef<Map<AutomergeUrl, NodePosition>>(new Map());
  const rafRef = useRef<number>(0);
  const [, setTick] = useState(0);
  const [svgSize, setSvgSize] = useState({ w: 400, h: 400 });

  // Observe SVG container size
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

  // Seed positions for new nodes, remove stale ones
  useEffect(() => {
    const positions = positionsRef.current;
    const urlSet = new Set(urls);

    // Remove stale
    for (const url of positions.keys()) {
      if (!urlSet.has(url)) positions.delete(url);
    }

    // Seed new nodes near center with slight random offset
    const cx = svgSize.w / 2;
    const cy = svgSize.h / 2;
    for (const url of urls) {
      if (!positions.has(url)) {
        positions.set(url, {
          x: cx + (Math.random() - 0.5) * 60,
          y: cy + (Math.random() - 0.5) * 60,
          vx: 0,
          vy: 0,
        });
      }
    }
  }, [urls, svgSize]);

  // Run force simulation loop
  useEffect(() => {
    let running = true;

    function tick() {
      if (!running) return;
      const cx = svgSize.w / 2;
      const cy = svgSize.h / 2;
      const active = runSimulationTick(positionsRef.current, edges, cx, cy);
      setTick((n) => n + 1);
      if (active) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [urls, edges, svgSize]);

  const handleNodeClick = useCallback(
    (e: React.MouseEvent, url: AutomergeUrl) => {
      e.stopPropagation();
      onSelect(url);
    },
    [onSelect],
  );

  const positions = positionsRef.current;
  const NODE_R = 10;

  return (
    <svg
      ref={svgRef}
      className="dh-graph"
      width={svgSize.w}
      height={svgSize.h}
      onClick={() => onSelect(null as unknown as AutomergeUrl)}
    >
      {/* Edge lines */}
      <g className="dh-edges">
        {edges.map((edge) => {
          const src = positions.get(edge.source);
          const tgt = positions.get(edge.target);
          if (!src || !tgt) return null;
          return (
            <line
              key={`${edge.source}->${edge.target}`}
              className="dh-edge"
              x1={src.x}
              y1={src.y}
              x2={tgt.x}
              y2={tgt.y}
            />
          );
        })}
      </g>

      {/* Nodes */}
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
              className={[
                'dh-node',
                isRoot ? 'dh-node--root' : '',
                isSelected ? 'dh-node--selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              transform={`translate(${pos.x},${pos.y})`}
              onClick={(e) => handleNodeClick(e, url)}
              role="button"
              tabIndex={0}
              aria-label={title}
            >
              <circle className="dh-node-circle" r={NODE_R} />
              {isRoot && <circle className="dh-node-root-ring" r={NODE_R + 4} />}
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
