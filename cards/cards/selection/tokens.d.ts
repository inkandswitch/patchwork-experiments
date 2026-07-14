// Hand-written types for ./tokens.js (see channels.d.ts for why these are
// structural and import nothing).

import type { JSX } from "solid-js";

export type HighlightController = {
  highlightedDocIds: () => Set<string>;
  hover: (urls: string[]) => void;
  clear: () => void;
};

export declare function EmbedToken(props: {
  url: string;
  highlight: HighlightController;
  label?: string;
}): JSX.Element;

type HighlightStore = {
  read(channel: unknown): Record<string, unknown>;
  subscribe(
    channel: unknown,
    cb: (value: never) => void,
    interest: { owner: unknown },
  ): () => void;
  handle(
    channel: unknown,
    owner: unknown,
  ): {
    change(mutate: (slice: Record<string, true>) => void): void;
    release(): void;
  };
};

export declare function useHighlight(
  store: HighlightStore,
  owner: unknown,
): HighlightController;

export type DocTitles = {
  titleOf: (url: string) => string;
  request: (url: string) => void;
};

export declare function useDocTitles(repo: {
  find(url: string): Promise<{ doc(): unknown }>;
}): DocTitles;

export declare function shortId(docUrl: string): string;
