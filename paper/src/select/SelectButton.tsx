import {createSignal, type JSX} from "solid-js"
import {subscribeDoc} from "@inkandswitch/patchwork-providers-solid"
import type {SurfaceState} from "../surface/types"

// Toggles the surface into select mode. Like the other tool buttons it touches
// nothing but `surface:state`; the actual selecting/deleting lives in
// SelectionOverlay, which reacts to the same `selectedTool` value.
export function SelectButton(): JSX.Element {
	let root!: HTMLButtonElement

	const [state, stateHandle] = subscribeDoc<SurfaceState>(() => root, {
		type: "surface:state",
	})
	const active = () => state()?.selectedTool === "select"
	const [hovered, setHovered] = createSignal(false)

	const toggle = () => {
		stateHandle()?.change((doc) => {
			doc.selectedTool = doc.selectedTool === "select" ? "" : "select"
		})
	}

	const buttonStyle = (): JSX.CSSProperties => ({
		display: "flex",
		"align-items": "center",
		"justify-content": "center",
		width: "34px",
		height: "34px",
		padding: "0",
		border: `1px solid ${active() ? "#1c1917" : "rgba(28, 25, 23, 0.1)"}`,
		"border-radius": "10px",
		background: active() ? "#1c1917" : hovered() ? "#ffffff" : "rgba(255, 255, 255, 0.9)",
		"box-shadow": "0 1px 3px rgba(28, 25, 23, 0.18)",
		"backdrop-filter": "blur(6px)",
		color: active() ? "#fafaf9" : "#44403c",
		cursor: "pointer",
		"pointer-events": "auto",
		transition: "background 0.12s ease, color 0.12s ease, border-color 0.12s ease",
	})

	return (
		<button
			ref={root}
			type="button"
			style={buttonStyle()}
			title="Select"
			aria-label="Select"
			aria-pressed={active()}
			data-surface-no-draw
			onClick={toggle}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
		>
			<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
				<path
					d="M4 3 L4 16 L8 12.5 L10.5 17 L12.5 16 L10 11.5 L15 11.5 Z"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	)
}
