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

export declare const SearchQueries: Channel<Record<string, true>>;
export declare const SearchResults: Channel<Record<string, string[]>>;
