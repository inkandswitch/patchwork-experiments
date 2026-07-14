// Hand-written types for ./channels.js, for the bundled TS consumers (canvas,
// context-viewer) that import this package through a `link:` dependency. The
// Channel shape is declared structurally so this file needs no resolvable
// import of @embark/core — it stays assignable to that package's `Channel`.

type Channel<T extends Record<string, unknown>> = {
  name: string;
  empty: T;
  set?: true;
  key?: string;
  value?: string;
  definedBy?: string;
  spec?: string;
};

export type DocUrlSet = Record<string, true>;

export declare const Selection: Channel<DocUrlSet>;
export declare const Highlight: Channel<DocUrlSet>;
