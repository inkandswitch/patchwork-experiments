// Built-in `chat:slash` plugins. Each command is a descriptor with autocomplete
// metadata plus behaviour: either a `transform` (rewrites the outgoing message)
// or a `sideEffect` id the host tool maps to a callback (opens a dialog, drives
// the Computer, pins a doc…) and sends no message.
//
// All built-ins are tier:"full" — the minimal `chat` tool (slashCommands:"core")
// gets none; `chitterchatter` (slashCommands:"all") gets them all. A host module
// can contribute more by registering a chat:slash plugin.

export interface SlashTransform {
	text: string
	action?: boolean
	overrideFont?: string
	overrideColor?: string
	marquee?: boolean
}

export interface SlashPlugin {
	type: "chat:slash"
	id: string
	cmd: string
	aliases?: string[]
	usage: string
	desc: string
	tier: "core" | "full"
	transform?: (argText: string) => SlashTransform | null
	// One of: "font-dialog" | "emoticon-dialog" | "computer" | "call" | "model" | "pin"
	sideEffect?: string
}

const SHRUG = "¯\\_(ツ)_/¯"
const TABLEFLIP = "(╯°□°)╯︵ ┻━┻"

export const slashPlugins: SlashPlugin[] = [
	{
		// tier:"core" so a bare `chat` (empty plugin list) can still bootstrap itself.
		type: "chat:slash", id: "plugin", cmd: "/plugin", aliases: ["/plugins"], tier: "core",
		usage: "/plugin [ls | load <id> | unload <id>]",
		desc: "List, load, or unload chat plugins for this document",
		sideEffect: "plugin",
	},
	{
		type: "chat:slash", id: "me", cmd: "/me", tier: "full",
		usage: "/me <message>", desc: 'Send an action message (e.g. "/me waves hello")',
		transform: (arg) => ({text: arg, action: true}),
	},
	{
		type: "chat:slash", id: "slap", cmd: "/slap", tier: "full",
		usage: "/slap <name>", desc: "Slap someone with a large trout",
		transform: (arg) => ({text: "slaps " + arg.trim() + " around a bit with a large trout", action: true}),
	},
	{
		type: "chat:slash", id: "font", cmd: "/font", tier: "full",
		usage: "/font <name> <message>", desc: 'Send a message in a specific font (e.g. "/font Georgia hello")',
		transform: (arg) => {
			const i = arg.indexOf(" ")
			return i > 0 ? {text: arg.slice(i + 1), overrideFont: arg.slice(0, i)} : null
		},
	},
	{
		type: "chat:slash", id: "colour", cmd: "/colour", aliases: ["/color"], tier: "full",
		usage: "/colour <colour> <message>", desc: "Send a message in a specific colour",
		transform: (arg) => {
			const i = arg.indexOf(" ")
			return i > 0 ? {text: arg.slice(i + 1), overrideColor: arg.slice(0, i)} : null
		},
	},
	{
		type: "chat:slash", id: "face", cmd: "/face", tier: "full",
		usage: "/face <color> <font> <message>", desc: "Send with custom colour and font",
		transform: (arg) => {
			const p = arg.split(" ")
			return p.length >= 3 ? {text: p.slice(2).join(" "), overrideColor: p[0], overrideFont: p[1]} : null
		},
	},
	{
		type: "chat:slash", id: "marquee", cmd: "/marquee", tier: "full",
		usage: "/marquee <message>", desc: "Send a scrolling marquee message",
		transform: (arg) => ({text: arg, marquee: true}),
	},
	{
		type: "chat:slash", id: "shrug", cmd: "/shrug", tier: "full",
		usage: "/shrug [message]", desc: "Append a shrug to your message",
		transform: (arg) => ({text: (arg.trim() ? arg.trim() + " " : "") + SHRUG}),
	},
	{
		type: "chat:slash", id: "tableflip", cmd: "/tableflip", tier: "full",
		usage: "/tableflip [message]", desc: "Flip a table in frustration",
		transform: (arg) => ({text: (arg.trim() ? arg.trim() + " " : "") + TABLEFLIP}),
	},
	// Side-effecting commands (send no message).
	{
		type: "chat:slash", id: "addfont", cmd: "/addfont", tier: "full",
		usage: "/addfont", desc: "Upload a .woff2 font file to use in chat",
		sideEffect: "font-dialog",
	},
	{
		type: "chat:slash", id: "emoticon", cmd: "/emoticon", tier: "full",
		usage: "/emoticon", desc: "Add a custom emoticon",
		sideEffect: "emoticon-dialog",
	},
	{
		type: "chat:slash", id: "computer", cmd: "/computer", tier: "full",
		usage: "/computer [invite|kick|nosey|clear|owner|own|pwn]",
		desc: "Manage the AI assistant: invite, kick, toggle nosey, clear context, see or take over the owner",
		sideEffect: "computer",
	},
	{
		type: "chat:slash", id: "call", cmd: "/call", tier: "full",
		usage: "/call", desc: "Start a voice/video call in this chat",
		sideEffect: "call",
	},
	{
		type: "chat:slash", id: "model", cmd: "/model",
		aliases: ["/or", "/openrouter", "/ollama", "/provider", "/models"], tier: "full",
		usage: "/model", desc: "Configure the AI model and provider",
		sideEffect: "model",
	},
	{
		type: "chat:slash", id: "pin", cmd: "/pin", tier: "full",
		usage: "/pin <url|transcript>",
		desc: 'Pin a document to the sidebar (automerge URL, tiny patchwork URL, or "transcript")',
		sideEffect: "pin",
	},
]

/** Match input text against the active slash plugins. Returns the matched plugin
 * plus the argument text (everything after the command word), or null. */
export function matchSlashCommand(
	text: string,
	plugins: SlashPlugin[]
): {plugin: SlashPlugin; argText: string} | null {
	if (!text.startsWith("/")) return null
	const lc = text.toLowerCase()
	for (const plugin of plugins) {
		const names = [plugin.cmd, ...(plugin.aliases || [])]
		for (const name of names) {
			const n = name.toLowerCase()
			if (lc === n || lc.startsWith(n + " ")) {
				let argText = text.slice(name.length)
				if (argText.startsWith(" ")) argText = argText.slice(1)
				return {plugin, argText}
			}
		}
	}
	return null
}
