import {onMount, createEffect} from "solid-js"
import {automergeUrlToServiceWorkerUrl} from "@inkandswitch/patchwork-filesystem"
import {
	getNotificationSound,
	showOSNotification,
	setFaviconUnread,
} from "../lib/notifications"
import type {SlotContextValue} from "../slot-context"

/** Watches for new messages and triggers sound/OS notifications + title updates.
 * Headless (returns null). Context comes in explicitly via SlotContext so this can
 * live in another bundle. */
export function NotificationManager(props: {ctx: SlotContextValue}) {
	const {doc, repo, handle} = props.ctx.chat
	const {myName, chatProfileHandle} = props.ctx.identity
	const {isFocused, typingUsers} = props.ctx.presence

	let lastMsgCount = 0
	let hasUnread = false
	const soundEnabled = () =>
		localStorage.getItem("chat-sound-enabled") !== "false"
	const notificationsEnabled = () =>
		localStorage.getItem("chat-notifications-enabled") === "true"

	function updateTitle() {
		const d = doc()
		const baseTitle = d?.title || "Chat"
		const typers = typingUsers()
		let title = baseTitle
		if (typers.length > 0) {
			title = typers.join(", ") + " is typing… — " + baseTitle
		}
		if (hasUnread) title = "* " + title
		document.title = title
		setFaviconUnread(hasUnread)
	}

	function markReadIfVisible() {
		if (!isFocused()) return
		const d = doc()
		if (!d?.messages?.length) return
		const lastMsg = d.messages[d.messages.length - 1] as any
		const ts = lastMsg?.timestamp || Date.now()
		hasUnread = false
		updateTitle()

		const ph = chatProfileHandle()
		if (ph) {
			ph.change((p: any) => {
				if (!p.readPositions) p.readPositions = {}
				p.readPositions[handle.url] = ts
			})
		}
	}

	onMount(() => {
		const d = doc()
		lastMsgCount = d?.messages?.length || 0

		// Check initial unread state
		const ph = chatProfileHandle()
		if (ph) {
			const profile = ph.doc() as any
			const lastRead = profile?.readPositions?.[handle.url] || 0
			if (d?.messages?.length) {
				const lastMsg = d.messages[d.messages.length - 1] as any
				if ((lastMsg?.timestamp || 0) > lastRead) {
					hasUnread = true
				}
			}
		}
		updateTitle()
	})

	// Watch for new messages
	createEffect(() => {
		const d = doc()
		if (!d?.messages) return
		const count = d.messages.length
		if (count > lastMsgCount && lastMsgCount > 0) {
			// New message(s) arrived
			const lastEntry = d.messages[count - 1] as any
			if (lastEntry?.ref && lastEntry?.url) {
				if (repo) {
					repo.find(lastEntry.url).then(async (mh: any) => {
						const msg = mh.doc()
						if (!msg || msg.name === myName()) return

						// Play sound
						if (soundEnabled() && !isFocused()) {
							const audio = await getNotificationSound()
							if (audio) {
								audio.currentTime = 0
								audio.play().catch(() => {})
							}
						}

						// OS notification
						if (notificationsEnabled() && !isFocused()) {
							const avatarIcon = msg.avatarUrl
								? automergeUrlToServiceWorkerUrl(msg.avatarUrl as any)
								: undefined
							showOSNotification(msg.name, msg.text, avatarIcon, handle.url)
						}

						if (!isFocused()) {
							hasUnread = true
							updateTitle()
						}
					})
				}
			}
		}
		lastMsgCount = count
	})

	// Update title when typing users change
	createEffect(() => {
		typingUsers() // track
		updateTitle()
	})

	// Mark read when focused
	createEffect(() => {
		if (isFocused()) markReadIfVisible()
	})

	return null
}
