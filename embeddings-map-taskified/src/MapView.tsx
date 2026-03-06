import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  DeckGL,
  OrthographicView,
  ScatterplotLayer,
  TextLayer,
  BitmapLayer,
  COORDINATE_SYSTEM,
} from 'deck.gl';
import type { PickingInfo } from 'deck.gl';
import type { Cluster } from './clustering';
import type { Point2D, Projector } from './projection';
import type { LeafDoc } from './tool';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { ExtractionRules } from './embeddings';
import { embedQuery, embedText, serializeDoc } from './embeddings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MapPoint = {
  leaf: LeafDoc;
  position: Point2D;
  clusterId: number;
  color: [number, number, number];
};

type Props = {
  points: MapPoint[];
  clusters: Cluster[];
  vectors: Map<AutomergeUrl, number[]>;
  projector: Projector;
  repo: Repo;
  extractionRules: ExtractionRules;
  onBack: () => void;
  hostElement: HTMLElement;
};

type SimilarDoc = {
  url: AutomergeUrl;
  name: string;
  score: number;
  point: MapPoint;
};

type AnimTarget = { from: Point2D; to: Point2D; startMs: number };
type WorldBounds = [number, number, number, number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIMILAR_COUNT = 8;
const SIMILAR_PANEL_COUNT = 5;
const SEARCH_DEBOUNCE_MS = 500;
const ANIM_DURATION_MS = 800;

const VIEW = new OrthographicView({ id: '2d-scene', controller: true });

// ---------------------------------------------------------------------------
// Math utilities
// ---------------------------------------------------------------------------

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function lerp2D(from: Point2D, to: Point2D, t: number): Point2D {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

// ---------------------------------------------------------------------------
// Similarity search
// ---------------------------------------------------------------------------

function findSimilar(
  targetUrl: AutomergeUrl,
  vectors: Map<AutomergeUrl, number[]>,
  points: MapPoint[],
  count: number,
): SimilarDoc[] {
  const target = vectors.get(targetUrl);
  if (!target) return [];
  return rankBySimilarity(target, vectors, points, count, targetUrl);
}

function rankBySimilarity(
  queryVec: number[],
  vectors: Map<AutomergeUrl, number[]>,
  points: MapPoint[],
  count: number,
  excludeUrl?: AutomergeUrl,
): SimilarDoc[] {
  const scored: SimilarDoc[] = [];
  for (const pt of points) {
    if (pt.leaf.doc.url === excludeUrl) continue;
    const vec = vectors.get(pt.leaf.doc.url);
    if (!vec) continue;
    scored.push({ url: pt.leaf.doc.url, name: pt.leaf.doc.name, score: cosineSim(queryVec, vec), point: pt });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count);
}

/**
 * Find the cluster whose HD centroid is most similar to the given vector.
 * Returns the cluster id and color, or noise defaults if no good match.
 */
function findNearestCluster(
  vec: number[],
  clusters: Cluster[],
): { clusterId: number; color: [number, number, number] } {
  let bestId = -1;
  let bestSim = -Infinity;
  let bestColor: [number, number, number] = [120, 120, 120];

  for (const c of clusters) {
    if (c.id < 0) continue;
    const sim = cosineSim(vec, c.centroidHD);
    if (sim > bestSim) {
      bestSim = sim;
      bestId = c.id;
      bestColor = c.color;
    }
  }

  return { clusterId: bestId, color: bestColor };
}

// ---------------------------------------------------------------------------
// Data bounds & fit
// ---------------------------------------------------------------------------

function computeDataBounds(points: MapPoint[], padding = 0.15): WorldBounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    const [px, py] = p.position;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const padX = (maxX - minX || 1) * padding;
  const padY = (maxY - minY || 1) * padding;
  return [minX - padX, minY - padY, maxX + padX, maxY + padY];
}

function computeFitViewState(bounds: WorldBounds, width: number, height: number) {
  const [left, bottom, right, top] = bounds;
  const cx = (left + right) / 2;
  const cy = (bottom + top) / 2;
  const zoom = Math.log2(Math.min(width / (right - left || 1), height / (top - bottom || 1)));
  return { target: [cx, cy, 0] as [number, number, number], zoom: Math.max(-4, Math.min(zoom, 8)) };
}

// ---------------------------------------------------------------------------
// Pre-rendered density canvas
// ---------------------------------------------------------------------------

function renderDensityCanvas(points: MapPoint[], bounds: WorldBounds): HTMLCanvasElement {
  const [left, bottom, right, top] = bounds;
  const worldW = right - left || 1;
  const worldH = top - bottom || 1;

  // Render at 2x then blur+downsample for smooth results at any zoom
  const maxRes = 2048;
  const canvasW = worldW >= worldH ? maxRes : Math.max(512, Math.round(maxRes * (worldW / worldH)));
  const canvasH = worldW >= worldH ? Math.max(512, Math.round(maxRes * (worldH / worldW))) : maxRes;

  const src = document.createElement('canvas');
  src.width = canvasW;
  src.height = canvasH;
  const ctx = src.getContext('2d')!;

  const radius = Math.max(canvasW, canvasH) * 0.045;
  const alpha = Math.min(0.08, Math.max(0.015, 4 / Math.sqrt(points.length)));
  ctx.globalCompositeOperation = 'lighter';

  for (const p of points) {
    const cx = ((p.position[0] - left) / worldW) * canvasW;
    const cy = ((top - p.position[1]) / worldH) * canvasH;
    const [r, g, b] = p.color;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
    gradient.addColorStop(0.4, `rgba(${r},${g},${b},${alpha * 0.5})`);
    gradient.addColorStop(0.75, `rgba(${r},${g},${b},${alpha * 0.12})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  // Gaussian blur to eliminate grid/pixel artifacts at any zoom level
  const out = document.createElement('canvas');
  out.width = canvasW;
  out.height = canvasH;
  const outCtx = out.getContext('2d')!;
  outCtx.filter = 'blur(6px)';
  outCtx.drawImage(src, 0, 0);

  return out;
}

// ---------------------------------------------------------------------------
// ResizeObserver hook
// ---------------------------------------------------------------------------

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ---------------------------------------------------------------------------
// MapView
// ---------------------------------------------------------------------------

export function MapView({
  points, clusters, vectors, projector, repo, extractionRules, onBack, hostElement,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapSize = useSize(mapRef);

  const [hoveredPoint, setHoveredPoint] = useState<MapPoint | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [showDensity, setShowDensity] = useState(true);

  // Similar docs (computed from selection)
  const [similarDocs, setSimilarDocs] = useState<SimilarDoc[]>([]);

  // Search
  const [searchText, setSearchText] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPin, setSearchPin] = useState<{ pos: Point2D; vec: number[] } | null>(null);
  const [searchSimilar, setSearchSimilar] = useState<SimilarDoc[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Watched docs — positions are stored in a ref to avoid stale closures in the RAF loop
  const [watchedSet, setWatchedSet] = useState<Set<AutomergeUrl>>(() => new Set());
  const displayPosRef = useRef<Map<AutomergeUrl, Point2D>>(new Map());
  const [displayPosVersion, setDisplayPosVersion] = useState(0);
  const animTargetsRef = useRef<Map<AutomergeUrl, AnimTarget>>(new Map());
  const rafRef = useRef<number | null>(null);
  const reEmbedLockRef = useRef<Set<AutomergeUrl>>(new Set());

  // Dynamic cluster overrides for watched docs that have moved to a new cluster
  const clusterOverridesRef = useRef<Map<AutomergeUrl, { clusterId: number; color: [number, number, number] }>>(new Map());

  // Local mutable copy of vectors so watched docs can update without mutating the prop
  const liveVectorsRef = useRef(vectors);
  useEffect(() => { liveVectorsRef.current = vectors; }, [vectors]);

  // Controlled deck.gl viewState
  const [viewState, setViewState] = useState<any>(null);
  const didInit = useRef(false);

  const nonNoiseClusters = useMemo(() => clusters.filter((c) => c.id >= 0), [clusters]);
  const dataBounds = useMemo(() => computeDataBounds(points), [points]);
  const densityCanvas = useMemo(() => renderDensityCanvas(points, dataBounds), [points, dataBounds]);

  const pointsByUrl = useMemo(() => {
    const m = new Map<AutomergeUrl, MapPoint>();
    for (const p of points) m.set(p.leaf.doc.url, p);
    return m;
  }, [points]);


  // ---- Init view ----

  useEffect(() => {
    if (didInit.current || !mapSize) return;
    didInit.current = true;
    setViewState(computeFitViewState(dataBounds, mapSize.w, mapSize.h));
  }, [mapSize, dataBounds]);

  const handleFit = useCallback(() => {
    if (mapSize) setViewState(computeFitViewState(dataBounds, mapSize.w, mapSize.h));
  }, [dataBounds, mapSize]);

  const onViewStateChange = useCallback(({ viewState: vs }: any) => setViewState(vs), []);

  // ---- Open document ----

  const openDoc = useCallback((pt: MapPoint) => {
    hostElement.dispatchEvent(new CustomEvent('patchwork:open-document', {
      detail: { url: pt.leaf.doc.url, type: pt.leaf.doc.type, title: pt.leaf.doc.name },
      bubbles: true,
      composed: true,
    }));
  }, [hostElement]);

  // ---- Similar docs on selection ----

  useEffect(() => {
    if (!selectedPoint) { setSimilarDocs([]); return; }
    setSimilarDocs(findSimilar(selectedPoint.leaf.doc.url, liveVectorsRef.current, points, SIMILAR_COUNT));
  }, [selectedPoint, points]);

  const highlightedUrls = useMemo(() => {
    const set = new Set<AutomergeUrl>();
    for (const d of similarDocs) set.add(d.url);
    for (const d of searchSimilar) set.add(d.url);
    return set;
  }, [similarDocs, searchSimilar]);

  // ---- Search ----

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!searchText.trim()) {
      setSearchPin(null);
      setSearchSimilar([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const vec = await embedQuery(searchText.trim());
        const pos = projector.transformPoint(vec);
        setSearchPin({ pos, vec });
        setSearchSimilar(rankBySimilarity(vec, liveVectorsRef.current, points, SIMILAR_COUNT));
      } catch (e) {
        console.warn('[embeddings-map] Search embed failed:', e);
      } finally {
        setSearchLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchText, projector, points]);

  // ---- Animation loop (reads/writes refs only — no stale closures) ----

  const runAnimFrame = useCallback(() => {
    const now = performance.now();
    const targets = animTargetsRef.current;
    const positions = displayPosRef.current;
    let anyActive = false;

    for (const [url, target] of targets) {
      const t = Math.min(1, (now - target.startMs) / ANIM_DURATION_MS);
      positions.set(url, lerp2D(target.from, target.to, easeOutCubic(t)));
      if (t < 1) anyActive = true;
      else targets.delete(url);
    }

    setDisplayPosVersion((v) => v + 1);

    if (anyActive) {
      rafRef.current = requestAnimationFrame(runAnimFrame);
    } else {
      rafRef.current = null;
    }
  }, []);

  const startAnimLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(runAnimFrame);
  }, [runAnimFrame]);

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); }, []);

  // ---- Watched docs: Automerge change subscription ----

  useEffect(() => {
    let cancelled = false;
    const cleanups: (() => void)[] = [];

    (async () => {
      for (const url of watchedSet) {
        if (cancelled) return;
        const handle = await repo.find(url);

        const onChange = async () => {
          if (reEmbedLockRef.current.has(url)) return;
          reEmbedLockRef.current.add(url);

          try {
            const pt = pointsByUrl.get(url);
            if (!pt) return;

            const result = await serializeDoc(repo, pt.leaf, extractionRules);
            if (!result) return;

            const newVec = await embedText(result.text);
            liveVectorsRef.current.set(url, newVec);

            const newPos = projector.transformPoint(newVec);
            const nearest = findNearestCluster(newVec, clusters);
            clusterOverridesRef.current.set(url, nearest);

            const currentPos = displayPosRef.current.get(url) ?? pt.position;
            animTargetsRef.current.set(url, { from: currentPos, to: newPos, startMs: performance.now() });
            startAnimLoop();
          } catch (e) {
            console.warn('[embeddings-map] Re-embed failed for', url, e);
          } finally {
            reEmbedLockRef.current.delete(url);
          }
        };

        handle.on('change', onChange);
        cleanups.push(() => handle.off('change', onChange));
      }
    })();

    return () => { cancelled = true; for (const fn of cleanups) fn(); };
  }, [watchedSet, repo, pointsByUrl, extractionRules, projector, clusters, startAnimLoop]);

  // ---- Toggle watch ----

  const toggleWatch = useCallback((url: AutomergeUrl) => {
    setWatchedSet((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  // ---- Effective position accessor ----

  const getPosition = useCallback(
    (d: MapPoint): Point2D => displayPosRef.current.get(d.leaf.doc.url) ?? d.position,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayPosVersion],
  );

  // ---- Layers ----

  const layers = useMemo(() => {
    const result: any[] = [];

    if (showDensity && densityCanvas) {
      result.push(new BitmapLayer({
        id: 'density',
        image: densityCanvas,
        bounds: dataBounds,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        opacity: 1,
        parameters: { minFilter: 'linear', magFilter: 'linear' },
      }));
    }

    // Halo for highlighted docs
    if (highlightedUrls.size > 0) {
      result.push(new ScatterplotLayer<MapPoint>({
        id: 'halos',
        data: points.filter((p) => highlightedUrls.has(p.leaf.doc.url)),
        getPosition,
        getFillColor: (d: MapPoint) => {
          const color = clusterOverridesRef.current.get(d.leaf.doc.url)?.color ?? d.color;
          return [...color, 40] as [number, number, number, number];
        },
        getLineColor: (d: MapPoint) => {
          const color = clusterOverridesRef.current.get(d.leaf.doc.url)?.color ?? d.color;
          return [...color, 160] as [number, number, number, number];
        },
        stroked: true,
        lineWidthMinPixels: 2,
        lineWidthMaxPixels: 3,
        getRadius: 14,
        radiusMinPixels: 12,
        radiusMaxPixels: 20,
        radiusUnits: 'pixels' as const,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        pickable: false,
        updateTriggers: { getPosition: [displayPosVersion] },
      }));
    }

    // Main scatter
    result.push(new ScatterplotLayer<MapPoint>({
      id: 'scatter',
      data: points,
      getPosition,
      getFillColor: (d: MapPoint) => {
        if (selectedPoint && d.leaf.doc.url === selectedPoint.leaf.doc.url)
          return [255, 255, 255, 255] as [number, number, number, number];
        const override = clusterOverridesRef.current.get(d.leaf.doc.url);
        const color = override?.color ?? d.color;
        return [...color, 230] as [number, number, number, number];
      },
      getLineColor: (d: MapPoint) => {
        if (watchedSet.has(d.leaf.doc.url))
          return [0, 255, 180, 255] as [number, number, number, number];
        if (selectedPoint && d.leaf.doc.url === selectedPoint.leaf.doc.url)
          return [255, 255, 255, 255] as [number, number, number, number];
        return [20, 20, 35, 200] as [number, number, number, number];
      },
      getRadius: (d: MapPoint) =>
        selectedPoint && d.leaf.doc.url === selectedPoint.leaf.doc.url ? 8 : 5,
      stroked: true,
      lineWidthMinPixels: 1,
      lineWidthMaxPixels: 2,
      radiusMinPixels: 4,
      radiusMaxPixels: 14,
      radiusUnits: 'pixels' as const,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      pickable: true,
      onClick: (info: PickingInfo<MapPoint>) => {
        if (info.object) {
          setSelectedPoint((prev) =>
            prev?.leaf.doc.url === info.object!.leaf.doc.url ? null : info.object!,
          );
        } else {
          setSelectedPoint(null);
        }
        return true;
      },
      onHover: (info: PickingInfo<MapPoint>) => {
        if (info.object) {
          setHoveredPoint(info.object);
          setHoverPos({ x: info.x, y: info.y });
        } else {
          setHoveredPoint(null);
          setHoverPos(null);
        }
      },
      updateTriggers: {
        getFillColor: [selectedPoint, displayPosVersion],
        getLineColor: [selectedPoint, watchedSet],
        getRadius: [selectedPoint],
        getPosition: [displayPosVersion],
      },
    }));

    // Search pin — hollow ring, no fill
    if (searchPin) {
      result.push(new ScatterplotLayer({
        id: 'search-pin',
        data: [{ position: searchPin.pos }],
        getPosition: (d: { position: Point2D }) => d.position,
        filled: false,
        stroked: true,
        getLineColor: [255, 220, 50, 220],
        lineWidthMinPixels: 2,
        lineWidthMaxPixels: 3,
        getRadius: 16,
        radiusMinPixels: 14,
        radiusMaxPixels: 24,
        radiusUnits: 'pixels' as const,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        pickable: false,
      }));
      // Inner crosshair dot
      result.push(new ScatterplotLayer({
        id: 'search-pin-dot',
        data: [{ position: searchPin.pos }],
        getPosition: (d: { position: Point2D }) => d.position,
        getFillColor: [255, 220, 50, 180],
        filled: true,
        stroked: false,
        getRadius: 3,
        radiusMinPixels: 2,
        radiusMaxPixels: 4,
        radiusUnits: 'pixels' as const,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        pickable: false,
      }));
    }

    // Labels
    if (showLabels) {
      result.push(new TextLayer<Cluster>({
        id: 'labels',
        data: nonNoiseClusters.filter((c) => c.memberIndices.length >= 3),
        getPosition: (d: Cluster) => d.centroid2D,
        getText: (d: Cluster) => d.label,
        getSize: 14,
        sizeMinPixels: 11,
        sizeMaxPixels: 22,
        getColor: [255, 255, 255, 230],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        background: true,
        getBackgroundColor: (d: Cluster) => [...d.color, 180] as [number, number, number, number],
        backgroundPadding: [6, 3, 6, 3],
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        fontWeight: 600,
      }));
    }

    return result;
  }, [
    points, nonNoiseClusters, showLabels, showDensity, densityCanvas, dataBounds,
    selectedPoint, highlightedUrls, searchPin, watchedSet, displayPosVersion, getPosition,
  ]);

  // ---- Render ----

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#1a1a2e', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#191e24', borderBottom: '1px solid #2a323c', flexShrink: 0, zIndex: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-ghost" onClick={onBack}>&larr; Back</button>
        <Separator />
        <span style={{ fontSize: 13, opacity: 0.6 }}>{points.length} pts &middot; {nonNoiseClusters.length} clusters</span>
        <Separator />
        <button className="btn btn-xs btn-outline" onClick={handleFit}>Fit</button>
        <button className={`btn btn-xs ${showLabels ? 'btn-primary' : 'btn-outline'}`} onClick={() => setShowLabels((v) => !v)}>Labels</button>
        <button className={`btn btn-xs ${showDensity ? 'btn-primary' : 'btn-outline'}`} onClick={() => setShowDensity((v) => !v)}>Density</button>
        <Separator />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Semantic search..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            style={{ background: '#0d1117', border: '1px solid #2a323c', borderRadius: 6, color: '#e8e8e8', fontSize: 12, padding: '3px 8px', width: 200, outline: 'none' }}
          />
          {searchLoading && (
            <span style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }}>
              <span className="loading loading-spinner" style={{ width: 12, height: 12 }} />
            </span>
          )}
          {/* Inline dropdown results */}
          {searchFocused && searchSimilar.length > 0 && searchText.trim() && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 60, background: 'rgba(20,20,35,0.97)', border: '1px solid rgba(255,220,50,0.3)', borderRadius: 8, padding: '8px 10px', boxShadow: '0 4px 24px rgba(0,0,0,0.6)', width: 280, fontFamily: 'system-ui, sans-serif' }}>
              <div style={{ fontSize: 10, color: '#fdc830', fontWeight: 600, marginBottom: 5 }}>
                Nearest to &ldquo;{searchText.trim().slice(0, 30)}{searchText.trim().length > 30 ? '...' : ''}&rdquo;
              </div>
              {searchSimilar.slice(0, SIMILAR_PANEL_COUNT).map((d) => (
                <SimilarRow key={d.url} doc={d} onClick={() => { const pt = pointsByUrl.get(d.url); if (pt) setSelectedPoint(pt); }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <div ref={mapRef} style={{ flex: '1 1 0', position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        {mapSize && viewState && (
          <DeckGL views={VIEW} viewState={viewState} onViewStateChange={onViewStateChange} layers={layers} width={mapSize.w} height={mapSize.h} />
        )}

        {/* Hover tooltip — always shown, even when a doc is selected */}
        {hoveredPoint && hoverPos && (
          <Tooltip x={hoverPos.x + 14} y={hoverPos.y + 14}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#e8e8e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {hoveredPoint.leaf.doc.name}
            </div>
            {hoveredPoint.leaf.path.length > 0 && (
              <div style={{ fontSize: 11, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                {hoveredPoint.leaf.path.join('/')}
              </div>
            )}
            <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>Click to select</div>
          </Tooltip>
        )}

        {/* Selection panel — top right */}
        {selectedPoint && (
          <SelectionPanel
            point={selectedPoint}
            clusters={clusters}
            similarDocs={similarDocs}
            watchedSet={watchedSet}
            clusterOverride={clusterOverridesRef.current.get(selectedPoint.leaf.doc.url)}
            onOpen={openDoc}
            onToggleWatch={toggleWatch}
            onDismiss={() => setSelectedPoint(null)}
            onSelectSimilar={(url) => { const pt = pointsByUrl.get(url); if (pt) setSelectedPoint(pt); }}
            onOpenSimilar={(url) => { const pt = pointsByUrl.get(url); if (pt) openDoc(pt); }}
          />
        )}

        {/* Watched count badge */}
        {watchedSet.size > 0 && (
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 50, background: 'rgba(0,255,180,0.12)', border: '1px solid rgba(0,255,180,0.3)', borderRadius: 8, padding: '4px 10px', fontSize: 11, color: '#00ffb4', fontFamily: 'system-ui, sans-serif' }}>
            Watching {watchedSet.size} doc{watchedSet.size > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational components (extracted to reduce MapView JSX bulk)
// ---------------------------------------------------------------------------

function Separator() {
  return <span style={{ borderLeft: '1px solid #2a323c', height: 20, margin: '0 4px' }} />;
}

function Tooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, pointerEvents: 'none', zIndex: 50, background: 'rgba(20,20,35,0.92)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '7px 10px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', maxWidth: 260, fontFamily: 'system-ui, sans-serif' }}>
      {children}
    </div>
  );
}

function SimilarRow({ doc, onClick, onOpen }: { doc: SimilarDoc; onClick: () => void; onOpen?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', cursor: 'pointer' }} onClick={onClick}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: `rgb(${doc.point.color.join(',')})` }} />
      <span style={{ fontSize: 12, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {doc.name}
      </span>
      <span style={{ fontSize: 10, color: '#666', flexShrink: 0 }}>{(doc.score * 100).toFixed(0)}%</span>
      {onOpen && (
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, color: '#aaa', fontSize: 10, padding: '1px 6px', cursor: 'pointer', flexShrink: 0 }}
        >
          Open
        </button>
      )}
    </div>
  );
}

function SelectionPanel({
  point, clusters, similarDocs, watchedSet, clusterOverride,
  onOpen, onToggleWatch, onDismiss, onSelectSimilar, onOpenSimilar,
}: {
  point: MapPoint;
  clusters: Cluster[];
  similarDocs: SimilarDoc[];
  watchedSet: Set<AutomergeUrl>;
  clusterOverride?: { clusterId: number; color: [number, number, number] };
  onOpen: (pt: MapPoint) => void;
  onToggleWatch: (url: AutomergeUrl) => void;
  onDismiss: () => void;
  onSelectSimilar: (url: AutomergeUrl) => void;
  onOpenSimilar: (url: AutomergeUrl) => void;
}) {
  const isWatched = watchedSet.has(point.leaf.doc.url);
  const effectiveClusterId = clusterOverride?.clusterId ?? point.clusterId;
  const effectiveColor = clusterOverride?.color ?? point.color;
  const cluster = clusters.find((c) => c.id === effectiveClusterId);

  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 50, background: 'rgba(20,20,35,0.97)', border: `1px solid rgb(${effectiveColor.join(',')})`, borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 24px rgba(0,0,0,0.6)', maxWidth: 320, minWidth: 260, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#e8e8e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {point.leaf.doc.name}
          </div>
          {point.leaf.path.length > 0 && (
            <div style={{ fontSize: 11, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
              {point.leaf.path.join('/')}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
            <span style={{ fontSize: 10, padding: '1px 5px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, color: '#aaa' }}>
              {point.leaf.doc.type}
            </span>
            {cluster && effectiveClusterId >= 0 && (
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, color: '#fff', background: `rgb(${effectiveColor.join(',')})` }}>
                {cluster.label}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
          <button onClick={() => onOpen(point)} style={{ background: `rgb(${effectiveColor.join(',')})`, border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 12, padding: '5px 12px', cursor: 'pointer' }}>
            Open
          </button>
          <button
            onClick={() => onToggleWatch(point.leaf.doc.url)}
            style={{
              background: isWatched ? 'rgba(0,255,180,0.15)' : 'rgba(255,255,255,0.08)',
              border: `1px solid ${isWatched ? 'rgba(0,255,180,0.4)' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: 6, color: isWatched ? '#00ffb4' : '#aaa', fontSize: 11, padding: '3px 8px', cursor: 'pointer',
            }}
          >
            {isWatched ? 'Unwatch' : 'Watch'}
          </button>
          <button onClick={onDismiss} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#aaa', fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>
            Dismiss
          </button>
        </div>
      </div>

      {similarDocs.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 8, paddingTop: 6 }}>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Similar documents</div>
          {similarDocs.slice(0, SIMILAR_PANEL_COUNT).map((d) => (
            <SimilarRow
              key={d.url}
              doc={d}
              onClick={() => onSelectSimilar(d.url)}
              onOpen={() => onOpenSimilar(d.url)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
