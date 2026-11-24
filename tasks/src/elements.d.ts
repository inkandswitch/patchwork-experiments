// lifted from https://github.com/inkandswitch/patchwork-next/blob/main/core/elements/src/elements.d.ts

import 'solid-js';

declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'patchwork-view': {
        'doc-url': string;
        'tool-id': string;
      };
    }
  }
}
