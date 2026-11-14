// Links (COMPOSITION.md §1, §7): an ordinary object whose source is a scene
// doc places that doc, a world of its own, in the host. Expanding a view's
// links is one pure function of the link graph, so what a view opens is
// fixed by the graph and never by the order docs arrived in (invariant I3).
//
//   expand(root, docOf) → [{ path, url, heads, deps, role, reason?, depth, parent, link }]
//
// - `path` is the links that lead to the occurrence (ids, outermost first);
//   the root's is [].
// - A link with no `at` names an identity (live); one with `at.heads` a
//   value (pinned). Inside a pin every link is pinned too: at its own `at`,
//   else at the heads the pin's `deps` hold for its url ("a pin is whole");
//   a url missing there is closed "unpinned". A pinned occurrence carries the
//   deps it is held by (`deps`), the heads of the docs reached through it.
// - No identity repeats on a path: a live url already live on its path, or a
//   pinned (url, heads) already on it, is closed "cycle". A pin of an older
//   version of a doc is a different identity, so a doc may hold its own past.
// - A live doc acts at one occurrence per view: the first in path order
//   (shallowest, then the smallest link id where two paths first differ).
//   Every other live occurrence of it is a mirror.
// - A doc the view can't open (docOf says null) is closed "unavailable". One
//   that hasn't arrived (undefined) is open, with nothing under it yet.
// - Closed reasons are exactly "unavailable", "cycle" and "unpinned".
// - The budget is the view's: at most `budget` occurrences are opened,
//   nearest first; expansion terminates without it (paths can't repeat an
//   identity, and there are finitely many), but a diamond of pins is
//   exponential in paths.

/** The scene:source id a link's object names. */
export const LINK = "scene.link";

/** The closed reasons, exactly. */
export const CLOSED = Object.freeze(["unavailable", "cycle", "unpinned"]);

/** A link's `at` as heads (a non-empty list of strings) and deps, or null (live). Pure. */
export function atOf(o) {
  const heads = o?.at?.heads;
  if (!Array.isArray(heads) || !heads.length || !heads.every((h) => typeof h === "string")) return null;
  const deps = o.at.deps && typeof o.at.deps === "object" ? o.at.deps : null;
  return { heads: [...heads], deps };
}

/** Is this object a link (its source is a scene doc, through the scene.link source)? */
export const isLink = (o) => !!o && typeof o === "object" && o.providerId === LINK && typeof o.sourceUrl === "string" && o.sourceUrl.startsWith("automerge:");

/** A doc's links, by id order: [{ id, url, at }]. Pure. */
export function linksOf(doc) {
  const objects = doc?.objects && typeof doc.objects === "object" ? doc.objects : {};
  return Object.keys(objects)
    .filter((id) => isLink(objects[id]))
    .sort()
    .map((id) => ({ id, url: objects[id].sourceUrl, at: atOf(objects[id]) }));
}

/** An identity: a live doc is its url; a pinned value is (url, heads). */
export const identityOf = (url, heads) => (heads ? `${url}#${[...heads].sort().join(",")}` : url);

/**
 * Expand a view's links, nearest first.
 * @param {{ url: string, heads?: string[] | null }} root  the outermost doc (heads: it is itself a pin)
 * @param {(url: string, heads: string[] | null) => object | null | undefined} docOf
 *   a doc as the view has it: null if it can't be opened, undefined if it hasn't arrived
 * @param {{ budget?: number }} [o]
 * @returns {{ path: string[], url: string, heads: string[] | null, deps: object | null, role: "acting" | "mirror" | "pinned" | "closed", reason?: string, depth: number, parent: number | null, link: string | null }[]}
 */
export function expand(root, docOf, { budget = Infinity } = {}) {
  const out = [];
  const acting = new Set(); // live urls with their acting occurrence placed
  // one level at a time, each level in path order: the order a breadth-first
  // walk visits paths when each doc's links are taken by id
  let level = [{ path: [], url: root.url, heads: root.heads ?? null, deps: null, pinned: !!root.heads, ids: [], parent: null, link: null }];
  while (level.length && out.length < budget) {
    const next = [];
    for (const occ of level) {
      if (out.length >= budget) break;
      const ident = identityOf(occ.url, occ.heads);
      const n = out.length;
      const base = { path: occ.path, url: occ.url, heads: occ.heads, deps: occ.heads ? (occ.deps ?? null) : null, depth: occ.path.length, parent: occ.parent, link: occ.link };
      if (occ.closed) {
        out.push({ ...base, role: "closed", reason: occ.closed });
        continue;
      }
      if (occ.ids.includes(ident)) {
        out.push({ ...base, role: "closed", reason: "cycle" });
        continue;
      }
      const doc = docOf(occ.url, occ.heads);
      if (doc === null) {
        out.push({ ...base, role: "closed", reason: "unavailable" });
        continue;
      }
      let role;
      if (occ.heads) role = "pinned";
      else if (acting.has(occ.url)) role = "mirror";
      else {
        acting.add(occ.url);
        role = "acting";
      }
      out.push({ ...base, role });
      if (doc === undefined) continue; // not here yet: nothing under it
      const ids = [...occ.ids, ident];
      for (const l of linksOf(doc)) {
        const child = { path: [...occ.path, l.id], url: l.url, ids, parent: n, link: l.id, deps: null, heads: null, pinned: false };
        if (l.at) {
          child.heads = l.at.heads;
          // its own deps, else the pin it is in holds the rest (a pin is whole)
          child.deps = l.at.deps ?? occ.deps;
          child.pinned = true;
        } else if (occ.pinned) {
          // a live link inside a pin is held where the pin's deps hold its url
          const deps = occ.deps;
          const h = deps && Array.isArray(deps[l.url]) && deps[l.url].length ? deps[l.url] : null;
          if (h) {
            child.heads = [...h];
            child.deps = deps;
            child.pinned = true;
          } else child.closed = "unpinned";
        }
        next.push(child);
      }
    }
    level = next;
  }
  return out;
}
