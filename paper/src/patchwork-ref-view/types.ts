import type { Ref, Repo } from '@automerge/automerge-repo';
import type {
  LoadablePlugin,
  LoadedPlugin,
  PluginDescription,
} from '@inkandswitch/patchwork-plugins';
import type { ZodTypeAny } from 'zod';

export type RefToolDescription = PluginDescription & {
  type: 'patchwork:ref-tool';
  schema: ZodTypeAny;
};

export type RefToolImplementation<T = unknown> = (ref: Ref<T>, element: HTMLElement) => () => void;

export type RefTool<T = unknown> = LoadablePlugin<RefToolDescription, RefToolImplementation<T>>;
export type LoadedRefTool<T = unknown> = LoadedPlugin<RefToolDescription, RefToolImplementation<T>>;

export type RegisterPatchworkRefViewElementParams = {
  repo: Repo;
  name?: string;
};

declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'patchwork-ref-view': {
        ref?: HTMLElement | ((el: HTMLElement) => void);
        'ref-url'?: string;
        class?: string;
        style?: string;
      };
      'patchwork-view': { 'doc-url'?: string; 'tool-id'?: string; style?: string; class?: string };
      'patchwork-view-with-tool-url': { 'doc-url'?: string; 'tool-url'?: string; style?: string; class?: string };
    }
  }
}
