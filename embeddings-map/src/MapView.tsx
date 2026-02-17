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
import type { Point2D } from './projection';
import type { LeafDoc } from './tool';

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
  onBack: () => void;
};

/** [left, bottom, right, top] in world coordinates */
type WorldBounds = [number, number, number, number];

// ---------------------------------------------------------------------------
// View (singleton)
// ---------------------------------------------------------------------------

const VIEW = new OrthographicView({ id: '2d-scene', controller: true });

// ---------------------------------------------------------------------------
// Data bounds
// ---------------------------------------------------------------------------

function computeDataBounds(points: MapPoint[], padding = 0.15): WorldBounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    const [x, y] = p.position;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const padX = (maxX - minX || 1) * padding;
  const padY = (maxY - minY || 1) * padding;
  return [minX - padX, minY - padY, maxX + padX, maxY + padY];
}

// ---------------------------------------------------------------------------
// Fit-to-view
// ---------------------------------------------------------------------------

function computeFitViewState(
  bounds: WorldBounds,
  width: number,
  height: number,
) {
  const [left, bottom, right, top] = bounds;
  const cx = (left + right) / 2;
  const cy = (bottom + top) / 2;
  const extentX = right - left || 1;
  const extentY = top - bottom || 1;
  const zoom = Math.log2(Math.min(width / extentX, height / extentY));
  return {
    target: [cx, cy, 0] as [number, number, number],
    zoom: Math.max(-4, Math.min(zoom, 8)),
  };
}

// ---------------------------------------------------------------------------
// Pre-rendered density canvas
// ---------------------------------------------------------------------------

