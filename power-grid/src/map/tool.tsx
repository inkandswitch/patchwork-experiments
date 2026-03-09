import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { DatalogDoc } from '../datalog/datatype';
import { type StoredFact, parseProgram, evaluate } from '../datalog/datalog';
import { useEffect, useMemo, useRef } from 'react';

console.log('new version!!!!');

console.log('[MapTool] module loaded, maplibregl:', maplibregl);

export const MapTool: ToolRender = (handle, element) => {
  console.log('[MapTool] render called');
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <MapViewer docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// Derive a stable hue from a predicate name, then pick a palette color.
const PALETTE = [
  '#3b82f6', // blue
  '#f97316', // orange
  '#22c55e', // green
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#eab308', // yellow
  '#ef4444', // red
  '#6366f1', // indigo
  '#84cc16', // lime
];

function hashPred(pred: string): number {
  let h = 0;
  for (let i = 0; i < pred.length; i++) {
    h = (Math.imul(31, h) + pred.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function predColor(pred: string): string {
  return PALETTE[hashPred(pred) % PALETTE.length];
}

// Line width grows with arity (more specific predicates drawn thicker).
function predWidth(pred: string, arity: number): number {
  return Math.min(2 + arity, 6);
}

function buildGeoData(facts: StoredFact[]) {
  // geopos(node, lat, lng) → [lng, lat] for MapLibre
  const geopos = new Map<string, [number, number]>();
  for (const f of facts) {
    if (f.pred === 'geopos') {
      console.log(
        '[MapTool] geopos fact:',
        f,
        'args.length:',
        f.args.length,
        'args types:',
        f.args.map((a) => typeof a),
      );
    }
    if (f.pred === 'geopos' && f.args.length === 3) {
      const [node, lat, lng] = f.args;
      geopos.set(String(node), [Number(lng), Number(lat)]);
    }
  }

  // Collect all non-geopos facts that mention a geopositioned node as their first arg
  const nodeFacts = new Map<string, string[]>();
  for (const id of geopos.keys()) nodeFacts.set(id, []);
  for (const f of facts) {
    if (f.pred === 'geopos') continue;
    const first = String(f.args[0]);
    if (!nodeFacts.has(first)) continue;
    // Only include facts where the fact is purely about this node (no second geopos arg → edge facts will be shown as lines)
    const secondIsNode = f.args.length >= 2 && geopos.has(String(f.args[1]));
    if (secondIsNode) continue;
    const argStr = f.args.slice(1).join(', ');
    nodeFacts.get(first)!.push(argStr.length > 0 ? `${f.pred}(${argStr})` : f.pred);
  }

  const nodeFeatures: GeoJSON.Feature[] = [];
  for (const [id, coords] of geopos) {
    const details = nodeFacts.get(id)?.join('\n') ?? '';
    nodeFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { id, details, label: details.length > 0 ? `${id}\n${details}` : id },
    });
  }

  // Any fact whose first two args are both geopositioned nodes becomes a line
  const edgeFeatures: GeoJSON.Feature[] = [];
  for (const f of facts) {
    if (f.pred === 'geopos') continue;
    if (f.args.length < 2) continue;
    const fromCoords = geopos.get(String(f.args[0]));
    const toCoords = geopos.get(String(f.args[1]));
    if (!fromCoords || !toCoords) continue;

    const extraArgs = f.args.slice(2);
    const label = extraArgs.length > 0 ? `${f.pred}(${extraArgs.join(', ')})` : f.pred;

    edgeFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [fromCoords, toCoords] },
      properties: {
        pred: f.pred,
        label,
        color: predColor(f.pred),
        width: predWidth(f.pred, f.args.length),
      },
    });
  }

  return {
    nodes: { type: 'FeatureCollection' as const, features: nodeFeatures },
    edges: { type: 'FeatureCollection' as const, features: edgeFeatures },
    geopos,
  };
}

