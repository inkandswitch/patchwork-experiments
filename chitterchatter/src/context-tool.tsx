// The `context-tool` variant of chitterchatter.
//
// Registered as a `patchwork:component` (render signature `(element) => cleanup`,
// no bound doc). It reads whatever document the user has FOCUSED from the
// selected-doc provider, stores its chat in a separate doc referenced from
// `focusedDoc['@patchwork'].chitchat` (created on first use), and renders the
// chat UI — streamlined (no sidebar) and with the computer pointed at editing
// the focused document instead of building tools.
import {render} from "solid-js/web"
import {createSignal, createEffect, Show} from "solid-js"
import type {Repo, DocHandle, AutomergeUrl} from "@automerge/automerge-repo"
import {ChatRoot} from "./components/ChatRoot"
import {selectedDocUrl} from "./lib/selected-doc"
import {setRepo} from "./lib/repo"
import type {ChatDoc} from "./types"

/** Find (or create + link) the chat doc stored on the focused document. */
async function ensureChitchat(
	repo: Repo,
	targetUrl: AutomergeUrl
): Promise<DocHandle<ChatDoc>> {
	const target = await repo.find(targetUrl)
	const existing = (target.doc() as any)?.["@patchwork"]?.chitchat
	if (existing) return repo.find(existing)

	const targetTitle = (target.doc() as any)?.title
	const created = await repo.create2({
		title: "chat: " + (targetTitle || "document"),
		messages: [],
		docs: [],
		"@patchwork": {type: "chitterchatter"},
		// Auto-invite the computer (ChatRoot's onMount claims the host when
		// hasComputer is set) — but it stays off nosey, so it only replies when
		// @mentioned or replied to.
		hasComputer: true,
	} as any)
	// Resolve through find so a draft forks the new doc into this draft's clones.
	const chat = await repo.find(created.url)
	target.change((d: any) => {
		if (!d["@patchwork"]) d["@patchwork"] = {}
		d["@patchwork"].chitchat = chat.url
	})
	return chat as DocHandle<ChatDoc>
}

function ContextHost(props: {element: HTMLElement; repo: Repo}) {
	const targetUrl = selectedDocUrl(props.element)
	const [chatHandle, setChatHandle] = createSignal<DocHandle<ChatDoc> | null>(
		null
	)
	let ensuringFor: string | null = null

	createEffect(() => {
		const url = targetUrl()
		if (!url) {
			ensuringFor = null
			setChatHandle(null)
			return
		}
		if (ensuringFor === url) return
		ensuringFor = url
		setChatHandle(null)
		ensureChitchat(props.repo, url)
			.then((h) => {
				// Ignore if the selection moved on while we were resolving.
				if (targetUrl() === url) setChatHandle(h)
			})
			.catch((e) => console.warn("[chitterchatter:context] ensureChitchat", e))
	})

	return (
		<Show
			when={chatHandle()}
			keyed
			fallback={
				<div class="chat-context-empty">
					{targetUrl()
						? "Loading chat…"
						: "Select a document to chat about it."}
				</div>
			}>
			{(handle) => (
				<ChatRoot
					handle={handle}
					element={props.element}
					mode="context"
					targetDocUrl={targetUrl}
				/>
			)}
		</Show>
	)
}

/** patchwork:component render: `(element) => cleanup`. */
export function ChatContextComponent(element: HTMLElement) {
	const repo: Repo = (element as any).repo || (window as any).repo
	setRepo(repo)

	if (getComputedStyle(element).position === "static") {
		element.style.position = "relative"
	}

	const dispose = render(
		() => <ContextHost element={element} repo={repo} />,
		element
	)
	return () => dispose()
}