function renderDensityCanvas(
  points: MapPoint[],
  bounds: WorldBounds,
): HTMLCanvasElement {
  const [left, bottom, right, top] = bounds;
  const worldW = right - left || 1;
  const worldH = top - bottom || 1;

  const maxRes = 1024;
  let canvasW: number, canvasH: number;
  if (worldW >= worldH) {
    canvasW = maxRes;
    canvasH = Math.max(256, Math.round(maxRes * (worldH / worldW)));
  } else {
    canvasH = maxRes;
    canvasW = Math.max(256, Math.round(maxRes * (worldW / worldH)));
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  const radius = Math.max(canvasW, canvasH) * 0.05;
  const n = points.length;
  const alpha = Math.min(0.08, Math.max(0.015, 4 / Math.sqrt(n)));

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

  return canvas;
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

export function MapView({ points, clusters, onBack }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapSize = useSize(mapRef);

  const [hoveredPoint, setHoveredPoint] = useState<MapPoint | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [showDensity, setShowDensity] = useState(true);

  // Controlled viewState
  const [viewState, setViewState] = useState<any>(null);
  const didInit = useRef(false);

  const nonNoiseClusters = useMemo(
    () => clusters.filter((c) => c.id >= 0),
    [clusters],
  );
  const dataBounds = useMemo(() => computeDataBounds(points), [points]);
  const densityCanvas = useMemo(
    () => renderDensityCanvas(points, dataBounds),
    [points, dataBounds],
  );

  // Set initial viewState once container has a size
  useEffect(() => {
    if (didInit.current || !mapSize) return;
    didInit.current = true;
    setViewState(computeFitViewState(dataBounds, mapSize.w, mapSize.h));
  }, [mapSize, dataBounds]);

  // Fit button: recompute from current container size
  const handleFit = useCallback(() => {
    if (!mapSize) return;
    setViewState(computeFitViewState(dataBounds, mapSize.w, mapSize.h));
  }, [dataBounds, mapSize]);

  const onViewStateChange = useCallback(({ viewState: vs }: any) => {
    setViewState(vs);
  }, []);

  // Layers
  const layers = useMemo(() => {
    const result: any[] = [];

    if (showDensity && densityCanvas) {
      result.push(
        new BitmapLayer({
          id: 'density',
          image: densityCanvas,
          bounds: dataBounds,
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          opacity: 1,
        }),
      );
    }

    result.push(
      new ScatterplotLayer<MapPoint>({
        id: 'scatter',
        data: points,
        getPosition: (d: MapPoint) => d.position,
        getFillColor: (d: MapPoint) => [...d.color, 230] as [number, number, number, number],
        getLineColor: [20, 20, 35, 200],
        stroked: true,
        lineWidthMinPixels: 1,
        lineWidthMaxPixels: 1,
        getRadius: 5,
        radiusMinPixels: 4,
        radiusMaxPixels: 12,
        radiusUnits: 'pixels' as const,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        pickable: true,
        onHover: (info: PickingInfo<MapPoint>) => {
          if (info.object) {
            setHoveredPoint(info.object);
            setHoverPos({ x: info.x, y: info.y });
          } else {
            setHoveredPoint(null);
            setHoverPos(null);
          }
        },
        updateTriggers: { getFillColor: [points] },
      }),
    );

    if (showLabels) {
      result.push(
        new TextLayer<Cluster>({
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
          getBackgroundColor: (d: Cluster) =>
            [...d.color, 180] as [number, number, number, number],
          backgroundPadding: [6, 3, 6, 3],
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          fontWeight: 600,
        }),
      );
    }

    return result;
  }, [points, nonNoiseClusters, showLabels, showDensity, densityCanvas, dataBounds]);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#1a1a2e', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#191e24', borderBottom: '1px solid #2a323c', flexShrink: 0, zIndex: 10 }}>
        <button className="btn btn-sm btn-ghost" onClick={onBack}>&larr; Back</button>
        <span style={{ borderLeft: '1px solid #2a323c', height: 20, margin: '0 4px' }} />
        <span style={{ fontSize: 13, opacity: 0.6 }}>{points.length} pts &middot; {nonNoiseClusters.length} clusters</span>
        <span style={{ borderLeft: '1px solid #2a323c', height: 20, margin: '0 4px' }} />
        <button className="btn btn-xs btn-outline" onClick={handleFit}>Fit</button>
        <button className={`btn btn-xs ${showLabels ? 'btn-primary' : 'btn-outline'}`} onClick={() => setShowLabels((v) => !v)}>Labels</button>
        <button className={`btn btn-xs ${showDensity ? 'btn-primary' : 'btn-outline'}`} onClick={() => setShowDensity((v) => !v)}>Density</button>
      </div>

      {/* Map */}
      <div ref={mapRef} style={{ flex: '1 1 0', position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        {mapSize && viewState && (
          <DeckGL
            views={VIEW}
            viewState={viewState}
            onViewStateChange={onViewStateChange}
            layers={layers}
            width={mapSize.w}
            height={mapSize.h}
          />
        )}

        {/* Tooltip */}
        {hoveredPoint && hoverPos && (
          <div style={{
            position: 'absolute',
            left: hoverPos.x + 14,
            top: hoverPos.y + 14,
            pointerEvents: 'none',
            zIndex: 50,
            background: 'rgba(20,20,35,0.95)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            padding: '8px 10px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            maxWidth: 280,
            fontFamily: 'system-ui, sans-serif',
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#e8e8e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {hoveredPoint.leaf.doc.name}
            </div>
            {hoveredPoint.leaf.path.length > 0 && (
              <div style={{ fontSize: 11, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                {hoveredPoint.leaf.path.join('/')}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 10, padding: '1px 5px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, color: '#aaa' }}>
                {hoveredPoint.leaf.doc.type}
              </span>
              {hoveredPoint.clusterId >= 0 && (
                <span style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  borderRadius: 4,
                  color: '#fff',
                  background: `rgb(${hoveredPoint.color.join(',')})`,
                }}>
                  {clusters.find((c) => c.id === hoveredPoint.clusterId)?.label ?? ''}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
