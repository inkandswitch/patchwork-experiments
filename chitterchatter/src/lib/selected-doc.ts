// Minimal vanilla port of `@inkandswitch/patchwork-providers`'s `subscribe`,
// wrapped as a Solid accessor — so we don't have to add the providers-solid
// dependency (it isn't in the bootloader importmap and would be bundled anyway).
//
// It dispatches a `patchwork:subscribe` CustomEvent (from the nearest
// <patchwork-view>) carrying a MessagePort; the host's SelectedDocProvider
// answers by posting `{type:"change", value}` messages back over the port.
import {createSignal, onCleanup, type Accessor} from "solid-js"
import type {AutomergeUrl} from "@automerge/automerge-repo"

export type Selector = {type: string} & Record<string, unknown>

/** Subscribe to a provider selector; returns its latest value (or initial). */
export function subscribe<T>(
	element: HTMLElement,
	selector: Selector,
	initialValue: T
): Accessor<T> {
	const [value, setValue] = createSignal<T>(initialValue)

	const view = element.closest("patchwork-view")
	const dispatchEl = (view as HTMLElement) ?? element
	const channel = new MessageChannel()
	const port = channel.port2
	const controller = new AbortController()

	port.addEventListener(
		"message",
		(event: MessageEvent) => {
			if ((event.data as any)?.type === "change") {
				setValue(() => (event.data as any).value as T)
			}
		},
		{signal: controller.signal}
	)
	port.start()

	dispatchEl.dispatchEvent(
		new CustomEvent("patchwork:subscribe", {
			detail: {selector, port: channel.port1},
			bubbles: true,
			composed: true,
		})
	)

	onCleanup(() => {
		if (controller.signal.aborted) return
		controller.abort()
		try {
			port.postMessage({type: "unsubscribe"})
		} catch {}
		try {
			port.close()
		} catch {}
	})

	return value
}

/** The url of the document the user currently has selected (or undefined). */
export function selectedDocUrl(element: HTMLElement): Accessor<AutomergeUrl | undefined> {
	const urls = subscribe<AutomergeUrl[]>(
		element,
		{type: "patchwork:selected-doc"},
		[]
	)
	return () => urls()?.[0]
}
