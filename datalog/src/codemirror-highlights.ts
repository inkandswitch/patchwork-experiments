import type { Cursor, Prop } from '@automerge/automerge';
import type { DocHandle } from '@automerge/automerge-repo';
import type { Extension } from '@codemirror/state';
import { addHighlightStyle as addHighlightStyleRuntime } from '../../codemirror-highlights/dist/index.js';

type CodeMirrorHighlightsModule = {
  addHighlightStyle: (
    handle: DocHandle<unknown>,
    path: Prop[],
    from: Cursor,
    to: Cursor,
    css?: string,
  ) => () => void;
  customHighlights: () => Extension;
};

export const addHighlightStyle: CodeMirrorHighlightsModule['addHighlightStyle'] = addHighlightStyleRuntime;

export async function loadCustomHighlights(): Promise<Extension> {
  const module = (await import('../../codemirror-highlights/dist/index.js')) as CodeMirrorHighlightsModule;
  return module.customHighlights();
}
