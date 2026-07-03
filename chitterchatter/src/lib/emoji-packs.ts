import {EMOJI_DATA} from "./emoji-data"

// Built-in `chat:emojipack` plugins — named sets of emoji for the reaction picker.
// The default "unicode" pack wraps the bundled emoji dataset (lazy-loaded via
// EMOJI_DATA). A host module can register more packs; a tool aggregates the active
// ones. Custom per-user emoticons are runtime (chat profile), not a pack.

export interface EmojiPackPlugin {
	type: "chat:emojipack"
	id: string
	name: string
	tier: "core" | "full"
	// Deferred so we don't force the emoji dataset to load until the picker opens.
	getEmojis: () => string[]
}

export const emojiPackPlugins: EmojiPackPlugin[] = [
	{
		type: "chat:emojipack",
		id: "unicode",
		name: "Emoji",
		tier: "core",
		getEmojis: () => EMOJI_DATA().map((e) => e.emoji),
	},
]

/** Flatten the active packs' emoji into one de-duplicated list. */
export function collectEmojis(packs: EmojiPackPlugin[]): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const pack of packs) {
		let list: string[] = []
		try {
			list = pack.getEmojis() || []
		} catch {
			list = []
		}
		for (const e of list) {
			if (!seen.has(e)) {
				seen.add(e)
				out.push(e)
			}
		}
	}
	return out
}
