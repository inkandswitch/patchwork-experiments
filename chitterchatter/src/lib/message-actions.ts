import {SVG_ICONS} from "./svg-icons"
import type {ChatMessage} from "../types"

// Built-in `chat:messageaction` plugins — the hover-bar buttons. A plugin has an
// icon (inline SVG), a tier, an optional `show` predicate, and a `run` invoked
// with a context object carrying the message + the callbacks the tool provides.
//
// Reply is tier:"core" (available in the minimal `chat` tool); react + delete are
// tier:"full". Host modules can add their own.

export interface MessageActionContext {
	msg: ChatMessage
	rawIdx: number
	anchorEl: HTMLElement
	onReply: (msgId: string) => void
	onReact: (idx: number, anchorEl: HTMLElement) => void
	onDelete: (idx: number) => void
}

export interface MessageActionPlugin {
	type: "chat:messageaction"
	id: string
	name: string
	icon: string
	tier: "core" | "full"
	show?: (msg: ChatMessage) => boolean
	run: (ctx: MessageActionContext) => void
}

export const messageActionPlugins: MessageActionPlugin[] = [
	{
		type: "chat:messageaction", id: "reply", name: "Reply", icon: SVG_ICONS.reply, tier: "core",
		show: (msg) => !msg._loading,
		run: (ctx) => ctx.onReply(ctx.msg.id),
	},
	{
		type: "chat:messageaction", id: "react", name: "Add reaction", icon: SVG_ICONS.react, tier: "full",
		run: (ctx) => ctx.onReact(ctx.rawIdx, ctx.anchorEl),
	},
	{
		type: "chat:messageaction", id: "delete", name: "Delete", icon: SVG_ICONS.trash, tier: "full",
		run: (ctx) => ctx.onDelete(ctx.rawIdx),
	},
]

// Serializable registry descriptions: metadata (incl. the SVG `icon` string) +
// an async `load()` carrying the function-valued fields (`show`, `run`). Plugin
// entries are cloned worker → main with `load` excluded, so function fields must
// live behind load(). The tool renders from the inline `messageActionPlugins`.
export const messageActionDescriptions = messageActionPlugins.map((p) => {
	const {show, run, ...meta} = p
	return {...meta, async load() { return {show, run} }}
})
