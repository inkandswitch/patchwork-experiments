import { plugins as paperPlugins } from './paper/index.js';
import {
  plugins as refViewPlugins,
  registerPatchworkRefViewElement,
} from './patchwork-ref-view/index.js';

export const plugins = [...paperPlugins, ...refViewPlugins];

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
