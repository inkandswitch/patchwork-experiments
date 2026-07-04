import {Show, createMemo, createSignal, createEffect, onCleanup} from "solid-js"
import type {AutomergeUrl} from "@automerge/automerge-repo"
import {automergeUrlToServiceWorkerUrl} from "@inkandswitch/patchwork-filesystem"
import {getRepo} from "../lib/repo"

const computerPngUrl = new URL("../../computer.png", import.meta.url).href

// Shared per-session cat ears state (by author name)
const [catEarsSet, setCatEarsSet] = createSignal(new Set<string>())

function toggleCatEars(name: string) {
	setCatEarsSet(prev => {
		const next = new Set(prev)
		if (next.has(name)) next.delete(name)
		else next.add(name)
		return next
	})
}

export function Avatar(props: {
	name: string
	contactUrl?: AutomergeUrl
	avatarUrl?: AutomergeUrl
	gifSelfieUrl?: AutomergeUrl
	isComputer?: boolean
	size?: number
	onClick?: () => void
}) {
	const size = () => props.size || 40

	const imgUrl = createMemo(() => {
		const url = props.gifSelfieUrl || props.avatarUrl
		return url ? automergeUrlToServiceWorkerUrl(url) : null
	})

	const isGif = () => !!props.gifSelfieUrl
	// Resolve the avatar straight off the contact doc (instead of embedding a
	// `<patchwork-view tool-id="contact-avatar">`): find the contact handle, read
	// its `avatarUrl`, and render the file ourselves via a service-worker URL. Stays
	// live by re-reading on contact-doc changes. Used when we have a contactUrl and
	// aren't showing a GIF selfie or the computer icon; falls back to the stored
	// avatarUrl / initials for older messages without a contactUrl.
	const useContactView = () =>
		!!props.contactUrl && !isGif() && !props.isComputer

	const [contactAvatarSrc, setContactAvatarSrc] = createSignal<string | null>(null)
	createEffect(() => {
		const url = useContactView() ? props.contactUrl : undefined
		setContactAvatarSrc(null)
		if (!url) return
		const repo = getRepo()
		if (!repo) return
		let off: (() => void) | undefined
		let cancelled = false
		repo
			.find(url)
			.then((h: any) => {
				if (cancelled) return
				const read = () => {
					const av = (h.doc() as any)?.avatarUrl as AutomergeUrl | undefined
					setContactAvatarSrc(av ? automergeUrlToServiceWorkerUrl(av) : null)
				}
				read()
				h.on("change", read)
				off = () => h.off("change", read)
			})
			.catch(() => {})
		onCleanup(() => {
			cancelled = true
			off?.()
		})
	})

	const initials = () => (props.name || "?")[0].toUpperCase()

	return (
		<div
			class="chat-avatar"
			classList={{
				"cat-ears": catEarsSet().has(props.name),
				"gif-selfie": isGif(),
				"computer": props.isComputer,
			}}
			style={{width: size() + "px", height: size() + "px"}}
			on:click={() => {
				toggleCatEars(props.name)
				props.onClick?.()
			}}
		>
			<Show
				when={useContactView()}
				fallback={
					<Show
						when={imgUrl()}
						fallback={
							<Show when={props.isComputer} fallback={initials()}>
								<img src={computerPngUrl} alt="Computer" />
							</Show>
						}
					>
						<img src={imgUrl()!} alt={props.name} />
					</Show>
				}
			>
				<Show when={contactAvatarSrc()} fallback={initials()}>
					<img class="chat-avatar-view" src={contactAvatarSrc()!} alt={props.name} />
				</Show>
			</Show>
		</div>
	)
}
