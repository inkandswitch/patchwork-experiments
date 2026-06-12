import type {AutomergeUrl, Repo} from "@automerge/automerge-repo"
import {isImmutableString} from "@automerge/automerge-repo"
import type {LoadedInput} from "./ffmpeg/convert"
import type {FileDocShape, FfmpegInput} from "./types"

function asContent(value: unknown): string | Uint8Array | null {
	if (typeof value === "string") return value
	if (value instanceof Uint8Array) return value
	if (value != null && isImmutableString(value)) return value.toString()
	return null
}

/** True if the doc looks like a file doc whose content can be used directly. */
export function isFileLikeDoc(doc: FileDocShape | undefined): boolean {
	return doc != null && asContent(doc.content) !== null
}

function valueAtPath(doc: unknown, path: string[]): unknown {
	let value: unknown = doc
	for (const key of path) {
		if (value == null || typeof value !== "object") return undefined
		value = (value as Record<string, unknown>)[key]
	}
	return value
}

/** Load the contents of all input docs so they can be handed to ffmpeg. */
export async function loadInputContents(
	repo: Repo,
	inputs: FfmpegInput[]
): Promise<LoadedInput[]> {
	return Promise.all(
		inputs.map(async input => {
			const handle = await repo.find<FileDocShape>(input.url)
			const doc = handle.doc()
			const value = input.path
				? valueAtPath(doc, [...input.path])
				: doc?.content
			const content = asContent(value)
			if (content === null) {
				throw new Error(`"${input.name}" has no usable content`)
			}
			return {name: input.name, content}
		})
	)
}

/** Create a Patchwork file doc from an uploaded OS file. */
export async function createFileDoc(
	repo: Repo,
	file: File,
	name: string
): Promise<AutomergeUrl> {
	const mimeType = file.type || "application/octet-stream"
	const content = new Uint8Array(await file.arrayBuffer())
	const base = name.split("/").pop() || name
	const i = base.lastIndexOf(".")
	const handle = repo.create<FileDocShape>({
		"@patchwork": {type: "file"},
		name: base,
		extension: i > 0 ? base.slice(i + 1) : "",
		mimeType,
		content,
	})
	return handle.url
}

/** Derive an ffmpeg-friendly file name for an existing Patchwork doc. */
export async function resolveDocName(
	repo: Repo,
	url: AutomergeUrl,
	hint?: string
): Promise<string> {
	try {
		const handle = await repo.find<FileDocShape>(url)
		const doc = handle.doc()
		const name = doc?.name || doc?.title || hint || "media"
		if (/\.[A-Za-z0-9]+$/.test(name)) return name
		// no extension: guess one so ffmpeg and kind detection have a chance
		const ext = doc?.extension
			? String(doc.extension).replace(/^\./, "")
			: guessExtensionForValue(doc?.content, doc ?? undefined)
		return `${name}.${ext}`
	} catch {
		return hint || "media"
	}
}

/** Guess a file extension for a value picked out of a doc. */
export function guessExtensionForValue(
	value: unknown,
	doc?: FileDocShape
): string {
	if (value instanceof Uint8Array || (value != null && typeof value === "object" && !isImmutableString(value))) {
		const sub = doc?.mimeType?.split("/")[1]?.replace(/[^a-z0-9]/gi, "")
		return sub || "bin"
	}
	const text =
		typeof value === "string"
			? value
			: value != null && isImmutableString(value)
				? value.toString()
				: ""
	if (/^\s*<svg[\s>]/i.test(text)) return "svg"
	return "txt"
}

export type DroppedFile = {file: File; path: string}

/**
 * Collect files from a drop event, traversing directories. Paths of files
 * inside a dropped folder are relative to that folder.
 */
export async function collectDroppedFiles(dt: DataTransfer): Promise<DroppedFile[]> {
	const out: DroppedFile[] = []
	const entries: {entry: FileSystemEntry | null; file: File | null}[] = []

	for (const item of Array.from(dt.items)) {
		if (item.kind !== "file") continue
		entries.push({
			entry: item.webkitGetAsEntry?.() ?? null,
			file: item.getAsFile(),
		})
	}

	for (const {entry, file} of entries) {
		if (entry?.isDirectory) {
			await traverseDirectory(entry as FileSystemDirectoryEntry, "", out)
		} else if (entry?.isFile) {
			const f = await entryFile(entry as FileSystemFileEntry)
			out.push({file: f, path: f.name})
		} else if (file) {
			out.push({file, path: file.name})
		}
	}
	return out
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
	return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function traverseDirectory(
	dir: FileSystemDirectoryEntry,
	prefix: string,
	out: DroppedFile[]
): Promise<void> {
	const reader = dir.createReader()
	for (;;) {
		const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
			reader.readEntries(resolve, reject)
		)
		if (batch.length === 0) break
		for (const entry of batch) {
			if (entry.isFile) {
				const f = await entryFile(entry as FileSystemFileEntry)
				out.push({file: f, path: prefix + entry.name})
			} else if (entry.isDirectory) {
				await traverseDirectory(
					entry as FileSystemDirectoryEntry,
					`${prefix}${entry.name}/`,
					out
				)
			}
		}
	}
}

/**
 * Parse Patchwork doc URLs from a drag event. The sideboard (sidebar) sets
 * `text/x-patchwork-dnd` as `{source, items: [{id, url, name?, ...}]}`;
 * other tools set a plain array of items or a `text/x-patchwork-urls` array.
 */
export function parsePatchworkDrop(
	dt: DataTransfer
): {url: AutomergeUrl; name?: string}[] {
	const out: {url: AutomergeUrl; name?: string}[] = []

	const dndData = dt.getData("text/x-patchwork-dnd")
	if (dndData) {
		try {
			const parsed = JSON.parse(dndData)
			const items = Array.isArray(parsed)
				? parsed
				: Array.isArray(parsed?.items)
					? parsed.items
					: [parsed]
			for (const item of items) {
				if (item?.url) out.push({url: item.url, name: item.name})
			}
		} catch {
			// fall through to text/x-patchwork-urls
		}
	}

	if (out.length === 0) {
		const urlsData = dt.getData("text/x-patchwork-urls")
		if (urlsData) {
			try {
				const urls = JSON.parse(urlsData)
				if (Array.isArray(urls)) {
					for (const url of urls) if (url) out.push({url})
				}
			} catch {
				// ignore
			}
		}
	}

	return out
}

export function hasPatchworkDrop(dt: DataTransfer | null): boolean {
	return (
		!!dt?.types?.includes("text/x-patchwork-dnd") ||
		!!dt?.types?.includes("text/x-patchwork-urls")
	)
}

export function hasFileDrop(dt: DataTransfer | null): boolean {
	return !!dt?.types?.includes("Files")
}
