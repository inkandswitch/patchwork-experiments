import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import {
  getRegistry,
  type PluginDescription,
} from "@inkandswitch/patchwork-plugins";

// Context views paint a single key or value of a channel entry for the context
// viewer. They are registered per *type tag* (the `key`/`value` tags a
// channel declares, see ./context), not per channel: one "doc-url" view serves
// every channel that keys or carries document urls. The generic viewer walks a
// channel's merged entries and mounts the matching view for each key and value
// element — there is no per-channel visualization code.
//
// The mount contract is framework-agnostic DOM (the same shape as a patchwork
// tool render): the viewer and a channel package may ship different framework
// versions, so no component objects cross the bundle boundary. Given a host
// element and the key string / value element to draw, it mounts and returns a
// teardown. Values are re-mounted when they change, so a view can render its
// input statically.
export type ContextViewMount = (
  element: HTMLElement,
  value: unknown,
) => () => void;

// A plugin that registers one view for the type tags it supports. Loaded
// lazily (its `load()` resolves to a ContextViewMount) and correlated to
// channels purely by tag, so any package that defines a channel can ship the
// views for its types without the viewer knowing about them.
export type ContextViewPlugin = PluginDescription & {
  type: "embark:context-view";
  supports: string[];
};

export const CONTEXT_VIEW = "embark:context-view";

// The shared registry for context views. Resolved through the externalized
// patchwork-plugins singleton, so the viewer shell and every channel package
// see the same registry regardless of how many copies of @embark/context are
// bundled.
export function contextViews() {
  return getRegistry<ContextViewPlugin>(CONTEXT_VIEW);
}

// Adapt a plain Solid component (value in, rendered output back) to the mount
// contract. Compiled into the registering package's bundle, so it uses that
// package's own Solid — nothing framework-specific crosses to the viewer. The
// value is passed once per mount (the viewer re-mounts on change), so the
// component needs no reactive props.
export function solidView(
  component: (props: { value: unknown }) => JSX.Element,
): ContextViewMount {
  return (element, value) => render(() => component({ value }), element);
}
