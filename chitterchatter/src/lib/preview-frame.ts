// Draft-aware preview iframes for the in-chat toolmaking flow.
//
// When the chat is open on a draft (a copy-on-write branch — see the drafts
// plugin in patchwork-base), tool source edits land in per-draft *clones*, not
// the originals. A normal preview iframe (`/#doc=…&frame=…`) boots a fresh host
// runtime with no draft overlay, so it resolves the originals and shows Main's
// source. To preview drafted source we self-bootstrap the iframe: fetch the
// host page, wrap its `#root` view in the draft overlay provider pointed at the
// active draft, and inject the routing hash. The iframe then forks the tool
// folder + source into the same draft clones the chat is editing.

const OVERLAY_PROVIDER_SELECTOR =
	'patchwork-view[component="patchwork-draft-overlay-provider"]'

/**
 * The automerge URL of the draft the chat is currently scoped to, or "" for
 * Main. Read straight off the overlay provider the frame mounts as an ancestor
 * of the tool — no extra dependency or subscription needed. Returns "" if the
 * host has no drafts overlay (drafts plugin absent) so callers fall back to the
 * plain preview path.
 */
export function getActiveDraftUrl(element: HTMLElement): string {
	const provider = element.closest(OVERLAY_PROVIDER_SELECTOR)
	return provider?.getAttribute("url")?.trim() || ""
}

function docIdFromUrl(url: string): string {
	return url.replace(/^automerge:/, "")
}

/** The plain (Main) preview URL — unchanged from the original behaviour. */
export function buildPreviewSrc(dl: {
	url: string
	name?: string
	type?: string
	pin?: unknown
}): string {
	const params = new URLSearchParams()
	params.set("doc", docIdFromUrl(dl.url))
	if (dl.name) params.set("title", dl.name)
	if (dl.type) params.set("type", dl.type)
	if (typeof dl.pin === "string" && dl.pin) params.set("frame", dl.pin)
	return "/#" + params.toString()
}

/**
 * Build a self-bootstrapping preview document that boots the host runtime with
 * the draft overlay mounted around `#root`. Returns an HTML string for
 * `iframe.srcdoc`. Fetches the live host page so the script/entry and asset
 * URLs are exactly what the site serves (works in both dev and prod).
 */
export async function buildPreviewSrcdoc(
	dl: {url: string; name?: string; type?: string; pin?: unknown},
	draftUrl: string
): Promise<string> {
	const html = await fetch("/", {cache: "no-store"}).then((r) => r.text())
	const parsed = new DOMParser().parseFromString(html, "text/html")
	const root = parsed.getElementById("root")
	if (!root) throw new Error("[Chat] host page has no #root to wrap")

	// A srcdoc document's location is about:srcdoc (origin "null"), which is an
	// invalid base for URL resolution. Pin an explicit <base> at the host origin
	// so relative/service-worker URLs (module loading) resolve correctly.
	const base = parsed.createElement("base")
	base.setAttribute("href", location.origin + "/")
	parsed.head.prepend(base)

	// Wrap the root view in the draft overlay provider so the previewed doc and
	// its tool source resolve to this draft's clones.
	const overlay = parsed.createElement("patchwork-view")
	overlay.setAttribute("component", "patchwork-draft-overlay-provider")
	overlay.setAttribute("url", draftUrl)
	root.replaceWith(overlay)
	overlay.appendChild(root)

	// Before the deferred module entry runs (classic inline scripts execute
	// during parse, ahead of modules), do two things:
	//  1. Share this tab's repo + keyhive with the preview by setting them on its
	//     window. The bootloader reuses an existing window.repo instead of making
	//     a fresh one, so the preview resolves the same documents we see — incl.
	//     the draft's clones, which live in this tab's repo and a separate
	//     realm-local repo couldn't reach.
	//  2. Set the routing hash so primeRootElement points #root at our doc+tool.
	const params = new URLSearchParams()
	params.set("doc", docIdFromUrl(dl.url))
	if (dl.name) params.set("title", dl.name)
	if (dl.type) params.set("type", dl.type)
	if (typeof dl.pin === "string" && dl.pin) params.set("frame", dl.pin)
	const bootScript = parsed.createElement("script")
	bootScript.textContent =
		"try{window.repo=parent.repo;window.hive=parent.hive;}catch(e){}" +
		"location.hash=" +
		JSON.stringify(params.toString())
	parsed.body.prepend(bootScript)

	return "<!doctype html>\n" + parsed.documentElement.outerHTML
}

/** Reload a preview iframe, handling both `src` and `srcdoc` modes. */
export function reloadPreviewIframe(iframe: HTMLIFrameElement): void {
	try {
		iframe.contentWindow?.location.reload()
		return
	} catch {
		// Cross-origin or detached — fall back to re-assigning the source.
	}
	try {
		if (iframe.srcdoc) iframe.srcdoc = iframe.srcdoc
		else iframe.src = iframe.src
	} catch {}
}
