// Type declarations for patchwork custom elements
// lifted from https://github.com/inkandswitch/patchwork-next/blob/main/core/elements/src/elements.d.ts


import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'patchwork-view': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        'doc-url': string;
        'tool-id'?: string | null;
        class?: string;
      };
    }
  }
}

declare namespace JSX {
  interface IntrinsicElements {
    'patchwork-view': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      'doc-url': string;
      'tool-id'?: string | null;
      class?: string;
    };
  }
}
