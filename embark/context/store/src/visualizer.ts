import type { Repo } from "@automerge/automerge-repo";
import {
  getRegistry,
  type PluginDescription,
} from "@inkandswitch/patchwork-plugins";
import type { ContextStore } from "./context";

// A context visualizer paints one channel's value for the context viewer. It is
// mounted imperatively (like a patchwork tool render): given a host element and
// the store, it draws itself and returns a teardown. It reads the value from the
// store directly (subscribing as needed), so the contract carries no value — the
// package that owns the channel already knows its Channel object and payload
// shape and derives what to show from `channel` + `mode`.
export type ContextVisualizerProps = {
  store: ContextStore;
  // The channel name being visualized. A plugin may claim several channels
  // (e.g. selection + highlight), so it switches on this to pick its own
  // Channel object.
  channel: string;
  // "contributes" shows only the focused embed's authored slice; "uses" shows
  // the merged value the embed reads. Filtering views (search results,
  // stickers) also key their target/owner filter off this.
  mode: "contributes" | "uses";
  // The focused embed's document url (always set by the context viewer).
  focusDocUrl: string;
  // The repo, for visualizers that resolve document titles/handles (e.g. the
  // owning card of a search result).
  repo: Repo;
};

export type ContextVisualizer = (
  element: HTMLElement,
  props: ContextVisualizerProps,
) => () => void;

// A plugin that registers a visualizer for one or more named channels. Loaded
// lazily (its `load()` resolves to a ContextVisualizer) and correlated to
// channels purely by name, so any package that defines a channel can ship its
// visualization without the viewer knowing about it.
export type ContextVisualizerPlugin = PluginDescription & {
  type: "embark:context-visualizer";
  channels: string[];
};

export const CONTEXT_VISUALIZER = "embark:context-visualizer";

// The shared registry for context visualizers. Resolved through the externalized
// patchwork-plugins singleton, so the viewer shell and every channel package see
// the same registry regardless of how many copies of @embark/context are bundled.
export function contextVisualizers() {
  return getRegistry<ContextVisualizerPlugin>(CONTEXT_VISUALIZER);
}
