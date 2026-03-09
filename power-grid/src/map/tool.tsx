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
    if (f.pred === 'geopos' && f.args.length === 3) {
      const [node, lat, lng] = f.args;
      geopos.set(String(node), [Number(lng), Number(lat)]);
    }
  }

  const nodeFeatures: GeoJSON.Feature[] = [];
  for (const [id, coords] of geopos) {
    nodeFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { id },
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
      properties: { pred: f.pred, label, color: predColor(f.pred), width: predWidth(f.pred, f.args.length) },
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
    if (!doc) return [];
    const fp = parseProgram(doc.factsText ?? '');
    const rp = parseProgram(doc.rulesText ?? '');
    try {
      return evaluate(fp.facts, rp.rules);
    } catch {
      return fp.facts;
    }
  }, [doc]);

  const geoData = useMemo(() => buildGeoData(derivedFacts), [derivedFacts]);

  // Initialise the map once
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [13.4, 52.5],
      zoom: 5,
    });

    map.on('load', () => {
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
          'text-field': ['get', 'id'],
          'text-size': 12,
          'text-font': ['Noto Sans Bold'],
          'text-offset': [0, 1.5],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#1e293b',
          'text-halo-color': '#fff',
          'text-halo-width': 1.5,
        },
      });

      mapRef.current = map;
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

  // Also push data on map load (handles timing gap between style load and first effect)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onLoad = () => {
      (map.getSource('nodes') as maplibregl.GeoJSONSource | undefined)?.setData(geoData.nodes);
      (map.getSource('edges') as maplibregl.GeoJSONSource | undefined)?.setData(geoData.edges);
      if (!fittedRef.current && geoData.geopos.size > 0) {
        fittedRef.current = true;
        const bounds = new maplibregl.LngLatBounds();
        for (const coords of geoData.geopos.values()) bounds.extend(coords);
        map.fitBounds(bounds, { padding: 80, maxZoom: 10, duration: 500 });
      }
    };
    map.on('load', onLoad);
    return () => { map.off('load', onLoad); };
  }, [geoData]);

  return <div style={{ width: '100%', height: '100%' }} ref={mapContainerRef} />;
}
