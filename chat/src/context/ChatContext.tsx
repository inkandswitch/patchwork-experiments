import {createContext, useContext, type ParentComponent, type Accessor, type Resource} from "solid-js"
import {useDocument} from "@automerge/automerge-repo-solid-primitives"
import type {DocHandle, Repo, Doc} from "@automerge/automerge-repo"
import type {ChatDoc} from "../types"

interface ChatContextValue {
	handle: DocHandle<ChatDoc>
	doc: Accessor<Doc<ChatDoc> | undefined>
	handleResource: Resource<DocHandle<ChatDoc> | undefined>
	repo: Repo
	element: HTMLElement
	chatUrl: string
}

const ChatCtx = createContext<ChatContextValue>()

export const ChatProvider: ParentComponent<{
	handle: DocHandle<ChatDoc>
	element: HTMLElement
}> = (props) => {
	const repo = (window as any).repo as Repo
	const [doc, handleResource] = useDocument<ChatDoc>(props.handle.url, {repo})

	return (
		<ChatCtx.Provider
			value={{
				handle: props.handle,
				doc,
				handleResource,
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
