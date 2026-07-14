import {For, Show, createSignal} from "solid-js"
import {isImmutableString} from "@automerge/automerge-repo"

export type DocPickSelection = {kind: "value"; path: string[]; value: unknown}

/**
 * Shown when a dropped Patchwork doc isn't a plain file doc: renders the
 * document structure as an outline so the user can pick which value to use
 * as conversion input (e.g. a bytes field holding a recording).
 */
export function DocPicker(props: {
	title: string
	doc: unknown
	onPick: (selection: DocPickSelection) => void
	onCancel: () => void
}) {
	return (
		<div class="ffmpeg-modal-backdrop" onClick={() => props.onCancel()}>
			<div class="ffmpeg-modal" onClick={e => e.stopPropagation()}>
				<div class="ffmpeg-modal-header">
					<div>
						<h3>{props.title}</h3>
						<p>
							This document isn't a plain file. Pick the value to use as
							input (e.g. a field holding media bytes).
						</p>
					</div>
					<button class="ffmpeg-modal-close" onClick={() => props.onCancel()}>
						×
					</button>
				</div>
				<div class="ffmpeg-modal-body">
					<DocTree
						value={props.doc}
						path={[]}
						depth={0}
						onPick={(path, value) => props.onPick({kind: "value", path, value})}
					/>
				</div>
				<div class="ffmpeg-modal-footer">
					<button class="ffmpeg-btn" onClick={() => props.onCancel()}>
						Cancel
					</button>
				</div>
			</div>
		</div>
	)
}

const MAX_CHILDREN = 100

function isPickableLeaf(value: unknown): boolean {
	return (
		typeof value === "string" ||
		value instanceof Uint8Array ||
		(value != null && typeof value === "object" && isImmutableString(value))
	)
}

function previewOf(value: unknown): string {
	if (typeof value === "string" || (value != null && typeof value === "object" && isImmutableString(value))) {
		const s = String(value).replace(/\s+/g, " ").trim()
		return s.length > 80 ? `${s.slice(0, 80)}…` : s
	}
	if (value instanceof Uint8Array) return `${value.byteLength} bytes`
	if (value === null) return "null"
	if (typeof value !== "object") return String(value)
	if (Array.isArray(value)) return `[${value.length}]`
	return `{${Object.keys(value).length}}`
}

function DocTree(props: {
	value: unknown
	path: string[]
	depth: number
	onPick: (path: string[], value: unknown) => void
}) {
	const entries = (): [string, unknown][] => {
		const v = props.value
		if (v == null || typeof v !== "object" || v instanceof Uint8Array) return []
		if (isImmutableString(v)) return []
		if (Array.isArray(v)) {
			return v.slice(0, MAX_CHILDREN).map((item, i) => [String(i), item])
		}
		return Object.entries(v as Record<string, unknown>)
			.filter(([key]) => key !== "@patchwork")
			.slice(0, MAX_CHILDREN)
	}

	return (
		<ul class="ffmpeg-tree">
			<For each={entries()}>
				{([name, value]) => (
					<TreeNode
						name={name}
						value={value}
						parentPath={props.path}
						depth={props.depth}
						onPick={props.onPick}
					/>
				)}
			</For>
		</ul>
	)
}

function TreeNode(props: {
	name: string
	value: unknown
	parentPath: string[]
	depth: number
	onPick: (path: string[], value: unknown) => void
}) {
	const path = () => [...props.parentPath, props.name]
	const isBranch = () =>
		props.value != null &&
		typeof props.value === "object" &&
		!(props.value instanceof Uint8Array) &&
		!isImmutableString(props.value)
	const pickable = () => isPickableLeaf(props.value)
	const [open, setOpen] = createSignal(props.depth < 1)

	return (
		<li>
			<div
				class="ffmpeg-tree-row"
				classList={{pickable: pickable()}}
				onClick={() => {
					if (pickable()) props.onPick(path(), props.value)
					else if (isBranch()) setOpen(o => !o)
				}}
			>
				<span class="twisty">
					{isBranch() ? (open() ? "▾" : "▸") : ""}
				</span>
				<span class="key">{props.name}</span>
				<span class="preview">{previewOf(props.value)}</span>
				<Show when={pickable()}>
					<span class="use">Use</span>
				</Show>
			</div>
			<Show when={isBranch() && open()}>
				<DocTree
					value={props.value}
					path={path()}
					depth={props.depth + 1}
					onPick={props.onPick}
				/>
			</Show>
		</li>
	)
}
