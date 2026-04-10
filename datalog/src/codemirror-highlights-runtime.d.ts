declare module '../../codemirror-highlights/dist/index.js' {
  import type { Cursor, Prop } from '@automerge/automerge';
  import type { DocHandle } from '@automerge/automerge-repo';
  import type { Extension } from '@codemirror/state';

  export function addHighlightStyle(
    handle: DocHandle<unknown>,
    path: Prop[],
    from: Cursor,
    to: Cursor,
    css?: string,
  ): () => void;

  export function customHighlights(): Extension;
}
