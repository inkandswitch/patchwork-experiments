import { plugins as paperPlugins } from './paper/index.js';
import {
  plugins as refViewPlugins,
  registerPatchworkRefViewElement,
} from './patchwork-ref-view/index.js';
import { plugins as rectanglePlugins } from './shapes/rectangle/index.js';
import { plugins as linePlugins } from './shapes/line/index.js';
import { plugins as embedPlugins } from './shapes/embed/index.js';
import { plugins as panelPlugins } from './panels/panel/index.js';
import { plugins as toolPanelPlugins } from './panels/tool-panel/index.js';
import { plugins as dropHandlerPlugins } from './panels/drop-handler/index.js';
import { plugins as resizePlugins } from './panels/resize/index.js';
import { plugins as rectangleDrawPlugins } from './tools/rectangle-draw/index.js';
import { plugins as lineDrawPlugins } from './tools/line-draw/index.js';
import { plugins as selectPlugins } from './tools/select/index.js';
import { plugins as embedDrawPlugins } from './tools/embed-draw/index.js';

export const plugins = [
  ...paperPlugins,
  ...refViewPlugins,
  ...rectanglePlugins,
  ...linePlugins,
  ...embedPlugins,
  ...panelPlugins,
  ...toolPanelPlugins,
  ...dropHandlerPlugins,
  ...resizePlugins,
  ...rectangleDrawPlugins,
  ...lineDrawPlugins,
  ...selectPlugins,
  ...embedDrawPlugins,
];

// TODO: hack — patchwork-view and patchwork-ref-view should eventually be unified
// so the host registers both element types with the repo in one place.
registerPatchworkRefViewElement({ repo: (window as any).repo });

export { registerPatchworkRefViewElement } from './patchwork-ref-view/index.js';
export type {
  RefToolDescription,
  RefTool,
  LoadedRefTool,
  RefToolImplementation,
  RegisterPatchworkRefViewElementParams,
} from './patchwork-ref-view/index.js';

export { getPaperViewport } from './paper/get-paper-viewport.js';
export type { UserState } from './paper/types.js';

console.log('paper version', 5);
