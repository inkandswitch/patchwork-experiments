// Helpers for turning a dropped Patchwork document into a usable OpenSCAD
// import: a valid, unique identifier, plus a plain-JSON view of its content.

/** Turn an arbitrary label into a valid OpenSCAD identifier. */
export function sanitizeIdentifier(raw: string | undefined): string {
	let name = (raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
	if (!name) name = "data"
	if (/^[0-9]/.test(name)) name = `_${name}`
	return name
}

/** Append a numeric suffix until `name` doesn't collide with `existing`. */
export function uniqueIdentifier(name: string, existing: Iterable<string>): string {
	const taken = new Set(existing)
	if (!taken.has(name)) return name
	let i = 2
	while (taken.has(`${name}_${i}`)) i++
	return `${name}_${i}`
}

/**
 * Reduce an Automerge doc's plain-object snapshot to something worth handing
 * to OpenSCAD as JSON: drop Patchwork's own bookkeeping keys (anything
 * starting with "@") and anything that doesn't survive JSON.stringify
 * (functions, Automerge Text/Counter proxies without a toJSON, etc).
 */
export function docToJson(doc: unknown): unknown {
	if (doc === null || typeof doc !== "object") return doc ?? null
	if (Array.isArray(doc)) return doc.map(docToJson)
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
		if (key.startsWith("@")) continue
		out[key] = docToJson(value)
	}
	return out
}

export function docToJsonString(doc: unknown): string {
	try {
		return JSON.stringify(docToJson(doc) ?? {})
	} catch {
		return "{}"
	}
}
