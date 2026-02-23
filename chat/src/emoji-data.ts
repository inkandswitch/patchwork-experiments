export interface EmojiEntry {
	emoji: string
	name: string
	group: string
}

export let EMOJI_DATA: EmojiEntry[] = []
export let EMOJI_LOADED = false

export const FALLBACK_EMOJIS = [
	"\u{1F600}",
	"\u{1F603}",
	"\u{1F604}",
	"\u{1F601}",
	"\u{1F606}",
	"\u{1F605}",
	"\u{1F923}",
	"\u{1F602}",
	"\u{1F642}",
	"\u{1F609}",
	"\u{1F60A}",
	"\u{1F607}",
	"\u{1F970}",
	"\u{1F60D}",
	"\u{1F929}",
	"\u{1F618}",
	"\u{1F60B}",
	"\u{1F61B}",
	"\u{1F61C}",
	"\u{1F92A}",
	"\u{1F61D}",
	"\u{1F917}",
	"\u{1F92D}",
	"\u{1F92B}",
	"\u{1F914}",
	"\u{1F610}",
	"\u{1F60F}",
	"\u{1F644}",
	"\u{1F62C}",
	"\u{1F60C}",
	"\u{1F634}",
	"\u{1F92E}",
	"\u{1F975}",
	"\u{1F976}",
	"\u{1F92F}",
	"\u{1F920}",
	"\u{1F973}",
	"\u{1F60E}",
	"\u{1F913}",
	"\u{1F622}",
	"\u{1F62D}",
	"\u{1F631}",
	"\u{1F624}",
	"\u{1F621}",
	"\u{1F608}",
	"\u{1F480}",
	"\u{1F4A9}",
	"\u{1F921}",
	"\u{1F47B}",
	"\u{1F47D}",
	"\u{1F916}",
	"\u2764\uFE0F",
	"\u{1F9E1}",
	"\u{1F49B}",
	"\u{1F49A}",
	"\u{1F499}",
	"\u{1F49C}",
	"\u{1F5A4}",
	"\u{1F90D}",
	"\u{1F494}",
	"\u{1F44D}",
	"\u{1F44E}",
	"\u{1F44A}",
	"\u270A",
	"\u{1F91E}",
	"\u270C\uFE0F",
	"\u{1F91F}",
	"\u{1F918}",
	"\u{1F44C}",
	"\u{1F44B}",
	"\u{1F4AA}",
	"\u{1F64F}",
	"\u{1F389}",
	"\u{1F38A}",
	"\u{1F3C6}",
	"\u{1F525}",
	"\u2B50",
	"\u2728",
	"\u26A1",
	"\u{1F4A5}",
	"\u{1F4AF}",
	"\u{1F3B5}",
	"\u{1F3B6}",
]

export const QUICK_EMOJIS = [
	"\u{1F44D}",
	"\u2764\uFE0F",
	"\u{1F602}",
	"\u{1F62E}",
	"\u{1F622}",
	"\u{1F389}",
	"\u{1F525}",
	"\u{1F440}",
]

export function loadEmojiData() {
	// @ts-ignore - esm.sh dynamic import
	import("https://esm.sh/unicode-emoji-json@0.6.0")
		.then((mod: any) => {
			const data = mod.default
			EMOJI_DATA = Object.entries(data).map(
				([emoji, info]: [string, any]) => ({
					emoji,
					name: info.name || "",
					group: info.group || "",
				})
			)
			EMOJI_LOADED = true
		})
		.catch((e: any) =>
			console.warn("[Chat] emoji load failed, using fallback:", e)
		)
}
