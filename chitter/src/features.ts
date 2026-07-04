// The chitter feature descriptions. Each is a serializable `chat:feature` entry
// whose Solid slot renderers live behind `async load()` — and both the slot JSX
// (in `./feature-slots`) and the components themselves are pulled in by DYNAMIC
// imports, so no `solid-js` / `solid-js/web` code enters the entry bundle's
// (worker) static graph. The base `chat` tool discovers these via the registry
// and mounts each slot's renderer with the explicit SlotContext.

export const featureDescriptions = [
	{
		// Metadata only — the call button lives in the base presence bar (gated by
		// hasFeature) and drives the base's handleCallCommand; there's no slot UI.
		type: "chat:feature",
		id: "call",
		name: "Voice/video call",
		tier: "full",
	},
	{
		type: "chat:feature",
		id: "notifications",
		name: "Notifications",
		tier: "full",
		async load() {
			return (await import("./feature-slots")).notifications()
		},
	},
	{
		type: "chat:feature",
		id: "reactions",
		name: "Reactions",
		tier: "full",
		async load() {
			return (await import("./feature-slots")).reactions()
		},
	},
	{
		type: "chat:feature",
		id: "emoticons",
		name: "Custom emoticons",
		tier: "full",
		async load() {
			return (await import("./feature-slots")).emoticons()
		},
	},
	{
		type: "chat:feature",
		id: "sidebar",
		name: "Sidebar",
		tier: "full",
		async load() {
			return (await import("./feature-slots")).sidebar()
		},
	},
	{
		type: "chat:feature",
		id: "voice",
		name: "Voice notes",
		tier: "full",
		async load() {
			return (await import("./feature-slots")).voice()
		},
	},
	{
		type: "chat:feature",
		id: "gifSelfie",
		name: "GIF selfie",
		tier: "full",
		async load() {
			return (await import("./feature-slots")).gifSelfie()
		},
	},
]
