// Allow <patchwork-view> in Solid JSX.
import "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "patchwork-view": JSX.HTMLAttributes<HTMLElement> & {
        component?: string;
        "doc-url"?: string;
        "tool-id"?: string;
      };
    }
  }
}
