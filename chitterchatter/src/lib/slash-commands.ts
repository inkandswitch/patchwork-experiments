export interface SlashCommand {
	cmd: string
	usage: string
	desc: string
	aliases?: string[]
}

export const SLASH_COMMANDS: SlashCommand[] = [
	{
		cmd: "/me",
		usage: "/me <message>",
		desc: 'Send an action message (e.g. "/me waves hello")',
	},
	{
		cmd: "/slap",
		usage: "/slap <name>",
		desc: "Slap someone with a large trout",
	},
	{
		cmd: "/font",
		usage: "/font <name> <message>",
		desc: 'Send a message in a specific font (e.g. "/font Georgia hello")',
	},
	{
		cmd: "/colour",
		usage: "/colour <colour> <message>",
		desc: "Send a message in a specific colour",
	},
	{
		cmd: "/face",
		usage: "/face <color> <font> <message>",
		desc: "Send with custom colour and font",
	},
	{
		cmd: "/addfont",
		usage: "/addfont",
		desc: "Upload a .woff2 font file to use in chat",
	},
	{
		cmd: "/computer",
		usage: "/computer [invite|kick|nosey|clear]",
		desc: "Manage the AI assistant: invite, kick, toggle nosey mode, or clear context",
	},
	{
		cmd: "/call",
		usage: "/call",
		desc: "Start a voice/video call in this chat",
	},
	{
		cmd: "/model",
		usage: "/model",
		desc: "Configure the AI model and provider",
		aliases: ["/or", "/openrouter", "/ollama", "/provider", "/models"],
	},
	{
		cmd: "/pin",
		usage: "/pin <url|transcript>",
		desc: 'Pin a document to the sidebar (automerge URL, tiny patchwork URL, or "transcript")',
	},
	{
		cmd: "/marquee",
		usage: "/marquee <message>",
		desc: "Send a scrolling marquee message",
	},
	{
		cmd: "/shrug",
		usage: "/shrug [message]",
		desc: "Append a shrug to your message",
	},
	{
		cmd: "/tableflip",
		usage: "/tableflip [message]",
		desc: "Flip a table in frustration",
	},
]

export interface ParsedSlashCommand {
	text: string
	action?: boolean
	overrideFont?: string
	overrideColor?: string
	marquee?: boolean
}

export function parseSlashCommand(text: string): ParsedSlashCommand | null {
	if (!text.startsWith("/")) return null

	if (text.startsWith("/me ")) {
		return {text: text.slice(4), action: true}
	}
	if (text.startsWith("/slap ")) {
		const target = text.slice(6).trim()
		return {
			text: "slaps " + target + " around a bit with a large trout",
			action: true,
		}
	}
	if (text.startsWith("/font ")) {
		const rest = text.slice(6)
		const spaceIdx = rest.indexOf(" ")
		if (spaceIdx > 0) {
			return {
				text: rest.slice(spaceIdx + 1),
				overrideFont: rest.slice(0, spaceIdx),
			}
		}
	}
	if (text.startsWith("/colour ") || text.startsWith("/color ")) {
		const rest = text.slice(text.indexOf(" ") + 1)
		const spaceIdx = rest.indexOf(" ")
		if (spaceIdx > 0) {
			return {
				text: rest.slice(spaceIdx + 1),
				overrideColor: rest.slice(0, spaceIdx),
			}
		}
	}
	if (text.startsWith("/marquee ")) {
		return {text: text.slice(9), marquee: true}
	}
	if (text === "/shrug" || text.startsWith("/shrug ")) {
		const rest = text.slice(6).trim()
		return {text: (rest ? rest + " " : "") + "\u00AF\\_(\u30C4)_/\u00AF"}
	}
	if (text === "/tableflip" || text.startsWith("/tableflip ")) {
		const rest = text.slice(10).trim()
		return {text: (rest ? rest + " " : "") + "(\u256F\u00B0\u25A1\u00B0)\u256F\uFE35 \u253B\u2501\u253B"}
	}
	if (text.startsWith("/face ")) {
		const parts = text.slice(6).split(" ")
		if (parts.length >= 3) {
			return {
				text: parts.slice(2).join(" "),
				overrideColor: parts[0],
				overrideFont: parts[1],
			}
		}
	}
	return null
}
