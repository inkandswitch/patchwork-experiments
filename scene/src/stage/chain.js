// Who is offered an input event, in order (STAGE.md, "The input chain"). Pure:
// the router asks each in turn until one claims it.

/**
 * @param {{
 *   running: { id: string, meta: object, scope: "scene" | "objects" | "general" }[],  // running order
 *   armed?: string | null,          // the top of the arm stack
 *   widgetOwner?: string | null,    // the extension whose widget is under the pointer
 *   holders?: Map<string, string>,  // extension id → the nearest object in the hit chain carrying one of its traits
 * }} o
 * @returns {string[]} extension ids, each once, at its earliest step
 */
export function chainOrder({ running, armed = null, widgetOwner = null, holders = new Map() }) {
  const ids = new Set(running.map((r) => r.id));
  const out = [];
  const push = (id) => {
    if (id && ids.has(id) && !out.includes(id)) out.push(id);
  };
  push(armed);
  push(widgetOwner);
  for (const r of running) if (holders.has(r.id)) push(r.id);
  for (const r of running) if (r.scope === "scene") push(r.id);
  for (const r of running) if (r.scope === "general") push(r.id);
  return out;
}

/**
 * For each running extension with traits, the nearest object in the hit chain
 * (the hit object, what it's attached to, then its groups, nearest first)
 * that carries one of them.
 * @param {{ id: string, meta: object }[]} running
 * @param {string[]} hitChain  object ids, nearest first
 * @param {(id: string) => string[]} traitsOf  an object's trait keys
 * @returns {Map<string, string>} extension id → object id
 */
export function holdersFor(running, hitChain, traitsOf) {
  const out = new Map();
  if (!hitChain?.length) return out;
  for (const r of running) {
    const mine = Array.isArray(r.meta?.traits) ? r.meta.traits : [];
    if (!mine.length) continue;
    const oid = hitChain.find((id) => traitsOf(id).some((t) => mine.includes(t)));
    if (oid != null) out.set(r.id, oid);
  }
  return out;
}

/**
 * Offer an event down the chain: the first handler that returns something
 * truthy claims it. Returns { id, result } or null.
 * @param {string[]} order
 * @param {(id: string) => object | undefined} inputOf  an extension's `input` (or arm handlers)
 * @param {string} type  "press" | "click" | …
 * @param {object | ((id: string) => object)} ev  the event, or a function giving it per extension (to add `holder`)
 */
export function offer(order, inputOf, type, ev) {
  for (const id of order) {
    const fn = inputOf(id)?.[type];
    if (typeof fn !== "function") continue;
    let result;
    try {
      result = fn(typeof ev === "function" ? ev(id) : ev);
    } catch (err) {
      console.warn(`[scene] ${id}: input.${type} failed`, err);
      continue;
    }
    if (result) return { id, result };
  }
  return null;
}
