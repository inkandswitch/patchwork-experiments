/**
 * chat-call — the `call` bundle's contribution to the base `chat` tool.
 *
 * The base chat tool used to hardcode the call button, the `/call` command, and
 * the transcript-into-assistant-context logic behind `hasFeature("call")`. That
 * all lives here now: a `chat:feature` plugin (button + LLM context) plus a
 * `chat:slash` plugin (`/call`), both discovered through the shared registry.
 *
 * Slot renderers and the slash `run` receive the base's explicit SlotContext as
 * an argument (never `useContext` — context identity differs across bundles).
 * The renderer returns a plain DOM node, which the base's Solid <Slot> host
 * inserts as-is; CSS classes come from the base's always-present chat.css.
 */

const PHONE_SVG =
	'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'

// Find (or lazily create) the `call` doc linked to this chat, then pin the
// telephone tool on it. Stores the url as `callUrl` on the chat doc so everyone
// in the room joins the same call and the transcript can be found later.
async function launchCall(ctx) {
	const {repo, handle} = ctx.chat
	if (!repo) return
	const d = handle.doc()
	let callUrl = d && d.callUrl
	if (!callUrl) {
		const title = ((d && d.title) || "Chat") + " Call"
		const callHandle = await repo.create2({title, content: ""})
		callUrl = callHandle.url
		handle.change((dd) => {
			dd.callUrl = callUrl
		})
	}
	ctx.base.pinDoc(callUrl, "telephone", ((d && d.title) || "Chat") + " Call")
}

// Pin the running call's live transcript (the `teleprint` tool on the call doc).
function pinTranscript(ctx) {
	const d = ctx.chat.handle.doc()
	if (d && d.callUrl) ctx.base.pinDoc(d.callUrl, "teleprint", "Teleprint")
}

// The presence-bar call button. Plain DOM (no Solid) — event wiring via onclick,
// which works on manually-created nodes where Solid's delegation would not.
function renderCallButton(ctx) {
	const btn = document.createElement("button")
	btn.className = "chat-theme-btn"
	btn.title = "Call"
	btn.innerHTML = PHONE_SVG
	btn.onclick = () => {
		void launchCall(ctx)
	}
	return btn
}

// Fold the call's transcript into the assistant's context. Invoked by the base's
// feature-agnostic `buildContext` seam during LLM context assembly.
async function buildContext({repo, doc}) {
	if (!doc || !doc.callUrl) return null
	try {
		const ch = await repo.find(doc.callUrl)
		const cd = ch.doc()
		if (cd && typeof cd.content === "string" && cd.content.length > 0) {
			return "Call transcript (last 4000 chars):\n" + cd.content.slice(-4000)
		}
	} catch {}
	return null
}

// `chat:feature` module: the presence-bar button plus the transcript context.
export function callFeature() {
	return {
		slots: {
			"presence-bar-actions": (ctx) => renderCallButton(ctx),
		},
		buildContext,
	}
}

// `chat:slash` module: `/call` starts/joins the call, `/call transcript` pins it.
export function callSlashRun(ctx, argText) {
	if ((argText || "").trim().toLowerCase() === "transcript") {
		pinTranscript(ctx)
		return
	}
	void launchCall(ctx)
}
