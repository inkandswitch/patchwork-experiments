import {For, Show, createSignal} from "solid-js"
import {isImmutableString} from "@automerge/automerge-repo"

export type DocPickSelection =
	| {kind: "value"; path: string[]; value: unknown}
	| {kind: "whole"}

/**
 * Shown when a dropped Patchwork doc isn't a plain file doc: renders the
 * document structure as an outline so the user can pick which value to use
 * as conversion input (e.g. a `content` string field).
 */
export function DocPicker(props: {
	title: string
	doc: unknown
	onPick: (selection: DocPickSelection) => void
	onCancel: () => void
}) {
	return (
		<div class="pandoc-modal-backdrop" onClick={() => props.onCancel()}>
			<div class="pandoc-modal" onClick={e => e.stopPropagation()}>
				<div class="pandoc-modal-header">
					<div>
						<h3>{props.title}</h3>
						<p>
							This document isn't a plain file. Pick the value to use as
							input, or use the whole document as JSON.
						</p>
					</div>
					<button class="pandoc-modal-close" onClick={() => props.onCancel()}>
						×
					</button>
				</div>
				<div class="pandoc-modal-body">
					<DocTree
						value={props.doc}
						path={[]}
						depth={0}
						onPick={(path, value) => props.onPick({kind: "value", path, value})}
					/>
				</div>
				<div class="pandoc-modal-footer">
					<button class="pandoc-btn" onClick={() => props.onCancel()}>
						Cancel
					</button>
					<button
						class="pandoc-btn primary"
						onClick={() => props.onPick({kind: "whole"})}
					>
						Use whole document as JSON
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
		<ul class="pandoc-tree">
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
				class="pandoc-tree-row"
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
