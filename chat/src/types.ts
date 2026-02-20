import type {AutomergeUrl, DocHandle} from "@automerge/automerge-repo"

export interface MessageRef {
	ref: true
	url: AutomergeUrl
	timestamp: number
}

export interface InlineMessage {
	id: string
	name: string
	text: string
	timestamp: number
	font?: string
	avatarUrl?: AutomergeUrl
	color?: string
	replyTo?: string
	imageUrl?: AutomergeUrl
	imageName?: string
	imageWidth?: number
	imageHeight?: number
	voiceUrl?: AutomergeUrl
	voiceDuration?: number
	gifSelfieUrl?: AutomergeUrl
	reactions?: Record<string, string[]>
	embeds?: EmbedLink[]
	action?: boolean
	marquee?: boolean
	files?: FileAttachment[]
	emoticons?: Record<string, AutomergeUrl>
}

export type MessageEntry = MessageRef | InlineMessage

export interface MessageData {
	id: string
	name: string
	text: string
	timestamp: number
	font?: string
	avatarUrl?: AutomergeUrl
	color?: string
	replyTo?: string
	imageUrl?: AutomergeUrl
	imageName?: string
	imageWidth?: number
	imageHeight?: number
	voiceUrl?: AutomergeUrl
	voiceDuration?: number
	gifSelfieUrl?: AutomergeUrl
	reactions?: Record<string, string[]>
	embeds?: EmbedLink[]
	action?: boolean
	marquee?: boolean
	files?: FileAttachment[]
	emoticons?: Record<string, AutomergeUrl>
}

export interface EmbedLink {
	docUrl: AutomergeUrl
	title?: string
	type?: string
	originalUrl: string
}

export interface FileAttachment {
	url: AutomergeUrl
	name: string
	mimeType: string
}

export interface DocLink {
	url: AutomergeUrl
	type: string
	name: string
}

export interface EmoticonEntry {
	url: AutomergeUrl
	addedBy: string
}

export interface ChatDoc {
	title: string
	messages: MessageEntry[]
	docs: DocLink[]
	emoticons?: Record<string, EmoticonEntry>
	toolOverrides?: Record<string, string>
}

export interface ChatProfileDoc {
	font?: string
	readPositions?: Record<string, number>
	emoticons?: Record<string, AutomergeUrl>
	drafts?: Record<string, AutomergeUrl>
}

export interface DraftDoc {
	text: string
}

export interface PresenceInfo {
	timestamp: number
	typing: boolean
	avatarUrl?: AutomergeUrl
	color?: string
	active: boolean
	emoticons?: Record<string, AutomergeUrl>
}

export interface PresencePayload {
	type: "presence"
	name: string
	typing: boolean
	avatarUrl?: AutomergeUrl
	color?: string
	active: boolean
	timestamp: number
	emoticons?: Record<string, AutomergeUrl>
}

export interface EmoticonInfo {
	url: AutomergeUrl
	owner: string
	mine: boolean
	fromChat?: boolean
}

export interface ResolvedMessage extends MessageData {
	_rawIdx: number
	_ref?: MessageRef
	_handle?: DocHandle<any>
}

export interface PendingFile {
	blob: Blob
	name: string
	mimeType: string
	dataUrl?: string
}

export interface SlashCommandResult {
	text: string
	action?: boolean
	overrideFont?: string
	overrideColor?: string
	marquee?: boolean
}
