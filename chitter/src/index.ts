// The `chitter` extension bundle. Registers the "everything" chat datatype plus
// (as they are moved over) the full chitter plugin set — feature slots, slash
// commands, message actions, parser extensions, emoji packs — into the shared
// registry, where the base `chat` tool picks them up via mergePlugins/registry.load.
//
// The base `chat` tool renders these datatypes (its supportedDatatypes lists
// "chitter"); this bundle contributes no tool/component of its own.
import {slashPluginDescriptions} from "./slash-plugins"
import {syntaxPlugins} from "./syntax"
import {messageActionDescriptions} from "./message-actions"
import {featureDescriptions} from "./features"

export const plugins = [
	{
		type: "patchwork:datatype",
		id: "chitter",
		name: "Chitter",
		icon: "MessageCircle",
		async load() {
			return (await import("./datatype")).ChitterDatatype
		},
	},
	{
		// Legacy alias: docs created as `chitterchatter` before the split. Same
		// everything preset, so their title resolves and new ones seed identically.
		type: "patchwork:datatype",
		id: "chitterchatter",
		name: "Chitter",
		icon: "MessageCircle",
		async load() {
			return (await import("./datatype")).ChitterDatatype
		},
	},
	// Seam plugins: slash commands, inline-formatting rules, and hover actions.
	// (Feature-slot descriptions — reactions/sidebar/voice/gif/emoticons/
	// notifications, each with its Solid components behind `async load()`. The
	// call feature lives in the separate `call` bundle, not here.)
	...slashPluginDescriptions,
	...syntaxPlugins,
	...messageActionDescriptions,
	...featureDescriptions,
]
