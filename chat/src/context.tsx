import {createContext, useContext} from "solid-js"
import type {Accessor, Setter} from "solid-js"
import type {DocHandle} from "@automerge/automerge-repo"
import type {
	ChatDoc,
	ChatProfileDoc,
	PresenceInfo,
	EmoticonInfo,
	PendingFile,
} from "./types"

export interface ChatContextValue {
	handle: DocHandle<ChatDoc>
	repo: any
	myName: Accessor<string>
	myFont: Accessor<string | null>
	myAvatarUrl: Accessor<string | null>
	myAvatarBlobUrl: Accessor<string | null>
	myColor: Accessor<string | null>
	chatUrl: string

	// Emoticons
	getAllEmoticons: () => Record<string, EmoticonInfo>
	addEmoticon: (name: string, file: File) => Promise<string>
	adoptEmoticon: (name: string, url: string) => void
	myEmoticons: Accessor<Record<string, string>>

	// Presence
	presenceMap: Accessor<Map<string, PresenceInfo>>
	isFocused: Accessor<boolean>
	broadcastPresence: (typing: boolean) => void

	// Reactions
	toggleReaction: (rawIdx: number, emoji: string, msgHandle?: DocHandle<any>) => void

	// Reply
	replyToId: Accessor<string | null>
	setReplyToId: Setter<string | null>
	setReply: (msgId: string, previewText?: string) => void

	// Files
	pendingFiles: Accessor<PendingFile[]>
	setPendingFiles: Setter<PendingFile[]>
	addPendingFile: (blob: Blob, name: string, mimeType: string) => void
	removePendingFile: (idx: number) => void
	clearPaste: () => void

	// Draft
	scheduleDraftSync: () => void
	clearDraft: () => void

	// Send
	sendMessage: () => Promise<void>

	// Recording
	isRecording: Accessor<boolean>
	startRec: () => Promise<void>
	stopAndSendRec: () => void
	cancelRec: () => void

	// GIF
	gifModeEnabled: Accessor<boolean>
	setGifModeEnabled: Setter<boolean>
	gifVideoRef: HTMLVideoElement | undefined
	gifStreamRef: {current: MediaStream | null}

	// Cat ears
	catEarsSet: Set<string>

	// Delete
	deleteMessage: (idx: number) => void

	// Chat profile handle
	chatProfileHandle: Accessor<DocHandle<ChatProfileDoc> | null>

	// Root element ref for theme
	rootRef: HTMLDivElement | undefined

	// Emoji picker
	openEmojiPicker: (msgIndex: number, anchorEl: HTMLElement) => void

	// Notifications
	notificationsEnabled: Accessor<boolean>
	toggleNotifications: () => Promise<void>

	// File/recording creation
	createFileDoc: (
		blob: Blob,
		fileName?: string,
		mimeType?: string
	) => Promise<string>
}

export const ChatContext = createContext<ChatContextValue>()

export function useChatContext(): ChatContextValue {
	const ctx = useContext(ChatContext)
	if (!ctx) throw new Error("useChatContext must be used within ChatContext.Provider")
	return ctx
}
