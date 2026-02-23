import {For, Show, createSignal} from "solid-js"
import {useChatContext} from "./context"
import {useBlobUrl} from "./resources"
import {SVG_ICONS} from "./icons"
import {ThemePopover} from "./ThemePopover"

export function PresenceBar() {
	const ctx = useChatContext()
	const [showTheme, setShowTheme] = createSignal(false)

	const peers = () => {
		const now = Date.now()
		const result: {name: string; avatarUrl?: string; active: boolean}[] = []
		for (const [name, info] of ctx.presenceMap()) {
			if (name === ctx.myName()) continue
			if (now - info.timestamp > 30000) continue
			result.push({name, avatarUrl: info.avatarUrl, active: info.active})
		}
		return result
	}

	const notifIcon = () => {
		if (typeof Notification === "undefined") return SVG_ICONS.bellOff
		const perm = Notification.permission
		if (perm === "denied") return SVG_ICONS.bellOff
		if (ctx.notificationsEnabled() && perm === "granted") return SVG_ICONS.bellFilled
		return SVG_ICONS.bellOutline
	}

	const notifDenied = () => {
		return typeof Notification !== "undefined" && Notification.permission === "denied"
	}

	return (
		<div class="chat-presence-bar">
			{/* Self */}
			<Show when={ctx.myName()}>
				<div class={"chat-presence-user" + (ctx.isFocused() ? "" : " away")}>
					<span class="chat-presence-avatar">
						<Show
							when={ctx.myAvatarBlobUrl()}
							fallback={<>{(ctx.myName() || "?")[0].toUpperCase()}</>}
						>
							<img src={ctx.myAvatarBlobUrl()!} />
						</Show>
					</span>
					<span>{ctx.myName()}</span>
				</div>
			</Show>

			{/* Peers */}
			<For each={peers()}>
				{(peer) => (
					<div class={"chat-presence-user" + (peer.active ? "" : " away")}>
						<PresenceAvatar avatarUrl={peer.avatarUrl} name={peer.name} />
						<span>{peer.name}</span>
					</div>
				)}
			</For>

			{/* Notify button */}
			<button
				class={"chat-notify-btn" + (notifDenied() ? " denied" : "")}
				title={
					notifDenied()
						? "Notifications blocked by browser"
						: ctx.notificationsEnabled()
							? "Notifications on"
							: "Enable notifications"
				}
				on:click={(e) => {
					e.preventDefault()
					e.stopPropagation()
					ctx.toggleNotifications()
				}}
				innerHTML={notifIcon()}
			/>

			{/* Theme button */}
			<button
				class="chat-theme-btn"
				title="Theme"
				style="position:relative"
				innerHTML={SVG_ICONS.theme}
				on:click={(e) => {
					e.stopPropagation()
					setShowTheme(!showTheme())
				}}
			/>
			<Show when={showTheme()}>
				<ThemePopover onClose={() => setShowTheme(false)} />
			</Show>
		</div>
	)
}

function PresenceAvatar(props: {avatarUrl?: string; name: string}) {
	const blobUrl = useBlobUrl(() => props.avatarUrl)

	return (
		<span class="chat-presence-avatar">
			<Show
				when={blobUrl()}
				fallback={<>{(props.name || "?")[0].toUpperCase()}</>}
			>
				<img src={blobUrl()!} />
			</Show>
		</span>
	)
}
