import miniCanvasSheet from './index.css' with { type: 'css' };
import { createRef } from './ref.js';
import { registerRefView } from './ref-view.js';

const DEFAULT_SOURCE_FOLDER = 'automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m';

/** Module URL for `frame.js` (see README). */
const FRAME_TOOL_URL = '/automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m/frame.js';

export { createRef, findRef, encodeRefToURL, parseRefURL } from './ref.js';
export { registerRefView } from './ref-view.js';

registerRefView(globalThis.repo);

function ensureMiniCanvasStyles() {
  if (document.adoptedStyleSheets.includes(miniCanvasSheet)) return;
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, miniCanvasSheet];
}

export function MiniCanvasTool(handle, element) {
  ensureMiniCanvasStyles();
  const rootRef = createRef(handle);
  const rv = document.createElement('ref-view');
  rv.setAttribute('tool-url', encodeURIComponent(FRAME_TOOL_URL));
  rv.setAttribute('ref-url', encodeURIComponent(rootRef.toURL()));
  rv.style.cssText = 'display:block;width:100%;height:100%;min-height:0;';
  element.appendChild(rv);
  return () => rv.remove();
}

export const MiniCanvasDatatype = {
  init(doc) {
    doc.title = 'Mini Canvas';
    doc.sourceFolder = DEFAULT_SOURCE_FOLDER;
  },
  getTitle(doc) {
    return doc.title || 'Mini Canvas';
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};

export const plugins = [
  {
    type: 'patchwork:tool',
    id: 'mini-canvas',
    name: 'Mini Canvas',
    supportedDatatypes: ['mini-canvas'],
    async load() {
      return MiniCanvasTool;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'mini-canvas',
    name: 'Mini Canvas',
    icon: 'LayoutTemplate',
    async load() {
      return MiniCanvasDatatype;
    },
  },
];

