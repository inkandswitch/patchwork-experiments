import type { JSX } from "solid-js";

// Solid JSX typing for the <patchwork-context> custom element (see
// @embark/context), so components can render the isolation boundary directly
// instead of building it imperatively.
declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "patchwork-context": JSX.HTMLAttributes<HTMLElement>;
    }
  }
}
