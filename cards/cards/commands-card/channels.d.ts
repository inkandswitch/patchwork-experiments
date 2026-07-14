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

export type Suggestion = {
  label: string;
  url: string;
};

export declare const CommandQueries: Channel<Record<string, true>>;
export declare const CommandSuggestions: Channel<Record<string, Suggestion[]>>;
