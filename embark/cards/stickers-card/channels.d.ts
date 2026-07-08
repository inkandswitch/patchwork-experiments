// Hand-written types for ./channels.js, for bundled TS consumers (the todo
// editor) importing this package through a `link:` dependency. Structural so
// it needs no resolvable import of @embark/core.

type Channel<T extends Record<string, unknown>> = {
  name: string;
  empty: T;
  set?: true;
  key?: string;
  value?: string;
  definedBy?: string;
  spec?: string;
};

export type StyleSticker = {
  type: "style";
  styles: Record<string, string>;
  target: string;
};

export type TextSticker = {
  type: "text";
  text: string;
  target: string;
  slot: string;
  styles?: Record<string, string>;
};

export type ToolSticker = {
  type: "tool";
  toolId: string;
  docUrl: string;
  target: string;
  slot: string;
};

export type Sticker = StyleSticker | TextSticker | ToolSticker;

export declare const Stickers: Channel<Record<string, Sticker[]>>;
