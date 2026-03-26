import type { JSX } from 'solid-js';

declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'patchwork-view': {
        'doc-url'?: string;
        'tool-id'?: string;
        style?: string | JSX.CSSProperties;
        class?: string;
      };
    }
  }
}
