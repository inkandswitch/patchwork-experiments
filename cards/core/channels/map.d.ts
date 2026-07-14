// Hand-written types for ./channels.js (structural, no imports).

type Channel<T extends Record<string, unknown>> = {
  name: string;
  empty: T;
  set?: true;
  key?: string;
  value?: string;
  definedBy?: string;
  spec?: string;
};

export declare const MapExtensions: Channel<Record<string, unknown>>;
