import {onCleanup, onMount, type JSX} from "solid-js"
import {useRepo} from "@automerge/automerge-repo-solid-primitives"
import {accept, type SubscribeEvent} from "@inkandswitch/patchwork-providers"
import type {AutomergeUrl, DocHandle} from "@automerge/automerge-repo"
import type {PaperDoc, PaperLayerDoc} from "../types"
import type {Pointer, SurfacePointerState, SurfaceState} from "./types"

// Brokers every button/canvas interaction for the paper surface. It owns an
// ephemeral selection-state document, tracks the canvas pointer, and creates
// layers on demand, exposing all three over the patchwork provider protocol so
// the buttons never touch the paper document directly. Consumers find it purely
// by dispatching `patchwork:subscribe` from their own element — there is no
// Solid context wiring them together.
export function SurfaceProvider(props: {
	element: HTMLElement
	paper: DocHandle<PaperDoc>
	children: JSX.Element
}): JSX.Element {
	const repo = useRepo()
	const stateHandle = repo.create<SurfaceState>({selectedTool: ""})

	let pointer: Pointer | undefined
	const pointerListeners = new Set<(value: SurfacePointerState) => void>()
	const emitPointer = () => {
		for (const respond of pointerListeners) respond({pointer})
	}

	onMount(() => {
		const el = props.element

		const toLocal = (event: PointerEvent): Point2D => {
			const rect = el.getBoundingClientRect()
			return {x: event.clientX - rect.left, y: event.clientY - rect.top}
		}

		const onPointerDown = (event: PointerEvent) => {
			// A press that lands on chrome (the toolbar) must not start a draw.
			const onChrome = (event.target as HTMLElement | null)?.closest(
				"[data-surface-no-draw]"
			)
			const {x, y} = toLocal(event)
			pointer = {x, y, isPressed: !onChrome}
			emitPointer()
		}
		const onPointerMove = (event: PointerEvent) => {
			const {x, y} = toLocal(event)
			pointer = {x, y, isPressed: pointer?.isPressed ?? false}
			emitPointer()
		}
		// Listen for release on the window so a drag that ends off-canvas still
		// clears the pressed state.
		const onPointerUp = (event: PointerEvent) => {
			const {x, y} = toLocal(event)
			pointer = {x, y, isPressed: false}
			emitPointer()
		}

		const onSubscribe = (event: SubscribeEvent) => {
			const selector = event.detail?.selector
			if (!selector) return
			switch (selector.type) {
				case "surface:state":
					accept<AutomergeUrl>(event, (respond) => respond(stateHandle.url))
					break
				case "surface:layer": {
					const toolId = String(selector.toolId ?? "")
					accept<AutomergeUrl>(event, (respond) => {
						void ensureLayer(toolId).then((url) => {
							if (url) respond(url)
						})
					})
					break
				}
				case "surface:pointer":
					accept<SurfacePointerState>(event, (respond) => {
						pointerListeners.add(respond)
						respond({pointer})
						return () => pointerListeners.delete(respond)
					})
					break
				default:
					// Leave other selectors (patchwork:repo, patchwork:dochandle, ...)
					// to bubble up to the host's repo provider.
					return
			}
		}

		el.addEventListener("pointerdown", onPointerDown)
		el.addEventListener("pointermove", onPointerMove)
		window.addEventListener("pointerup", onPointerUp)
		el.addEventListener("patchwork:subscribe", onSubscribe)

		onCleanup(() => {
			el.removeEventListener("pointerdown", onPointerDown)
			el.removeEventListener("pointermove", onPointerMove)
			window.removeEventListener("pointerup", onPointerUp)
			el.removeEventListener("patchwork:subscribe", onSubscribe)
		})
	})

	// Resolve the layer for a tool, creating (and recording) it the first time
	// it is requested.
	async function ensureLayer(toolId: string): Promise<AutomergeUrl | undefined> {
		const existing = props.paper.doc()?.layers?.[toolId]
		if (existing) return existing
		const layer = repo.create<PaperLayerDoc>({
			"@patchwork": {type: "paper-layer"},
			title: toolId,
			shapes: [],
		})
		props.paper.change((doc) => {
			if (!doc.layers) doc.layers = {}
			doc.layers[toolId] = layer.url
		})
		return layer.url
	}

	return <>{props.children}</>
}

type Point2D = {x: number; y: number}
