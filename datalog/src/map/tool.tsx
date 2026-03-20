import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { ColorScale, DatalogDoc, MapStyle, PredicateStyle } from '../datatype';
import { type StoredFact, evaluate } from '../datalog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { StyleSidebar, PALETTE } from './style-sidebar';

export const MapTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <MapViewer docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ---------------------------------------------------------------------------
// Predicate categorisation
// ---------------------------------------------------------------------------

function categorisePredicates(
  facts: StoredFact[],
  geopos: Map<string, [number, number]>,
): {
  linePredicates: string[];
  unaryPredicates: string[];
  numericPredicates: string[];
  textPredicates: string[];
} {
  const linePreds = new Set<string>();
  const unaryPreds = new Set<string>();
  // Track which non-line property predicates have at least one numeric value
  const hasNumericValue = new Set<string>();
  const propPreds = new Set<string>();

  for (const f of facts) {
    if (f.pred === 'geopos') continue;
    const first = String(f.args[0]);
    if (!geopos.has(first)) continue;

    if (f.args.length === 1) {
      unaryPreds.add(f.pred);
    } else if (f.args.length >= 2) {
      if (geopos.has(String(f.args[1]))) {
        linePreds.add(f.pred);
      } else {
        propPreds.add(f.pred);
        if (typeof f.args[1] === 'number') {
          hasNumericValue.add(f.pred);
        }
      }
    }
  }

  const numericPreds = [...propPreds].filter((p) => hasNumericValue.has(p));
  const textPreds = [...propPreds].filter((p) => !hasNumericValue.has(p));

  return {
    linePredicates: [...linePreds].sort(),
    unaryPredicates: [...unaryPreds].sort(),
    numericPredicates: numericPreds.sort(),
    textPredicates: textPreds.sort(),
  };
}

// ---------------------------------------------------------------------------
// Arc / Bézier helpers
// ---------------------------------------------------------------------------

function buildArcs(
  from: [number, number],
  to: [number, number],
  n: number,
  spacing = 0.04,
): [number, number][][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return Array.from({ length: n }, () => [from, to]);

  const px = -dy / len;
  const py = dx / len;

  const arcs: [number, number][][] = [];
  for (let i = 0; i < n; i++) {
    const offset = n === 1 ? 0 : (i - (n - 1) / 2) * spacing;
    const cx = (from[0] + to[0]) / 2 + px * offset;
    const cy = (from[1] + to[1]) / 2 + py * offset;

    const pts: [number, number][] = [];
    const steps = 20;
    for (let t = 0; t <= steps; t++) {
      const u = t / steps;
      const x = (1 - u) * (1 - u) * from[0] + 2 * (1 - u) * u * cx + u * u * to[0];
      const y = (1 - u) * (1 - u) * from[1] + 2 * (1 - u) * u * cy + u * u * to[1];
      pts.push([x, y]);
    }
    arcs.push(pts);
  }
  return arcs;
}

