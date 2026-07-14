// The chitter feature slot renderers. This module holds ALL the JSX — so it (and
// the `solid-js` / `solid-js/web` runtime the JSX compiles to) is only ever pulled
// in via the DYNAMIC imports in `features.ts`'s `load()`s, and never enters the
// entry bundle's (worker) static graph. Each export returns the `{slots}` object
// for one feature; the components it references are themselves dynamically imported.
// CSS classes referenced here come from the base tool's injected `chat.css`, which
// is always present because chitter only ever renders inside an open chat.
import {Show} from "solid-js"
import type {SlotContextValue} from "./slot-context"

export async function notifications() {
	const {NotificationManager} = await import("./components/NotificationManager")
	return {
		slots: {
			background: (ctx: SlotContextValue) => <NotificationManager ctx={ctx} />,
		},
	}
}

export async function reactions() {
	const [{EmojiPicker}, {MessageReactions}] = await Promise.all([
		import("./components/EmojiPicker"),
		import("./components/MessageReactions"),
	])
	return {
		slots: {
			"emoji-picker-overlay": (ctx: SlotContextValue) => (
				<Show when={ctx.base.emojiPickerState().open}>
					<EmojiPicker
						ctx={ctx}
						targetIdx={ctx.base.emojiPickerState().targetIdx}
						anchorEl={ctx.base.emojiPickerState().anchorEl}
						onClose={ctx.base.closeEmojiPicker}
					/>
				</Show>
			),
			"message-reactions-row": (ctx: SlotContextValue, extra: any) => (
				<MessageReactions
					msg={extra.msg}
					rawIdx={extra.rawIdx}
					myName={ctx.identity.myName}
					onToggleReaction={extra.onToggleReaction}
					onAddReaction={extra.onAddReaction}
				/>
			),
		},
	}
}

export async function emoticons() {
	const [{EmoticonAddDialog}, {FontAddDialog}] = await Promise.all([
		import("./components/EmoticonAddDialog"),
		import("./components/FontAddDialog"),
	])
	return {
		slots: {
			"emoticon-add-dialog": (ctx: SlotContextValue) => (
				<Show when={ctx.base.showEmoticonDialog()}>
					<div
						class="chat-dialog-overlay"
						on:click={() => ctx.base.setShowEmoticonDialog(false)}>
						<EmoticonAddDialog ctx={ctx} onClose={() => ctx.base.setShowEmoticonDialog(false)} />
					</div>
				</Show>
			),
			"font-add-dialog": (ctx: SlotContextValue) => (
				<Show when={ctx.base.showFontDialog()}>
					<div
						class="chat-dialog-overlay"
						on:click={() => ctx.base.setShowFontDialog(false)}>
						<FontAddDialog ctx={ctx} onClose={() => ctx.base.setShowFontDialog(false)} />
					</div>
				</Show>
			),
		},
	}
}

export async function sidebar() {
	const {Sidebar} = await import("./components/Sidebar")
	return {
		slots: {
			"right-sidebar": (ctx: SlotContextValue) => (
				<Show when={!ctx.base.isContext()}>
					<Sidebar
						ctx={ctx}
						visible={ctx.base.sidebarVisible()}
						onVisibilityChange={ctx.base.setSidebarVisible}
					/>
				</Show>
			),
		},
	}
}

export async function voice() {
	const {VoiceActions} = await import("./components/VoiceActions")
	return {
		slots: {
			"input-actions-right": (ctx: SlotContextValue, caps: any) => (
				<VoiceActions ctx={ctx} caps={caps} />
			),
		},
	}
}

export async function gifSelfie() {
	const {GifActions} = await import("./components/GifActions")
	return {
		slots: {
			"input-actions-left": (ctx: SlotContextValue, caps: any) => (
				<GifActions ctx={ctx} caps={caps} />
			),
		},
	}
}
