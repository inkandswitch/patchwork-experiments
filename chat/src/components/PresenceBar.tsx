import {For, Show, createSignal, createMemo, onMount, onCleanup} from "solid-js"
import {useChat} from "../context/ChatContext"
import {useIdentity} from "../context/IdentityContext"
import {usePresence} from "../context/PresenceContext"
import {SVG_ICONS} from "../lib/svg-icons"
import {ThemePopover} from "./ThemePopover"
import {NotifyMenu} from "./NotifyMenu"
import {automergeUrlToServiceWorkerUrl} from "@inkandswitch/patchwork-filesystem"

const computerPngUrl = new URL("../../computer.png", import.meta.url).href

export function PresenceBar(props: {
	onToggleSidebar?: () => void
	onCallCommand?: () => void
	computerActive?: boolean
}) {
	const {doc} = useChat()
	const {myName, myAvatarUrl} = useIdentity()
	const {presenceMap, isFocused} = usePresence()

	const [showTheme, setShowTheme] = createSignal(false)
	const [showNotify, setShowNotify] = createSignal(false)
	const [themeRect, setThemeRect] = createSignal<DOMRect | null>(null)
	const [notifyRect, setNotifyRect] = createSignal<DOMRect | null>(null)
	let themeBtnRef!: HTMLButtonElement
	let notifyBtnRef!: HTMLButtonElement

	const presenceUsers = createMemo(() => {
		const result: {name: string; avatarSrc?: string; active: boolean; isComputer?: boolean}[] = []
		// Self
		const myAvUrl = myAvatarUrl()
		result.push({
			name: myName(),
			avatarSrc: myAvUrl ? automergeUrlToServiceWorkerUrl(myAvUrl) : undefined,
			active: isFocused(),
		})
		// Peers
		for (const [name, info] of presenceMap()) {
			if (name === myName()) continue
			result.push({
				name,
				active: info.active,
				avatarSrc: info.avatarUrl ? automergeUrlToServiceWorkerUrl(info.avatarUrl as any) : undefined,
			})
		}
		// Computer
		if (props.computerActive) {
			result.push({name: "computer", active: true, avatarSrc: computerPngUrl, isComputer: true})
		}
		return result
	})

	// Close popovers on outside click
	function handleDocClick(e: MouseEvent) {
		if (showTheme() && themeBtnRef && !themeBtnRef.contains(e.target as Node)) {
			// Check if click is inside the popover
			const popover = document.querySelector(".chat-theme-popover")
			if (!popover?.contains(e.target as Node)) setShowTheme(false)
		}
		if (showNotify() && notifyBtnRef && !notifyBtnRef.contains(e.target as Node)) {
			const menu = document.querySelector(".chat-notify-menu")
			if (!menu?.contains(e.target as Node)) setShowNotify(false)
		}
	}

	onMount(() => document.addEventListener("click", handleDocClick, true))
	onCleanup(() => document.removeEventListener("click", handleDocClick, true))

	function toggleTheme() {
		if (!showTheme()) {
			setThemeRect(themeBtnRef.getBoundingClientRect())
		}
		setShowTheme(!showTheme())
		setShowNotify(false)
	}

	function toggleNotify() {
		if (!showNotify()) {
			setNotifyRect(notifyBtnRef.getBoundingClientRect())
		}
		setShowNotify(!showNotify())
		setShowTheme(false)
	}

	return (
		<div class="chat-presence-bar" title={doc()?.title || "Chat"}>
			<For each={presenceUsers()}>
				{(user) => (
					<div class="chat-presence-user" classList={{away: !user.active}}>
						<span class="chat-presence-avatar">
							<Show when={user.avatarSrc} fallback={(user.name || "?")[0].toUpperCase()}>
								<img src={user.avatarSrc} />
							</Show>
						</span>
						{user.name}
					</div>
				)}
			</For>
			<div style="margin-left:auto;display:flex;align-items:center;gap:2px">
				<button
					ref={notifyBtnRef}
					class="chat-notify-btn"
					on:click={toggleNotify}
					innerHTML={SVG_ICONS.bellOutline}
				/>
				<Show when={showNotify() && notifyRect()}>
					<NotifyMenu
						anchorRect={notifyRect()!}
						onClose={() => setShowNotify(false)}
					/>
				</Show>
				<button
					ref={themeBtnRef}
					class="chat-theme-btn"
					title="Theme"
					on:click={toggleTheme}
					innerHTML={SVG_ICONS.theme}
				/>
				<Show when={showTheme() && themeRect()}>
					<ThemePopover
						anchorRect={themeRect()!}
						onClose={() => setShowTheme(false)}
					/>
				</Show>
				<button
					class="chat-theme-btn"
					title="Call"
					on:click={() => props.onCallCommand?.()}
					innerHTML={SVG_ICONS.phone}
				/>
				<button
					class="chat-sidebar-toggle-btn"
					title="Toggle sidebar"
					on:click={() => props.onToggleSidebar?.()}
					innerHTML={SVG_ICONS.sidebar}
				/>
			</div>
		</div>
	)
}
