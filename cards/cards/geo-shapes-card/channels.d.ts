// Hand-written types for ./channels.js (structural, no imports — see the
// selection card's channels.d.ts for why).

type Channel<T extends Record<string, unknown>> = {
  name: string;
  empty: T;
  set?: true;
  key?: string;
  value?: string;
  definedBy?: string;
  spec?: string;
};

export type GeoPoint = { lat: number; lon: number };

export type GeoMarker = {
  type: "marker";
  at: GeoPoint;
  target: string;
  color?: string;
};

export type GeoLine = {
  type: "line";
  points: GeoPoint[];
  target: string;
  color?: string;
};

export type GeoShape = GeoMarker | GeoLine;

export declare const GeoShapes: Channel<Record<string, GeoShape[]>>;
