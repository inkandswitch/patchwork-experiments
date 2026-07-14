// The chitter slash commands — everything except the base tool's own
// `computer` / `model` / `plugin`. Each carries a `name` title (the base's
// built-ins historically had none). Registered as serializable descriptions:
// metadata (incl. `sideEffect`) is cloneable and rides raw; the `transform`
// function lives behind `async load()`.

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
	name: string
	cmd: string
	aliases?: string[]
	usage: string
	desc: string
	tier: "core" | "full"
	transform?: (argText: string) => SlashTransform | null
	sideEffect?: string
}

const SHRUG = "¯\\_(ツ)_/¯"
const TABLEFLIP = "(╯°□°)╯︵ ┻━┻"

export const slashPlugins: SlashPlugin[] = [
	{
		type: "chat:slash", id: "me", name: "Me (action)", cmd: "/me", tier: "full",
		usage: "/me <message>", desc: 'Send an action message (e.g. "/me waves hello")',
		transform: (arg) => ({text: arg, action: true}),
	},
	{
		type: "chat:slash", id: "slap", name: "Slap", cmd: "/slap", tier: "full",
		usage: "/slap <name>", desc: "Slap someone with a large trout",
		transform: (arg) => ({text: "slaps " + arg.trim() + " around a bit with a large trout", action: true}),
	},
	{
		type: "chat:slash", id: "font", name: "Font", cmd: "/font", tier: "full",
		usage: "/font <name> <message>", desc: 'Send a message in a specific font (e.g. "/font Georgia hello")',
		transform: (arg) => {
			const i = arg.indexOf(" ")
			return i > 0 ? {text: arg.slice(i + 1), overrideFont: arg.slice(0, i)} : null
		},
	},
	{
		type: "chat:slash", id: "colour", name: "Colour", cmd: "/colour", aliases: ["/color"], tier: "full",
		usage: "/colour <colour> <message>", desc: "Send a message in a specific colour",
		transform: (arg) => {
			const i = arg.indexOf(" ")
			return i > 0 ? {text: arg.slice(i + 1), overrideColor: arg.slice(0, i)} : null
		},
	},
	{
		type: "chat:slash", id: "face", name: "Face", cmd: "/face", tier: "full",
		usage: "/face <color> <font> <message>", desc: "Send with custom colour and font",
		transform: (arg) => {
			const p = arg.split(" ")
			return p.length >= 3 ? {text: p.slice(2).join(" "), overrideColor: p[0], overrideFont: p[1]} : null
		},
	},
	{
		type: "chat:slash", id: "marquee", name: "Marquee", cmd: "/marquee", tier: "full",
		usage: "/marquee <message>", desc: "Send a scrolling marquee message",
		transform: (arg) => ({text: arg, marquee: true}),
	},
	{
		type: "chat:slash", id: "shrug", name: "Shrug", cmd: "/shrug", tier: "full",
		usage: "/shrug [message]", desc: "Append a shrug to your message",
		transform: (arg) => ({text: (arg.trim() ? arg.trim() + " " : "") + SHRUG}),
	},
	{
		type: "chat:slash", id: "tableflip", name: "Table flip", cmd: "/tableflip", tier: "full",
		usage: "/tableflip [message]", desc: "Flip a table in frustration",
		transform: (arg) => ({text: (arg.trim() ? arg.trim() + " " : "") + TABLEFLIP}),
	},
	{
		type: "chat:slash", id: "addfont", name: "Add font", cmd: "/addfont", tier: "full",
		usage: "/addfont", desc: "Upload a .woff2 font file to use in chat",
		sideEffect: "font-dialog",
	},
	{
		type: "chat:slash", id: "emoticon", name: "Add emoticon", cmd: "/emoticon", tier: "full",
		usage: "/emoticon", desc: "Add a custom emoticon",
		sideEffect: "emoticon-dialog",
	},
	{
		type: "chat:slash", id: "pin", name: "Pin", cmd: "/pin", tier: "full",
		usage: "/pin <url>",
		desc: "Pin a document to the sidebar (automerge URL or tiny patchwork URL)",
		sideEffect: "pin",
	},
]

// Serializable descriptions: metadata only + `async load()` carrying `transform`.
export const slashPluginDescriptions = slashPlugins.map((p) => {
	const {transform, ...meta} = p
	return {...meta, async load() { return {transform} }}
})
