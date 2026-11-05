// Keeps the editor's imported docs resolved and live. Each doc in
// `doc.imports` is found through the repo once, subscribed to, and bound as
// JSON on every render. Two things the editor needs from it:
//
// - settled(): the first render waits until every import has either arrived
//   or failed once, so it doesn't bind `{}`, flash an error and render twice;
// - retries: a failed find is retried with backoff for as long as the import
//   is wanted, and onChange fires when it finally arrives (and on every later
//   change to it), so the editor re-renders.

import type {AutomergeUrl} from "@automerge/automerge-repo"
import type {OpenscadImport} from "./types"
import type {RenderImportInput} from "./render/engine"
import {docToJsonString} from "./imports"

// Loosely typed: handles come from `element.repo.find()`, and the host app's
// automerge-repo copy doesn't always unify structurally with this package's.
export type ImportHandle = {
	doc(): unknown
	on(event: "change", listener: () => void): unknown
	off(event: "change", listener: () => void): unknown
}

export type ImportResolverOptions = {
	find(url: AutomergeUrl): Promise<ImportHandle>
	/** an import arrived, or a resolved one changed */
	onChange(): void
	/** delay before retry number `attempt` (1-based) after a failed find */
	retryDelay?(attempt: number): number
	onError?(url: AutomergeUrl, err: unknown, attempt: number): void
}

/** 1 s, 2 s, 4 s, … capped at 30 s. */
export function defaultRetryDelay(attempt: number): number {
	return Math.min(1000 * 2 ** (attempt - 1), 30_000)
}

type Entry = {
	handle: ImportHandle | null
	/** resolves once the first find has succeeded or failed */
	settled: Promise<void>
	isSettled: boolean
	markSettled: () => void
	attempt: number
	timer: ReturnType<typeof setTimeout> | undefined
	dropped: boolean
}

export function createImportResolver(opts: ImportResolverOptions) {
	const retryDelay = opts.retryDelay ?? defaultRetryDelay
	const entries = new Map<AutomergeUrl, Entry>()
	const onDocChange = () => opts.onChange()

	function attempt(url: AutomergeUrl, entry: Entry) {
		entry.timer = undefined
		entry.attempt++
		let found: Promise<ImportHandle>
		try {
			found = Promise.resolve(opts.find(url))
		} catch (err) {
			found = Promise.reject(err)
		}
		found.then(
			handle => {
				if (entry.dropped) return
				entry.handle = handle
				handle.on("change", onDocChange)
				entry.markSettled()
				opts.onChange()
			},
			err => {
				if (entry.dropped) return
				opts.onError?.(url, err, entry.attempt)
				// Not a change: a render waiting in settled() goes ahead with
				// {} for this import, and the retry calls onChange on arrival.
				entry.markSettled()
				entry.timer = setTimeout(() => attempt(url, entry), retryDelay(entry.attempt))
			},
		)
	}

	function drop(url: AutomergeUrl, entry: Entry) {
		entry.dropped = true
		if (entry.timer) clearTimeout(entry.timer)
		entry.handle?.off("change", onDocChange)
		entry.markSettled()
		entries.delete(url)
	}

	return {
		/** Match the set of resolved docs to `imports`: start new ones, drop removed ones. */
		sync(imports: readonly Pick<OpenscadImport, "docUrl">[]) {
			const wanted = new Set(imports.map(imp => imp.docUrl).filter(Boolean))
			for (const [url, entry] of entries) if (!wanted.has(url)) drop(url, entry)
			for (const url of wanted) {
				if (entries.has(url)) continue
				let resolve!: () => void
				const settled = new Promise<void>(r => (resolve = r))
				const entry: Entry = {
					handle: null,
					settled,
					isSettled: false,
					markSettled: () => {
						entry.isSettled = true
						resolve()
					},
					attempt: 0,
					timer: undefined,
					dropped: false,
				}
				entries.set(url, entry)
				attempt(url, entry)
			}
		},

		/**
		 * Resolves once every current import has arrived or failed at least
		 * once, or after `timeoutMs`, whichever is first.
		 */
		settled(timeoutMs = 5000): Promise<void> {
			const all = Promise.all([...entries.values()].map(e => e.settled)).then(() => {})
			if (!Number.isFinite(timeoutMs)) return all
			let timer: ReturnType<typeof setTimeout> | undefined
			const timeout = new Promise<void>(resolve => (timer = setTimeout(resolve, timeoutMs)))
			return Promise.race([all, timeout]).finally(() => clearTimeout(timer))
		},

		/** True while some import's first find is still outstanding. */
		pending(): boolean {
			for (const entry of entries.values()) if (!entry.isSettled) return true
			return false
		},

		/** The JSON each import binds right now; one that hasn't arrived binds `{}`. */
		payload(imports: readonly OpenscadImport[]): RenderImportInput[] {
			return imports.map(imp => ({
				name: imp.name,
				json: docToJsonString(entries.get(imp.docUrl)?.handle?.doc()),
			}))
		},

		dispose() {
			for (const [url, entry] of entries) drop(url, entry)
		},
	}
}
