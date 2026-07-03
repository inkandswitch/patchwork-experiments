/**
 * Spawn a module Worker from a URL, with a blob fallback.
 *
 * When this library is consumed as an `automerge:` dependency its worker files
 * are served from a service-worker URL, and `new Worker(swUrl, {type:"module"})`
 * can fail to load as a module in some browsers. So we fetch the script text and
 * run it from a blob URL instead (the workers here only import absolute CDN
 * URLs, so they don't need their original base). If the fetch fails (e.g. an
 * opaque cross-origin URL) we fall back to constructing the Worker directly.
 *
 * @param {URL|string} url
 * @returns {Promise<Worker>}
 */
export async function spawnWorker(url) {
	try {
		const res = await fetch(url)
		const src = await res.text()
		const blob = new Blob([src], {type: "application/javascript"})
		return new Worker(URL.createObjectURL(blob), {type: "module"})
	} catch (err) {
		console.warn("[transcript] blob worker failed, trying direct URL:", err)
		return new Worker(url, {type: "module"})
	}
}
