import {createContext, useContext, createSignal, createEffect, onCleanup, type ParentComponent, type Accessor, type Resource} from "solid-js"
import type {DocHandle, Repo, Doc} from "@automerge/automerge-repo"
import type {ChatDoc} from "../types"

interface ChatContextValue {
	handle: DocHandle<ChatDoc>
	doc: Accessor<Doc<ChatDoc> | undefined>
	repo: Repo
	element: HTMLElement
	chatUrl: string
}

const ChatCtx = createContext<ChatContextValue>()

export const ChatProvider: ParentComponent<{
	handle: DocHandle<ChatDoc>
	element: HTMLElement
}> = (props) => {
	const repo = (props.element as any).repo as Repo

	// Manual doc signal — subscribes directly to handle changes.
	// This is more reliable than useDocument on reload since it doesn't
	// depend on the repo re-finding the handle.
	const [doc, setDoc] = createSignal<Doc<ChatDoc> | undefined>(props.handle.doc() as Doc<ChatDoc> | undefined)

	const onChange = () => {
		const d = props.handle.doc() as Doc<ChatDoc> | undefined
		if (d) setDoc(() => d)
	}

	// If doc wasn't ready synchronously, wait for it
	if (!doc()) {
		repo.find(props.handle.url).then((h: DocHandle<ChatDoc>) => {
			const d = h.doc() as Doc<ChatDoc> | undefined
			if (d) setDoc(() => d)
		}).catch(() => {})
	}

	props.handle.on("change", onChange)
	onCleanup(() => props.handle.off("change", onChange))

	return (
		<ChatCtx.Provider
			value={{
				handle: props.handle,
				doc,
				repo,
				element: props.element,
				chatUrl: props.handle.url,
			}}
		>
			{props.children}
		</ChatCtx.Provider>
	)
}

export function useChat(): ChatContextValue {
	const ctx = useContext(ChatCtx)
	if (!ctx) throw new Error("useChat must be used within ChatProvider")
	return ctx
}