function MapViewer({ docUrl }: { docUrl: AutomergeUrl }) {
  const [doc] = useDocument<DatalogDoc>(docUrl);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const fittedRef = useRef(false);

  const derivedFacts = useMemo<StoredFact[]>(() => {
    if (!doc) {
      console.log('[MapTool] doc not yet loaded');
      return [];
    }
    console.log('[MapTool] factsText:', doc.factsText);
    const fp = parseProgram(doc.factsText ?? '');
    console.log('[MapTool] parsed base facts:', fp.facts);
    console.log('[MapTool] parse errors:', fp.errors);
    const rp = parseProgram(doc.rulesText ?? '');
    try {
      const derived = evaluate(fp.facts, rp.rules);
      console.log('[MapTool] derived facts:', derived);
      return derived;
    } catch (err) {
      console.error('[MapTool] evaluate error:', err);
      return fp.facts;
    }
  }, [doc]);

  const geoData = useMemo(() => {
    const data = buildGeoData(derivedFacts);
    console.log('[MapTool] geopos map:', [...data.geopos.entries()]);
    console.log('[MapTool] node features:', data.nodes.features);
    console.log('[MapTool] edge features:', data.edges.features);
    return data;
  }, [derivedFacts]);

  const geoDataRef = useRef(geoData);
  geoDataRef.current = geoData;

  // Initialise the map once
  useEffect(() => {
    if (!mapContainerRef.current) return;

    console.log('[MapTool] maplibregl module:', maplibregl);
    console.log('[MapTool] maplibregl.Map:', maplibregl.Map);

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [13.4, 52.5],
        zoom: 5,
      });
    } catch (err) {
      console.error('[MapTool] Failed to construct maplibregl.Map:', err);
      return;
    }

    mapRef.current = map;
    console.log('[MapTool] Map instance created, waiting for load event...');

    map.on('load', () => {
      console.log('[MapTool] Map loaded, adding sources and layers...');
      try {
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
            'line-opacity': 0.85,
          },
        });
        map.addLayer({
          id: 'edges-label',
          type: 'symbol',
          source: 'edges',
          layout: {
            'symbol-placement': 'line-center',
            'text-field': ['get', 'label'],
            'text-size': 11,
            'text-font': ['Noto Sans Regular'],
            'text-offset': [0, -0.8],
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': '#fff',
            'text-halo-width': 1.5,
          },
        });

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
              { 'font-scale': 1.1, 'text-font': ['literal', ['Noto Sans Bold']] },
              '\n',
              {},
              ['get', 'details'],
              { 'font-scale': 0.8, 'text-font': ['literal', ['Noto Sans Regular']] },
            ],
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
          },
          paint: {
            'text-color': '#1e293b',
            'text-halo-color': '#fff',
            'text-halo-width': 1.5,
          },
        });

        // Push whatever data is available now
        const d = geoDataRef.current;
        (map.getSource('nodes') as maplibregl.GeoJSONSource)?.setData(d.nodes);
        (map.getSource('edges') as maplibregl.GeoJSONSource)?.setData(d.edges);
        if (d.geopos.size > 0) {
          fittedRef.current = true;
          const bounds = new maplibregl.LngLatBounds();
          for (const coords of d.geopos.values()) bounds.extend(coords);
          map.fitBounds(bounds, { padding: 80, maxZoom: 10, duration: 500 });
        }
        console.log('[MapTool] Sources and layers added successfully.');
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

  // Update sources when facts change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    (map.getSource('nodes') as maplibregl.GeoJSONSource | undefined)?.setData(geoData.nodes);
    (map.getSource('edges') as maplibregl.GeoJSONSource | undefined)?.setData(geoData.edges);
    if (!fittedRef.current && geoData.geopos.size > 0) {
      fittedRef.current = true;
      const bounds = new maplibregl.LngLatBounds();
      for (const coords of geoData.geopos.values()) bounds.extend(coords);
      map.fitBounds(bounds, { padding: 80, maxZoom: 10, duration: 500 });
    }
  }, [geoData]);

  return <div style={{ width: '100%', height: '100%' }} ref={mapContainerRef} />;
}
