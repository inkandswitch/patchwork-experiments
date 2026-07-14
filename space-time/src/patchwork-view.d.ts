import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      /** Patchwork's custom element that renders a document with a given tool. */
      'patchwork-view': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        'doc-url'?: string;
        'tool-id'?: string;
      };
    }
  }
}

export {};
