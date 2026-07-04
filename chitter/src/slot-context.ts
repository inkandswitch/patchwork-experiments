// Structural mirror of the base `chat` bundle's SlotContextValue
// (chat/src/context/SlotContext.tsx). Slot renderers here receive this object as
// an explicit argument — they must NOT import the base's context or call
// useChat/useIdentity/usePresence (createContext identity differs across bundles).
//
// Typed loosely on purpose: this is a cross-bundle contract, not a shared module.
// Only the shapes the moved components actually read are spelled out.
import type {Accessor} from "solid-js"
import type {AutomergeUrl, DocHandle, Repo, Doc} from "@automerge/automerge-repo"

export interface SlotBaseCaps {
	isContext: Accessor<boolean>
	sidebarVisible: Accessor<boolean>
	setSidebarVisible: (v: boolean) => void
	toggleSidebar: () => void
	pinDoc: (url: AutomergeUrl, toolId?: string, name?: string) => void
	emojiPickerState: Accessor<{open: boolean; targetIdx: number | null; anchorEl: HTMLElement | null}>
	openEmojiPicker: (idx: number, anchorEl: HTMLElement) => void
	closeEmojiPicker: () => void
	replyToId: Accessor<string | null>
	setReplyToId: (v: string | null) => void
	showEmoticonDialog: Accessor<boolean>
	setShowEmoticonDialog: (v: boolean) => void
	showFontDialog: Accessor<boolean>
	setShowFontDialog: (v: boolean) => void
	onCallCommand: () => void
	openLightbox: (src: string, type?: string) => void
	computerActive: Accessor<boolean>
}

export interface SlotChat {
	handle: DocHandle<any>
	doc: Accessor<Doc<any> | undefined>
	repo: Repo
	element: HTMLElement
	chatUrl: string
	selector: Accessor<"all" | "core" | string[]>
	hasFeature: (id: string) => boolean
}

export interface SlotIdentity {
	myName: Accessor<string>
	myContactUrl: Accessor<AutomergeUrl | null>
	myFont: Accessor<string | null>
	myAvatarUrl: Accessor<AutomergeUrl | null>
	myColor: Accessor<string | null>
	chatProfileHandle: Accessor<DocHandle<any> | null>
	contactHandle: Accessor<DocHandle<any> | null>
	myEmoticons: Accessor<Record<string, AutomergeUrl>>
	setMyEmoticons: (v: Record<string, AutomergeUrl>) => void
	myFonts: Accessor<Record<string, AutomergeUrl>>
	setMyFonts: (v: Record<string, AutomergeUrl>) => void
}

export interface SlotPresence {
	presenceMap: Accessor<Map<string, any>>
	broadcastPresence: (typing: boolean) => void
	isFocused: Accessor<boolean>
	typingUsers: Accessor<string[]>
	peerEmoticons: Accessor<Map<string, Record<string, AutomergeUrl>>>
	peerFonts: Accessor<Map<string, Record<string, AutomergeUrl>>>
}

export interface SlotContextValue {
	chat: SlotChat
	identity: SlotIdentity
	presence: SlotPresence
	base: SlotBaseCaps
	slotsFor: (slotId: string) => any[]
}
