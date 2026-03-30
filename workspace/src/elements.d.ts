export {};

declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'patchwork-view': { 'doc-url'?: string; 'tool-id'?: string; style?: string; class?: string };
    }
  }
}
