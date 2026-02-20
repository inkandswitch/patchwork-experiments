import {createResource, type Resource} from "solid-js"

// Global caches - shared across all components
const blobUrlCache = new Map<string, string>()

// Fetcher for blob URLs - returns a memoized promise
export async function fetchBlobUrl(url: string): Promise<string | null> {
	if (blobUrlCache.has(url)) return blobUrlCache.get(url)!
	const repo = (window as any).repo
	if (!repo) return null
	try {
		const handle = await repo.find(url)
		const doc = handle.doc()
		if (doc?.content) {
			const bytes = doc.content instanceof Uint8Array ? doc.content : new Uint8Array(doc.content)
			const blobOpts = doc.mimeType ? {type: doc.mimeType} : {}
			const blobUrl = URL.createObjectURL(new Blob([bytes], blobOpts))
			blobUrlCache.set(url, blobUrl)
			return blobUrl
		}
	} catch (e) {
		console.warn("[resources] blob fetch failed:", url, e)
	}
	return null
}

// Fetcher for audio URLs from recording docs
async function fetchAudioUrl(recordingUrl: string): Promise<string | null> {
	const repo = (window as any).repo
	if (!repo) return null
	try {
		const recordingHandle = await repo.find(recordingUrl)
		const recordingDoc = recordingHandle.doc()
		if (!recordingDoc?.audio) return null
		const audioHandle = await repo.find(recordingDoc.audio)
		const audioDoc = audioHandle.doc()
		if (audioDoc?.content) {
			const bytes = audioDoc.content instanceof Uint8Array ? audioDoc.content : new Uint8Array(audioDoc.content)
			return URL.createObjectURL(new Blob([bytes], {type: "audio/webm;codecs=opus"}))
		}
	} catch (e) {
		console.warn("[resources] audio fetch failed:", recordingUrl, e)
	}
	return null
}


/**
 * Creates a resource for loading a blob URL.
 * The source is reactive - when it changes, the resource refetches.
 */
export function useBlobUrl(source: () => string | null | undefined): Resource<string | null> {
	const [resource] = createResource(source, fetchBlobUrl)
	return resource
}

/**
 * Creates a resource for loading an audio URL from a recording doc.
 */
export function useAudioUrl(source: () => string | null | undefined): Resource<string | null> {
	const [resource] = createResource(source, fetchAudioUrl)
	return resource
}

// Export cache getters for components that need synchronous access
export function getCachedBlobUrl(url: string): string | undefined {
	return blobUrlCache.get(url)
}

// Pre-warm the blob cache (for emoticons that should load early)
export function prefetchBlobUrl(url: string): void {
	if (!blobUrlCache.has(url)) {
		fetchBlobUrl(url)
	}
}
