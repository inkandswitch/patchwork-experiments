import type {PluginSelector} from "./lib/registry"
import {resolvePlugins} from "./lib/registry"

// Features are NOT a hardcoded struct on the component. Each big feature is a
// `chat:feature` plugin declaration (host-registrable, like the other four types);
// a tool enables features by passing ONE selector that applies across every plugin
// type. The component gates its UI on `hasFeature(id)` — it never holds a fixed
// list of known features.
//
// A tool's selector is `"all" | "core" | string[]`:
//   "all"     → every plugin of every type (built-in + host-contributed)
//   "core"    → only tier:"core" plugins (the minimal `chat` tool)
//   string[]  → an explicit set of plugin ids, spanning feature/parser/slash/…
//               types (a plugin id is matched regardless of its type)
export type FeatureSelector = PluginSelector

export interface FeaturePlugin {
	type: "chat:feature"
	id: string
	name: string
	tier: "core" | "full"
}

// The built-in feature declarations (also the registry fallback). Message send,
// contact avatars + names, inline `code`/`*bold*`/`_italic_`/fences, image send and
// patchwork-tool embedding are ALWAYS on (not gated) — they're the chat itself.
// Replies ride the (core-tier) `reply` message-action, so no flag here.
export const featurePlugins: FeaturePlugin[] = [
	{type: "chat:feature", id: "presence", name: "Presence", tier: "core"},
	{type: "chat:feature", id: "typing", name: "Typing indicator", tier: "core"},
	{type: "chat:feature", id: "reactions", name: "Reactions", tier: "full"},
	{type: "chat:feature", id: "sidebar", name: "Sidebar", tier: "full"},
	{type: "chat:feature", id: "voice", name: "Voice notes", tier: "full"},
	{type: "chat:feature", id: "gifSelfie", name: "GIF selfie", tier: "full"},
	{type: "chat:feature", id: "emoticons", name: "Custom emoticons", tier: "full"},
	{type: "chat:feature", id: "computer", name: "Computer (AI)", tier: "full"},
	{type: "chat:feature", id: "call", name: "Voice/video call", tier: "full"},
	{type: "chat:feature", id: "notifications", name: "Notifications", tier: "full"},
]

// Resolve a tool's selector into the set of active feature ids (registry merged
// with the built-in declarations, then filtered by the selector).
export function resolveFeatureSet(selector: FeatureSelector): Set<string> {
	return new Set(
		resolvePlugins("chat:feature", featurePlugins, selector).map((p) => p.id)
	)
}
