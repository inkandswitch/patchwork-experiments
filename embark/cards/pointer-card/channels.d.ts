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

export type PointerState = {
  x?: number;
  y?: number;
  docUrl?: string;
  pressed?: boolean;
};

export declare const Pointer: Channel<PointerState>;
