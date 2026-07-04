import {featurePlugins} from "./features"
import {parserExtensionPlugins} from "./lib/parser-extensions"
import {slashPluginDescriptions} from "./lib/slash-plugins"
import {messageActionDescriptions} from "./lib/message-actions"
import {emojiPackDescriptions} from "./lib/emoji-packs"

export const plugins = [
	{
		// The "Chitter" preset: seeds the full built-in plugin set into the doc.
		type: "patchwork:datatype",
		id: "chitterchatter",
		name: "Chitter",
		icon: "MessageCircle",
		async load() {
			return (await import("./datatype")).ChitterDatatype
		},
	},
	{
		// The "Chat" preset: seeds an empty plugin list (core-only). Grows via
		// `/plugin load`. `chat` is also the legacy datatype id — legacy docs have
		// no `plugins` field and default to all features (see datatype/docSelector).
		type: "patchwork:datatype",
		id: "chat",
		name: "Chat",
		icon: "MessageSquare",
		async load() {
			return (await import("./datatype")).ChatDatatype
		},
	},
	{
		// The single chat tool. Which features are active is driven by the
		// document's `plugins` array, not by the tool. Registered under `chat`;
		// a `chitterchatter` alias below keeps existing pins/toolIds resolving.
		type: "patchwork:tool",
		id: "chat",
		name: "Chat",
		icon: "MessageSquare",
		supportedDatatypes: ["chitterchatter", "chat"],
		async load() {
			return (await import("./tool")).ChatTool
		},
	},
	{
		// Host-embeddable component (<patchwork-view component="chat">). Defaults to
		// the minimal feature set; features="full" for everything.
		type: "patchwork:component",
		id: "chat",
		name: "Chat",
		icon: "MessageSquare",
		async load() {
			return (await import("./tool")).ChatComponent
		},
	},
	{
		// Streamlined context-sidebar variant: no sidebar, chats about whatever
		// document is focused (chat stored at focusedDoc['@patchwork'].chitchat),
		// and the computer edits that document via universal Automerge ops.
		type: "patchwork:component",
		id: "chitterchatter-context",
		name: "Chitchat",
		icon: "MessageCircle",
		tags: ["context-tool"],
		async load() {
			const {ChatContextComponent} = await import("./context-tool")
			return ChatContextComponent
		},
	},
	// ── Host-registrable feature plugins ────────────────────────────────────────
	// The four extensible seams, registered like newspace's sketchy:* plugins so
	// other modules can contribute inline syntax, slash commands, hover actions and
	// emoji packs. The tool also keeps these as built-in fallbacks (see lib/*),
	// so it works even if the registry is empty.
	//
	// These MUST be serializable: the host reads `plugins` in a worker and clones
	// each entry to the main thread (excluding `load`). `feature`/`parser-extension`
	// entries are pure data (RegExp is cloneable) and spread raw; `slash`,
	// `messageaction` and `emojipack` carry function fields, so they're registered
	// as descriptions with the fancy code behind `async load()`.
	...featurePlugins,
	...parserExtensionPlugins,
	...slashPluginDescriptions,
	...messageActionDescriptions,
	...emojiPackDescriptions,
]
