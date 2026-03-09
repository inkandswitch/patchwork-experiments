import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { DatalogDoc, MapStyle, PredicateStyle } from '../datalog/datatype';
import { type StoredFact, parseProgram, evaluate } from '../datalog/datalog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { StyleSidebar } from './style-sidebar';

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
): { linePredicates: string[]; propertyPredicates: string[] } {
  const linePreds = new Set<string>();
  const propPreds = new Set<string>();
  for (const f of facts) {
    if (f.pred === 'geopos') continue;
    if (f.args.length < 2) continue;
    if (!geopos.has(String(f.args[0]))) continue;
    if (geopos.has(String(f.args[1]))) {
      linePreds.add(f.pred);
    } else {
      propPreds.add(f.pred);
    }
  }
  return { linePredicates: [...linePreds].sort(), propertyPredicates: [...propPreds].sort() };
}

// ---------------------------------------------------------------------------
// buildGeoData
// ---------------------------------------------------------------------------

function buildGeoData(
  facts: StoredFact[],
  mapStyle: MapStyle | undefined,
  linePredicates: Set<string>,
  propertyPredicates: Set<string>,
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

  // ── Node label details (showLabel properties only) ────────────────────────
  const nodeFacts = new Map<string, string[]>();
  for (const id of geopos.keys()) nodeFacts.set(id, []);
  for (const f of facts) {
    if (f.pred === 'geopos') continue;
    if (!propertyPredicates.has(f.pred)) continue;
    if (!(style.properties[f.pred]?.showLabel ?? false)) continue;
    const first = String(f.args[0]);
    if (!nodeFacts.has(first)) continue;
    const argStr = f.args.slice(1).join(', ');
    nodeFacts.get(first)!.push(argStr.length > 0 ? `${f.pred}(${argStr})` : f.pred);
  }

  // ── Node ring colors ───────────────────────────────────────────────────────
  const nodeRingColors = new Map<string, string[]>();
  for (const id of geopos.keys()) nodeRingColors.set(id, []);
  for (const pred of [...propertyPredicates].sort()) {
    const color = style.properties[pred]?.color ?? null;
    if (!color) continue;
    for (const f of facts) {
      if (f.pred !== pred) continue;
      const nodeId = String(f.args[0]);
      if (!nodeRingColors.has(nodeId)) continue;
      if (!nodeRingColors.get(nodeId)!.includes(color)) {
        nodeRingColors.get(nodeId)!.push(color);
      }
    }
  }

  // ── Node features ──────────────────────────────────────────────────────────
  const nodeFeatures: GeoJSON.Feature[] = [];
  for (const [id, coords] of geopos) {
    const details = nodeFacts.get(id)?.join('\n') ?? '';
    nodeFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { id, details, label: details.length > 0 ? `${id}\n${details}` : id },
    });
  }

  // ── Ring features (largest radius first = renders behind smaller rings) ────
  const ringFeatures: GeoJSON.Feature[] = [];
  for (const [id, coords] of geopos) {
    const colors = nodeRingColors.get(id) ?? [];
    for (let i = colors.length - 1; i >= 0; i--) {
      ringFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: { color: colors[i], radius: 8 + (i + 1) * 5 },
      });
    }
  }

  // ── Edge features (straight lines, dashed for multi-predicate pairs) ───────
  // Track which predicates appear per canonical pair
  const pairPreds = new Map<string, string[]>();
  for (const f of facts) {
    if (!linePredicates.has(f.pred)) continue;
    if (!(style.lines[f.pred]?.color)) continue;
    const a = String(f.args[0]);
    const b = String(f.args[1]);
    if (!geopos.has(a) || !geopos.has(b)) continue;
    const key = [a, b].sort().join('|');
    const existing = pairPreds.get(key) ?? [];
    if (!existing.includes(f.pred)) existing.push(f.pred);
    pairPreds.set(key, existing);
  }

  const edgeFeatures: GeoJSON.Feature[] = [];
  // Per-pair label accumulator: pairKey → { mid, texts[] }
  const pairLabelMap = new Map<string, { mid: [number, number]; texts: string[] }>();

  for (const f of facts) {
    if (!linePredicates.has(f.pred)) continue;
    const lineStyle = style.lines[f.pred];
    if (!lineStyle?.color) continue;

    const fromKey = String(f.args[0]);
    const toKey = String(f.args[1]);
    const fromCoords = geopos.get(fromKey);
    const toCoords = geopos.get(toKey);
    if (!fromCoords || !toCoords) continue;

    const pairKey = [fromKey, toKey].sort().join('|');
    const predsForPair = pairPreds.get(pairKey) ?? [f.pred];
    const predIndex = predsForPair.indexOf(f.pred);
    const dashed = predIndex > 0;

    const extraArgs = f.args.slice(2);
    const label = extraArgs.length > 0 ? `${f.pred}(${extraArgs.join(', ')})` : f.pred;

    edgeFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [fromCoords, toCoords] },
      properties: {
        pred: f.pred,
        label,
        color: lineStyle.color,
        width: Math.min(2 + f.args.length, 6),
        dashed,
      },
    });

    // Accumulate labels for this pair
    if (lineStyle.showLabel) {
      const mid: [number, number] = [
        (fromCoords[0] + toCoords[0]) / 2,
        (fromCoords[1] + toCoords[1]) / 2,
      ];
      if (!pairLabelMap.has(pairKey)) {
        pairLabelMap.set(pairKey, { mid, texts: [] });
      }
      pairLabelMap.get(pairKey)!.texts.push(label);
    }
  }

  // One combined label Point feature per pair
  const edgeLabelFeatures: GeoJSON.Feature[] = [];
  for (const { mid, texts } of pairLabelMap.values()) {
    edgeLabelFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: mid },
      properties: { label: texts.join('\n') },
    });
  }

  return {
    nodes: { type: 'FeatureCollection' as const, features: nodeFeatures },
    rings: { type: 'FeatureCollection' as const, features: ringFeatures },
    edges: { type: 'FeatureCollection' as const, features: edgeFeatures },
    edgeLabels: { type: 'FeatureCollection' as const, features: edgeLabelFeatures },
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
// NodeHoverPopup
// ---------------------------------------------------------------------------

interface HoverNodeInfo {
  nodeId: string;
  x: number;
  y: number;
  facts: string[];
}

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

interface HoverEdgeInfo {
  label: string;
  x: number;
  y: number;
}

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

  const derivedFactsRef = useRef<StoredFact[]>([]);
  const propertyPredicatesRef = useRef<Set<string>>(new Set());
  const changeDocRef = useRef(changeDoc);
  changeDocRef.current = changeDoc;

  // ── Datalog evaluation ────────────────────────────────────────────────────

  const derivedFacts = useMemo<StoredFact[]>(() => {
    if (!doc) return [];
    const fp = parseProgram(doc.factsText ?? '');
    const rp = parseProgram(doc.rulesText ?? '');
    try { return evaluate(fp.facts, rp.rules); } catch { return fp.facts; }
  }, [doc]);

  derivedFactsRef.current = derivedFacts;

  // ── Predicate classification ───────────────────────────────────────────────

  const { linePredicates, propertyPredicates, geopos } = useMemo(() => {
    const gp = new Map<string, [number, number]>();
    for (const f of derivedFacts) {
      if (f.pred === 'geopos' && f.args.length === 3) {
        const [node, lat, lng] = f.args;
        gp.set(String(node), [Number(lng), Number(lat)]);
      }
    }
    const { linePredicates: lp, propertyPredicates: pp } = categorisePredicates(derivedFacts, gp);
    return { linePredicates: lp, propertyPredicates: pp, geopos: gp };
  }, [derivedFacts]);

  const linePredicatesSet = useMemo(() => new Set(linePredicates), [linePredicates]);
  const propertyPredicatesSet = useMemo(() => new Set(propertyPredicates), [propertyPredicates]);
  propertyPredicatesRef.current = propertyPredicatesSet;

  // Auto-init new predicates in the document
  useEffect(() => {
    if (!doc?.mapStyle) return;
    const newLines = linePredicates.filter((p) => !(p in doc.mapStyle.lines));
    const newProps = propertyPredicates.filter((p) => !(p in doc.mapStyle.properties));
    if (newLines.length === 0 && newProps.length === 0) return;
    changeDoc((d) => {
      if (!d.mapStyle) d.mapStyle = { lines: {}, properties: {} };
      for (const p of newLines) d.mapStyle.lines[p] = { color: null, showLabel: false };
      for (const p of newProps) d.mapStyle.properties[p] = { color: null, showLabel: false };
    });
  }, [linePredicates, propertyPredicates, doc?.mapStyle, changeDoc]);

  const mapStyle = doc?.mapStyle ?? { lines: {}, properties: {} };

  // ── GeoJSON data ───────────────────────────────────────────────────────────

  const geoData = useMemo(
    () => buildGeoData(derivedFacts, mapStyle, linePredicatesSet, propertyPredicatesSet),
    [derivedFacts, mapStyle, linePredicatesSet, propertyPredicatesSet],
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
        // ── Fade overlay (washes out base map) ────────────────────────────
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
          id: 'edges-solid',
          type: 'line',
          source: 'edges',
          filter: ['!', ['get', 'dashed']],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'width'],
            'line-opacity': 0.85,
          },
        });
        map.addLayer({
          id: 'edges-dashed',
          type: 'line',
          source: 'edges',
          filter: ['get', 'dashed'],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'width'],
            'line-opacity': 0.85,
            'line-dasharray': [6, 4],
          },
        });

        // ── Edge labels (combined per pair, Point source) ──────────────────
        map.addSource('edge-labels', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'edge-labels-symbol',
          type: 'symbol',
          source: 'edge-labels',
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 13,
            'text-font': ['Noto Sans Regular'],
            'text-anchor': 'center',
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': '#1e293b',
            'text-halo-color': '#fff',
            'text-halo-width': 2,
          },
        });

        // ── Rings (behind nodes) ───────────────────────────────────────────
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
            'circle-color': '#1e40af',
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

        // Push initial data
        const d = geoDataRef.current;
        (map.getSource('nodes') as maplibregl.GeoJSONSource).setData(d.nodes);
        (map.getSource('rings') as maplibregl.GeoJSONSource).setData(d.rings);
        (map.getSource('edges') as maplibregl.GeoJSONSource).setData(d.edges);
        (map.getSource('edge-labels') as maplibregl.GeoJSONSource).setData(d.edgeLabels);

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
          const propPreds = propertyPredicatesRef.current;
          const allFacts = derivedFactsRef.current;
          const factStrs: string[] = [];
          for (const f of allFacts) {
            if (!propPreds.has(f.pred)) continue;
            if (String(f.args[0]) !== nodeId) continue;
            const argStr = f.args.slice(1).join(', ');
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
        map.on('mousemove', 'edges-solid', onEdgeMove);
        map.on('mouseleave', 'edges-solid', onEdgeLeave);
        map.on('mousemove', 'edges-dashed', onEdgeMove);
        map.on('mouseleave', 'edges-dashed', onEdgeLeave);
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
      if (!d.mapStyle.lines[pred]) d.mapStyle.lines[pred] = { color: null, showLabel: false };
      Object.assign(d.mapStyle.lines[pred], patch);
    });
  };

  const handleUpdateProperty = (pred: string, patch: Partial<PredicateStyle>) => {
    changeDoc((d) => {
      if (!d.mapStyle) d.mapStyle = { lines: {}, properties: {} };
      if (!d.mapStyle.properties[pred]) d.mapStyle.properties[pred] = { color: null, showLabel: false };
      Object.assign(d.mapStyle.properties[pred], patch);
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Gear button */}
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

      {/* Style sidebar */}
      <StyleSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        mapStyle={mapStyle}
        linePredicates={linePredicates}
        propertyPredicates={propertyPredicates}
        onUpdateLine={handleUpdateLine}
        onUpdateProperty={handleUpdateProperty}
      />

      {/* Node hover popup */}
      {hoveredNode && <NodeHoverPopup info={hoveredNode} />}

      {/* Edge hover popup */}
      {hoveredEdge && <EdgeHoverPopup info={hoveredEdge} />}
    </div>
  );
}
