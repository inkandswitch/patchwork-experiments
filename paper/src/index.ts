import { plugins as paperPlugins } from './paper/index.js';
import {
  plugins as refViewPlugins,
  registerPatchworkRefViewElement,
} from './patchwork-ref-view/index.js';
import { plugins as rectanglePlugins } from './shapes/rectangle/index.js';
import { plugins as linePlugins } from './shapes/line/index.js';
import { plugins as embedPlugins } from './shapes/embed/index.js';
import { plugins as panelPlugins } from './panels/panel/index.js';

export const plugins = [
  ...paperPlugins,
  ...refViewPlugins,
  ...rectanglePlugins,
  ...linePlugins,
  ...embedPlugins,
  ...panelPlugins,
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
