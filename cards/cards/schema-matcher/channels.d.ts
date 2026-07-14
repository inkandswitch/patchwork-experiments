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

export type JsonSchema = boolean | { [key: string]: unknown };

export declare const SchemaMatches: Channel<Record<string, string[]>>;
export declare const OpenDocuments: Channel<Record<string, true>>;

export declare function schemaKey(schema: JsonSchema): string;