function bearing(a: [number, number], b: [number, number]): number {
  const dLng = (b[0] - a[0]) * (Math.PI / 180);
  const lat1 = a[1] * (Math.PI / 180);
  const lat2 = b[1] * (Math.PI / 180);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ---------------------------------------------------------------------------
// Color scale interpolation
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const SCALE_STOPS: Record<ColorScale, RGB[]> = {
  'red-green':      [[239, 68, 68],  [234, 179, 8],  [34, 197, 94]],
  'green-red':      [[34, 197, 94],  [234, 179, 8],  [239, 68, 68]],
  'red-gray-green': [[239, 68, 68],  [156, 163, 175], [34, 197, 94]],
  'blue-red':       [[59, 130, 246], [6, 182, 212],  [234, 179, 8], [239, 68, 68]],
  'cool':           [[59, 130, 246], [6, 182, 212]],
  'plasma':         [[109, 40, 217], [190, 24, 93],  [245, 158, 11]],
};

function applyScale(t: number, scale: ColorScale): string {
  const stops = SCALE_STOPS[scale];
  const n = stops.length - 1;
  const pos = Math.max(0, Math.min(1, t)) * n;
  const i = Math.min(Math.floor(pos), n - 1);
  const f = pos - i;
  const [r1, g1, b1] = stops[i];
  const [r2, g2, b2] = stops[i + 1];
  const r = Math.round(r1 + (r2 - r1) * f);
  const g = Math.round(g1 + (g2 - g1) * f);
  const b = Math.round(b1 + (b2 - b1) * f);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function formatArg(v: unknown): string {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// buildGeoData
// ---------------------------------------------------------------------------

const NEUTRAL_NODE_COLOR = '#1e40af';

function buildGeoData(
  facts: StoredFact[],
  mapStyle: MapStyle | undefined,
  linePredicates: Set<string>,
  unaryPredicates: Set<string>,
  numericPredicates: Set<string>,
  allPropertyPredicates: Set<string>,
  hoveredPredicates: Set<string>,
) {
  const style = mapStyle ?? { lines: {}, properties: {} };

  // geopos index
  const geopos = new Map<string, [number, number]>();
  for (const f of facts) {
    if (f.pred === 'geopos' && f.args.length === 3) {
      const [node, lat, lng] = f.args;
      geopos.set(String(node), [Number(lng), Number(lat)]);
    }
  }

  // ── Collect active colors per node from unary and numeric predicates ──────

  const nodeActiveColors = new Map<string, string[]>();
  for (const id of geopos.keys()) nodeActiveColors.set(id, []);

  // Unary predicates → fixed color (skip if no color assigned)
  const unaryArr = [...unaryPredicates].sort();
  for (const pred of unaryArr) {
    const ps = style.properties[pred];
    if (!(ps?.enabled || hoveredPredicates.has(pred))) continue;
    const color = ps?.color;
    if (!color) continue;
    for (const f of facts) {
      if (f.pred !== pred) continue;
      const nodeId = String(f.args[0]);
      if (!nodeActiveColors.has(nodeId)) continue;
      nodeActiveColors.get(nodeId)!.push(color);
    }
  }

  // Numeric predicates with a scale → interpolated color
  for (const pred of numericPredicates) {
    const ps = style.properties[pred];
    if (!(ps?.enabled || hoveredPredicates.has(pred))) continue;
    if (!ps?.scale) continue;

    const nodeValues = new Map<string, number>();
    for (const f of facts) {
      if (f.pred !== pred) continue;
      const nodeId = String(f.args[0]);
      if (!nodeActiveColors.has(nodeId)) continue;
      if (typeof f.args[1] === 'number') nodeValues.set(nodeId, f.args[1] as number);
    }
    if (nodeValues.size === 0) continue;

    const vals = [...nodeValues.values()];
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const range = maxV - minV || 1;

    for (const [nodeId, val] of nodeValues) {
      nodeActiveColors.get(nodeId)!.push(applyScale((val - minV) / range, ps.scale));
    }
  }

  // ── Determine per-node color and ring features ─────────────────────────────
  const nodeColorMap = new Map<string, string>();
  const ringFeatures: GeoJSON.Feature[] = [];

  for (const [id, coords] of geopos) {
    const colors = nodeActiveColors.get(id) ?? [];
    if (colors.length === 0) {
      nodeColorMap.set(id, NEUTRAL_NODE_COLOR);
    } else if (colors.length === 1) {
      nodeColorMap.set(id, colors[0]);
    } else {
      nodeColorMap.set(id, NEUTRAL_NODE_COLOR);
      // Rings: largest first so smaller ones overlap on top
      for (let i = colors.length - 1; i >= 0; i--) {
        ringFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords },
          properties: { color: colors[i], radius: 8 + (i + 1) * 5 },
        });
      }
    }
  }

  // ── Node label details (enabled/hovered property predicates) ──────────────
  const nodeFacts = new Map<string, string[]>();
  for (const id of geopos.keys()) nodeFacts.set(id, []);
  for (const f of facts) {
    if (f.pred === 'geopos') continue;
    if (!allPropertyPredicates.has(f.pred)) continue;
    const ps = style.properties[f.pred];
    if (!(ps?.enabled || hoveredPredicates.has(f.pred))) continue;
    const first = String(f.args[0]);
    if (!nodeFacts.has(first)) continue;
    const argStr = f.args.slice(1).map(formatArg).join(', ');
    nodeFacts.get(first)!.push(argStr.length > 0 ? `${f.pred}(${argStr})` : f.pred);
  }

  // ── Node features ──────────────────────────────────────────────────────────
  const nodeFeatures: GeoJSON.Feature[] = [];
  for (const [id, coords] of geopos) {
    const details = nodeFacts.get(id)?.join('\n') ?? '';
    nodeFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: {
        id,
        details,
        label: details.length > 0 ? `${id}\n${details}` : id,
        nodeColor: nodeColorMap.get(id) ?? NEUTRAL_NODE_COLOR,
      },
    });
  }

  // ── Collect visible predicates per canonical pair ─────────────────────────
  const pairPreds = new Map<string, string[]>();
  for (const f of facts) {
    if (!linePredicates.has(f.pred)) continue;
    const ls = style.lines[f.pred];
    if (!(ls?.enabled || hoveredPredicates.has(f.pred))) continue;
    const a = String(f.args[0]);
    const b = String(f.args[1]);
    if (!geopos.has(a) || !geopos.has(b)) continue;
    const key = [a, b].sort().join('|');
    const existing = pairPreds.get(key) ?? [];
    if (!existing.includes(f.pred)) existing.push(f.pred);
    pairPreds.set(key, existing);
  }

  // ── Pre-compute arcs per pair ──────────────────────────────────────────────
  const pairArcs = new Map<string, [number, number][][]>();
  for (const [key, preds] of pairPreds) {
    const [aId, bId] = key.split('|');
    pairArcs.set(key, buildArcs(geopos.get(aId)!, geopos.get(bId)!, preds.length));
  }

  // ── Edge features ─────────────────────────────────────────────────────────
  const edgeFeatures: GeoJSON.Feature[] = [];
  const edgeLabelFeatures: GeoJSON.Feature[] = [];
  const arrowFeatures: GeoJSON.Feature[] = [];

  for (const f of facts) {
    if (!linePredicates.has(f.pred)) continue;
    const ls = style.lines[f.pred];
    const isHovered = hoveredPredicates.has(f.pred);
    if (!(ls?.enabled || isHovered)) continue;

    const fromKey = String(f.args[0]);
    const toKey = String(f.args[1]);
    const fromCoords = geopos.get(fromKey);
    const toCoords = geopos.get(toKey);
    if (!fromCoords || !toCoords) continue;

    const pairKey = [fromKey, toKey].sort().join('|');
    const predsForPair = pairPreds.get(pairKey) ?? [f.pred];
    const predIndex = predsForPair.indexOf(f.pred);
    const arcCoordsRaw = pairArcs.get(pairKey)![predIndex];
    const [sortedA] = pairKey.split('|');
    const arcCoords = sortedA === fromKey ? arcCoordsRaw : [...arcCoordsRaw].reverse();

    const color = ls?.color ?? PALETTE[0];
    const opacity = isHovered && !ls?.enabled ? 0.35 : 0.85;
    const extraArgs = f.args.slice(2);
    const labelText = extraArgs.length > 0
      ? `${f.pred}: ${extraArgs.map(formatArg).join(', ')}`
      : f.pred;

    edgeFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: arcCoords },
      properties: {
        pred: f.pred,
        label: `${f.pred}(${f.args.map(formatArg).join(', ')})`,
        color,
        width: Math.min(2 + f.args.length, 6),
        opacity,
      },
    });

    edgeLabelFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: arcCoords },
      properties: { label: labelText, color },
    });

    const direction = ls?.direction ?? 'none';
    if (direction !== 'none') {
      const n = arcCoords.length;
      let arrowBearing: number;
      let arrowPos: [number, number];
      if (direction === 'forward') {
        // Place one step before the destination so the node circle doesn't hide the arrow
        arrowBearing = bearing(arcCoords[n - 2] as [number, number], arcCoords[n - 1] as [number, number]);
        arrowPos = arcCoords[n - 2] as [number, number];
      } else {
        arrowBearing = bearing(arcCoords[1] as [number, number], arcCoords[0] as [number, number]);
        arrowPos = arcCoords[1] as [number, number];
      }
      arrowFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: arrowPos },
        properties: { bearing: arrowBearing, color },
      });
    }
  }

  return {
    nodes: { type: 'FeatureCollection' as const, features: nodeFeatures },
    rings: { type: 'FeatureCollection' as const, features: ringFeatures },
    edges: { type: 'FeatureCollection' as const, features: edgeFeatures },
    edgeLabels: { type: 'FeatureCollection' as const, features: edgeLabelFeatures },
    arrows: { type: 'FeatureCollection' as const, features: arrowFeatures },
    geopos,
  };
}

