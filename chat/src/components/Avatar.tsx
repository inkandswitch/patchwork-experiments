import {Show, createResource} from "solid-js"
import {createSignal} from "solid-js"
import type {AutomergeUrl} from "@automerge/automerge-repo"
import {loadBlobUrl} from "../lib/blob-cache"

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
	avatarUrl?: AutomergeUrl
	gifSelfieUrl?: AutomergeUrl
	isComputer?: boolean
	size?: number
	onClick?: () => void
}) {
	const size = () => props.size || 40

	const [blobUrl] = createResource(
		() => props.gifSelfieUrl || props.avatarUrl,
		async (url) => (url ? loadBlobUrl(url) : null)
	)

	const isGif = () => !!props.gifSelfieUrl

	return (
		<div
			class="chat-avatar"
			classList={{
				"cat-ears": catEarsSet().has(props.name),
				"gif-selfie": isGif(),
				"computer": props.isComputer,
			}}
			style={{width: size() + "px", height: size() + "px"}}
			onClick={() => {
				toggleCatEars(props.name)
				props.onClick?.()
			}}
		>
			<Show
				when={blobUrl()}
				fallback={
					<Show when={props.isComputer} fallback={(props.name || "?")[0].toUpperCase()}>
						<img src={computerPngUrl} alt="Computer" />
					</Show>
				}
			>
				<img src={blobUrl()!} alt={props.name} />
			</Show>
		</div>
	)
}
