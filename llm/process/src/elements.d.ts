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