// ---------------------------------------------------------------------------
// World-covering polygon for the fade overlay
// ---------------------------------------------------------------------------

const WORLD_POLYGON: GeoJSON.Feature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]],
  },
  properties: {},
};

// ---------------------------------------------------------------------------
// Arrow image — SDF white triangle so icon-color can tint it
// ---------------------------------------------------------------------------

function createArrowImage(size = 24): { width: number; height: number; data: Uint8ClampedArray } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(half, 2);
  ctx.lineTo(size - 4, size - 3);
  ctx.lineTo(4, size - 3);
  ctx.closePath();
  ctx.fill();
  const imgData = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: imgData.data };
}

// ---------------------------------------------------------------------------
// NodeHoverPopup
// ---------------------------------------------------------------------------

interface HoverNodeInfo { nodeId: string; x: number; y: number; facts: string[] }

function NodeHoverPopup({ info }: { info: HoverNodeInfo }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: info.x + 14,
        top: info.y - 8,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        padding: '8px 10px',
        zIndex: 30,
        minWidth: 140,
        maxWidth: 220,
        pointerEvents: 'none',
      }}
    >
      <p style={{ margin: '0 0 4px 0', fontWeight: 700, fontSize: 13, color: '#111827' }}>
        {info.nodeId}
      </p>
      {info.facts.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>No properties</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {info.facts.map((f) => (
            <span key={f} style={{ fontSize: 12, color: '#374151' }}>{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EdgeHoverPopup
// ---------------------------------------------------------------------------

interface HoverEdgeInfo { label: string; x: number; y: number }

function EdgeHoverPopup({ info }: { info: HoverEdgeInfo }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: info.x + 14,
        top: info.y - 8,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        padding: '5px 8px',
        zIndex: 30,
        pointerEvents: 'none',
        fontSize: 12,
        color: '#374151',
        whiteSpace: 'nowrap',
      }}
    >
      {info.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MapViewer
// ---------------------------------------------------------------------------

function MapViewer({ docUrl }: { docUrl: AutomergeUrl }) {
  const [doc, changeDoc] = useDocument<DatalogDoc>(docUrl);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const fittedRef = useRef(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<HoverNodeInfo | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<HoverEdgeInfo | null>(null);
  const [hoveredSidebarPred, setHoveredSidebarPred] = useState<string | null>(null);

  const derivedFactsRef = useRef<StoredFact[]>([]);
  const allPropertyPredicatesRef = useRef<Set<string>>(new Set());
  const changeDocRef = useRef(changeDoc);
  changeDocRef.current = changeDoc;

  // ── Datalog evaluation ────────────────────────────────────────────────────

  const derivedFacts = useMemo<StoredFact[]>(() => {
    if (!doc) return [];
    const facts = doc.facts ?? [];
    const rules = doc.rules ?? [];
    try { return evaluate(facts, rules); } catch { return facts; }
  }, [doc]);

  derivedFactsRef.current = derivedFacts;

  // ── Predicate classification ───────────────────────────────────────────────

  const { linePredicates, unaryPredicates, numericPredicates, textPredicates, geopos } = useMemo(() => {
    const gp = new Map<string, [number, number]>();
    for (const f of derivedFacts) {
      if (f.pred === 'geopos' && f.args.length === 3) {
        const [node, lat, lng] = f.args;
        gp.set(String(node), [Number(lng), Number(lat)]);
      }
    }
    const cats = categorisePredicates(derivedFacts, gp);
    return { ...cats, geopos: gp };
  }, [derivedFacts]);

  const allPropertyPredicates = useMemo(
    () => [...unaryPredicates, ...numericPredicates, ...textPredicates],
    [unaryPredicates, numericPredicates, textPredicates],
  );

  const linePredicatesSet = useMemo(() => new Set(linePredicates), [linePredicates]);
  const unaryPredicatesSet = useMemo(() => new Set(unaryPredicates), [unaryPredicates]);
  const numericPredicatesSet = useMemo(() => new Set(numericPredicates), [numericPredicates]);
  const allPropertyPredicatesSet = useMemo(() => new Set(allPropertyPredicates), [allPropertyPredicates]);
  allPropertyPredicatesRef.current = allPropertyPredicatesSet;

  // Auto-init new predicates
  useEffect(() => {
    if (!doc?.mapStyle) return;
    const newLines = linePredicates.filter((p) => !(p in doc.mapStyle.lines));
    const newProps = allPropertyPredicates.filter((p) => !(p in doc.mapStyle.properties));
    if (newLines.length === 0 && newProps.length === 0) return;
    changeDoc((d) => {
      if (!d.mapStyle) d.mapStyle = { lines: {}, properties: {} };
      for (const p of newLines) {
        const idx = linePredicates.indexOf(p);
        d.mapStyle.lines[p] = {
          color: PALETTE[idx % PALETTE.length],
          enabled: false,
          direction: 'none',
          scale: null,
        };
      }
      for (const p of newProps) {
        const isUnary = unaryPredicates.includes(p);
        const idx = isUnary ? unaryPredicates.indexOf(p) : 0;
        d.mapStyle.properties[p] = {
          color: isUnary ? PALETTE[idx % PALETTE.length] : null,
          enabled: false,
          direction: 'none',
          scale: null,
        };
      }
    });
  }, [linePredicates, allPropertyPredicates, unaryPredicates, doc?.mapStyle, changeDoc]);

  const mapStyle = doc?.mapStyle ?? { lines: {}, properties: {} };

  // ── Sidebar hover → hovered predicates set ────────────────────────────────

  const hoveredPredicates = useMemo(
    () => new Set(hoveredSidebarPred ? [hoveredSidebarPred] : []),
    [hoveredSidebarPred],
  );

  // ── GeoJSON data ───────────────────────────────────────────────────────────

  const geoData = useMemo(
    () => buildGeoData(
      derivedFacts,
      mapStyle,
      linePredicatesSet,
      unaryPredicatesSet,
      numericPredicatesSet,
      allPropertyPredicatesSet,
      hoveredPredicates,
    ),
    [derivedFacts, mapStyle, linePredicatesSet, unaryPredicatesSet, numericPredicatesSet, allPropertyPredicatesSet, hoveredPredicates],
  );

  const geoDataRef = useRef(geoData);
  geoDataRef.current = geoData;

  // ── Map initialisation ────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: 'https://tiles.openfreemap.org/styles/positron',
        center: [13.4, 52.5],
        zoom: 5,
      });
    } catch (err) {
      console.error('[MapTool] Failed to construct maplibregl.Map:', err);
      return;
    }
    mapRef.current = map;

    map.on('load', () => {
      try {
        // Register arrow as SDF image so icon-color works
        const arrowImg = createArrowImage(24);
        map.addImage('arrow-head', arrowImg, { sdf: true });

        // ── Fade overlay ──────────────────────────────────────────────────
        map.addSource('fade', { type: 'geojson', data: WORLD_POLYGON });
        map.addLayer({
          id: 'map-fade',
          type: 'fill',
          source: 'fade',
          paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.45 },
        });

        // ── Edges ──────────────────────────────────────────────────────────
        map.addSource('edges', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'edges-line',
          type: 'line',
          source: 'edges',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'width'],
            'line-opacity': ['get', 'opacity'],
          },
        });

        // ── Edge labels (on-line, rotated with the arc) ────────────────────
        map.addSource('edge-labels', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'edge-labels-symbol',
          type: 'symbol',
          source: 'edge-labels',
          layout: {
            'symbol-placement': 'line-center',
            'text-field': ['get', 'label'],
            'text-size': 12,
            'text-font': ['Noto Sans Regular'],
            'text-rotation-alignment': 'map',
            'text-pitch-alignment': 'viewport',
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': '#fff',
            'text-halo-width': 2,
          },
        });

        // ── Rings (behind nodes, only for 2+ active colors) ────────────────
        map.addSource('rings', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'rings-circle',
          type: 'circle',
          source: 'rings',
          paint: {
            'circle-radius': ['get', 'radius'],
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.9,
          },
        });

        // ── Nodes ──────────────────────────────────────────────────────────
        map.addSource('nodes', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'nodes-circle',
          type: 'circle',
          source: 'nodes',
          paint: {
            'circle-radius': 8,
            'circle-color': ['get', 'nodeColor'],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2,
          },
        });
        map.addLayer({
          id: 'nodes-label',
          type: 'symbol',
          source: 'nodes',
          layout: {
            'text-field': [
              'format',
              ['get', 'id'],
              { 'font-scale': 1.2, 'text-font': ['literal', ['Noto Sans Bold']] },
              '\n',
              {},
              ['get', 'details'],
              { 'font-scale': 0.85, 'text-font': ['literal', ['Noto Sans Regular']] },
            ],
            'text-size': 14,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
          },
          paint: {
            'text-color': '#1e293b',
            'text-halo-color': '#fff',
            'text-halo-width': 2,
          },
        });

        // ── Arrow heads (on top of nodes so they're not hidden) ────────────
        map.addSource('edge-arrows', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'edge-arrows-symbol',
          type: 'symbol',
          source: 'edge-arrows',
          layout: {
            'icon-image': 'arrow-head',
            'icon-size': 0.8,
            'icon-rotate': ['get', 'bearing'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: {
            'icon-color': ['get', 'color'],
            'icon-opacity': 0.9,
          },
        });

        // Push initial data
        const d = geoDataRef.current;
        (map.getSource('nodes') as maplibregl.GeoJSONSource).setData(d.nodes);
        (map.getSource('rings') as maplibregl.GeoJSONSource).setData(d.rings);
        (map.getSource('edges') as maplibregl.GeoJSONSource).setData(d.edges);
        (map.getSource('edge-labels') as maplibregl.GeoJSONSource).setData(d.edgeLabels);
        (map.getSource('edge-arrows') as maplibregl.GeoJSONSource).setData(d.arrows);

        if (d.geopos.size > 0) {
          fittedRef.current = true;
          const bounds = new maplibregl.LngLatBounds();
          for (const coords of d.geopos.values()) bounds.extend(coords);
          map.fitBounds(bounds, { padding: 80, maxZoom: 10, duration: 500 });
        }

        // ── Node hover ─────────────────────────────────────────────────────
        map.on('mousemove', 'nodes-circle', (e) => {
          if (!e.features?.length) return;
          const nodeId = e.features[0].properties?.id as string;
          if (!nodeId) return;
          const propPreds = allPropertyPredicatesRef.current;
          const allFacts = derivedFactsRef.current;
          const factStrs: string[] = [];
          for (const f of allFacts) {
            if (!propPreds.has(f.pred)) continue;
            if (String(f.args[0]) !== nodeId) continue;
            const argStr = f.args.slice(1).map(formatArg).join(', ');
            factStrs.push(argStr.length > 0 ? `${f.pred}(${argStr})` : f.pred);
          }
          setHoveredNode({ nodeId, x: e.point.x, y: e.point.y, facts: factStrs });
          setHoveredEdge(null);
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'nodes-circle', () => {
          setHoveredNode(null);
          map.getCanvas().style.cursor = '';
        });

        // ── Edge hover ─────────────────────────────────────────────────────
        const onEdgeMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          if (!e.features?.length) return;
          const label = e.features[0].properties?.label as string;
          if (!label) return;
          setHoveredEdge({ label, x: e.point.x, y: e.point.y });
          setHoveredNode(null);
          map.getCanvas().style.cursor = 'pointer';
        };
        const onEdgeLeave = () => {
          setHoveredEdge(null);
          map.getCanvas().style.cursor = '';
        };
        map.on('mousemove', 'edges-line', onEdgeMove);
        map.on('mouseleave', 'edges-line', onEdgeLeave);
      } catch (err) {
        console.error('[MapTool] Error adding sources/layers:', err);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  // ── Update sources when data changes ──────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    (map.getSource('nodes') as maplibregl.GeoJSONSource | undefined)?.setData(geoData.nodes);
    (map.getSource('rings') as maplibregl.GeoJSONSource | undefined)?.setData(geoData.rings);
    (map.getSource('edges') as maplibregl.GeoJSONSource | undefined)?.setData(geoData.edges);
    (map.getSource('edge-labels') as maplibregl.GeoJSONSource | undefined)?.setData(geoData.edgeLabels);
    (map.getSource('edge-arrows') as maplibregl.GeoJSONSource | undefined)?.setData(geoData.arrows);
    if (!fittedRef.current && geoData.geopos.size > 0) {
      fittedRef.current = true;
      const bounds = new maplibregl.LngLatBounds();
      for (const coords of geoData.geopos.values()) bounds.extend(coords);
      map.fitBounds(bounds, { padding: 80, maxZoom: 10, duration: 500 });
    }
  }, [geoData]);

  // ── Style update callbacks ─────────────────────────────────────────────────

  const handleUpdateLine = (pred: string, patch: Partial<PredicateStyle>) => {
    changeDoc((d) => {
      if (!d.mapStyle) d.mapStyle = { lines: {}, properties: {} };
      if (!d.mapStyle.lines[pred]) {
        d.mapStyle.lines[pred] = { color: PALETTE[0], enabled: false, direction: 'none', scale: null };
      }
      Object.assign(d.mapStyle.lines[pred], patch);
    });
  };

  const handleUpdateProperty = (pred: string, patch: Partial<PredicateStyle>) => {
    changeDoc((d) => {
      if (!d.mapStyle) d.mapStyle = { lines: {}, properties: {} };
      if (!d.mapStyle.properties[pred]) {
        d.mapStyle.properties[pred] = { color: null, enabled: false, direction: 'none', scale: null };
      }
      Object.assign(d.mapStyle.properties[pred], patch);
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      <button
        onClick={() => setSidebarOpen((o) => !o)}
        title="Map style settings"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 10,
          width: 32,
          height: 32,
          borderRadius: 6,
          border: '1px solid #e5e7eb',
          background: sidebarOpen ? '#dbeafe' : '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          color: sidebarOpen ? '#1d4ed8' : '#374151',
        }}
      >
        <Settings size={16} />
      </button>

      <StyleSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        mapStyle={mapStyle}
        linePredicates={linePredicates}
        unaryPredicates={unaryPredicates}
        numericPredicates={numericPredicates}
        textPredicates={textPredicates}
        onUpdateLine={handleUpdateLine}
        onUpdateProperty={handleUpdateProperty}
        onHoverPred={setHoveredSidebarPred}
      />

      {hoveredNode && <NodeHoverPopup info={hoveredNode} />}
      {hoveredEdge && <EdgeHoverPopup info={hoveredEdge} />}
    </div>
  );
}
