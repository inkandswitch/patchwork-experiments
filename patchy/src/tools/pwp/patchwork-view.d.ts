// `<patchwork-view>` in JSX. pwp embeds patternwitch in one.
declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "patchwork-view": {
        ref?: HTMLElement | ((el: HTMLElement) => void);
        class?: string;
        style?: string | Record<string, string>;
        "doc-url"?: string;
        "tool-id"?: string;
      };
    }
  }
}

export {};
