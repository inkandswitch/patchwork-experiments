/**
 * Parse documents dropped in from the Patchwork sidebar (or any other tool that
 * follows the same convention). The sideboard sets `text/x-patchwork-dnd` as
 * `{ source, items: [{ id, url, type, name, source }] }` on drag start; other
 * sources may only set the simpler `text/x-patchwork-urls` array. See
 * `patchwork-base/sideboard/src/sideboard/dnd/`.
 *
 * Note: an item's `type` is the *datatype* id (e.g. "folder", "todo"), not a
 * tool id — only trust an explicit `toolId` field to pin the embed's tool.
 */

import type {AutomergeUrl} from "@automerge/automerge-repo"

export type PatchworkDropItem = {
	url: AutomergeUrl
	name?: string
	type?: string
	toolId?: string
}

const DND_MIME = "text/x-patchwork-dnd"
const URLS_MIME = "text/x-patchwork-urls"

export function hasPatchworkDrop(dt: DataTransfer | null): boolean {
	return !!dt?.types?.includes(DND_MIME) || !!dt?.types?.includes(URLS_MIME)
}

export function parsePatchworkDrop(dt: DataTransfer): PatchworkDropItem[] {
	const out: PatchworkDropItem[] = []

	const dndData = dt.getData(DND_MIME)
	if (dndData) {
		try {
			const parsed = JSON.parse(dndData)
			const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [parsed]
			for (const item of items) {
				if (item?.url) {
					out.push({url: item.url, name: item.name, type: item.type, toolId: item.toolId})
				}
			}
		} catch {
			// fall through to text/x-patchwork-urls
		}
	}

	if (out.length === 0) {
		const urlsData = dt.getData(URLS_MIME)
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
