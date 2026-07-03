import {Show, createResource, createMemo} from "solid-js"
import {createSignal} from "solid-js"
import type {AutomergeUrl} from "@automerge/automerge-repo"
import {automergeUrlToServiceWorkerUrl} from "@inkandswitch/patchwork-filesystem"

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
	// Live avatar from the contact doc (comments-view pattern) — used when we have a
	// contactUrl and aren't showing a GIF selfie or the computer icon. Falls back to
	// the stored avatarUrl / initials for older messages without a contactUrl.
	const useContactView = () =>
		!!props.contactUrl && !isGif() && !props.isComputer

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
							<Show when={props.isComputer} fallback={(props.name || "?")[0].toUpperCase()}>
								<img src={computerPngUrl} alt="Computer" />
							</Show>
						}
					>
						<img src={imgUrl()!} alt={props.name} />
					</Show>
				}
			>
				<patchwork-view
					class="chat-avatar-view"
					tool-id="contact-avatar"
					doc-url={props.contactUrl}
				/>
			</Show>
		</div>
	)
}
