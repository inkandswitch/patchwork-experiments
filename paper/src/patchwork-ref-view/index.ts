import type { Plugin } from '@inkandswitch/patchwork-plugins';

export type {
  LoadedRefTool,
  RefTool,
  RefToolDescription,
  RefToolImplementation,
  RegisterPatchworkRefViewElementParams,
} from './types.js';

export { registerPatchworkRefViewElement } from './register-element.js';

export const plugins: Plugin<any>[] = [];
