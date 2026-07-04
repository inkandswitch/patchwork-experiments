// The chitter feature descriptions. Each is a serializable `chat:feature` entry
// whose Solid slot renderers live behind `async load()` — and the components
// themselves are pulled in by DYNAMIC imports inside load(), so they never enter
// the entry bundle's (worker) static graph. The base `chat` tool discovers these
// via the registry and mounts each slot's renderer with the explicit SlotContext.
// CSS classes referenced here come from the base tool's injected `chat.css`, which
// is always present because chitter only ever renders inside an open chat.
import {Show} from "solid-js"
import type {SlotContextValue} from "./slot-context"

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
			const {NotificationManager} = await import("./components/NotificationManager")
			return {
				slots: {
					background: (ctx: SlotContextValue) => <NotificationManager ctx={ctx} />,
				},
			}
		},
	},
	{
		type: "chat:feature",
		id: "reactions",
		name: "Reactions",
		tier: "full",
		async load() {
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
		},
	},
	{
		type: "chat:feature",
		id: "emoticons",
		name: "Custom emoticons",
		tier: "full",
		async load() {
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
		},
	},
	{
		type: "chat:feature",
		id: "sidebar",
		name: "Sidebar",
		tier: "full",
		async load() {
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
		},
	},
	{
		type: "chat:feature",
		id: "voice",
		name: "Voice notes",
		tier: "full",
		async load() {
			const {VoiceActions} = await import("./components/VoiceActions")
			return {
				slots: {
					"input-actions-right": (ctx: SlotContextValue, caps: any) => (
						<VoiceActions ctx={ctx} caps={caps} />
					),
				},
			}
		},
	},
	{
		type: "chat:feature",
		id: "gifSelfie",
		name: "GIF selfie",
		tier: "full",
		async load() {
			const {GifActions} = await import("./components/GifActions")
			return {
				slots: {
					"input-actions-left": (ctx: SlotContextValue, caps: any) => (
						<GifActions ctx={ctx} caps={caps} />
					),
				},
			}
		},
	},
]
