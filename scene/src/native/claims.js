// scene.claims (native, every doc): provides "claims" (NATIVE.md, "Native services").
//
// A claim is a fact about the shared world (who is at the helm, who computes
// world time), so it's a doc field on what's claimed: taking one writes it,
// letting go deletes it. Concurrent takers are Automerge's to settle: the
// merge keeps one on every peer, and the view whose claim isn't there any
// more is told (onLost). A claim counts only while its session is on the
// channel (or is this view's), so a tab that died holding one holds nothing:
// the next taker writes over it. Only the public api.

/** How long a claim by a session never heard on the channel still counts (ms): its hello, or ours, may be late. A heartbeat (5 s) and a second. */
export const CLAIM_GRACE_MS = 6_000;

/** What a service hands a caller goes as its signal aborts: tie `give` to it, to run once, then or on the returned off. */
export function tie(signal, give) {
  let done = false;
  const off = () => {
    if (done) return;
    done = true;
    signal.removeEventListener("abort", off);
    give();
  };
  if (signal.aborted) off();
  else signal.addEventListener("abort", off);
  return off;
}
const MAX = 1024;
const keyOf = (oid, kind) => `${oid ?? ""}\u0000${kind}`;
const isKind = (kind) => typeof kind === "string" && kind.length > 0;
const remember = (map, k, v) => {
  map.set(k, v);
  if (map.size > MAX) map.delete(map.keys().next().value);
};

/** The doc's claim of this kind on an object (null: the scene), as stored, or null. Pure. */
export function claimField(d, oid, kind) {
  const c = (oid == null ? d : d?.objects?.[oid])?.claims?.[kind];
  return c && typeof c === "object" && typeof c.session === "string" ? c : null;
}

function create(api) {
  const ch = api.channel;
  const held = new Map(); // key → { id, kind, ext, onLost, release }: the claims this view holds
  const seen = new Map(); // key + session → when this view first read that claim with its holder absent
  const met = new Map(); // sessions heard on the channel: one that has gone (a bye, the TTL) lapses at once
  let away = false;
  const meet = (peers) => Object.keys(peers).forEach((s) => met.has(s) || remember(met, s, true));
  meet(ch.peers());
  ch.watch(meet);

  /** Who holds a claim: { viewer, session, mine }, or null (nobody; a holder gone or past its grace; a pin). */
  function claimedBy(oid, kind) {
    const c = isKind(kind) && ch.session ? claimField(api.doc(), oid, kind) : null;
    if (!c) return null;
    const mine = c.session === ch.session;
    if (!mine && !Object.hasOwn(ch.peers(), c.session)) {
      if (met.has(c.session)) return null;
      const k = `${keyOf(oid, kind)}\u0000${c.session}`;
      if (!seen.has(k)) remember(seen, k, api.now());
      if (api.now() - seen.get(k) >= CLAIM_GRACE_MS) return null;
    }
    return Object.freeze({ viewer: typeof c.viewer === "string" ? c.viewer : null, session: c.session, mine });
  }

  /** Write these claims as this view's (`erase`: delete those still this view's). */
  function write(list, erase = false) {
    const mine = erase ? list.filter((e) => claimField(api.doc(), e.id, e.kind)?.session === ch.session) : list;
    if (!mine.length) return;
    try {
      api.change((d) => {
        for (const { id: oid, kind } of mine) {
          const h = oid == null ? d : d.objects?.[oid];
          if (!h) continue;
          // (a new map is made first, then written through the doc's: Automerge copies what it's given)
          if (!erase) {
            if (!h.claims) h.claims = {};
            h.claims[kind] = { viewer: ch.viewer, session: ch.session };
          } else if (h.claims?.[kind]?.session === ch.session) delete h.claims[kind];
        }
      });
    } catch (err) {
      console.warn("[scene] couldn't write a claim", err);
    }
  }

  /** Take a claim for a caller: its release, or null while someone else (here or there) holds it. Again from the same caller: the same release. */
  function take(caller, oid, kind, onLost) {
    if (caller.signal.aborted || !isKind(kind) || !api.writable() || (oid != null && !api.doc().objects?.[oid])) return null;
    const k = keyOf(oid, kind);
    const h = held.get(k);
    if (h) {
      if (h.ext !== caller.id) return null;
      if (typeof onLost === "function") h.onLost = onLost;
      return h.release;
    }
    if (claimedBy(oid, kind)?.mine === false) return null;
    const e = { id: oid, kind, ext: caller.id, onLost: typeof onLost === "function" ? onLost : null };
    e.release = tie(caller.signal, () => held.get(k) === e && (held.delete(k), write([e], true)));
    held.set(k, e);
    if (!away) write([e]);
    return e.release;
  }

  // After a doc change (or coming back), look at the claims this view holds.
  // One whose field names someone else lost the merge (or lapsed here and was
  // taken), or whose object has gone: it's let go and its taker told once.
  // One whose field is missing lost no contest (two views giving an object
  // its first claims map at once keep one map; or the goodbye): written again.
  function recheck() {
    if (away || !held.size) return;
    const d = api.doc();
    const lost = [];
    const again = [];
    for (const e of held.values()) {
      const c = claimField(d, e.id, e.kind);
      if (e.id != null && !d.objects?.[e.id]) lost.push(e);
      else if (!c) again.push(e);
      else if (c.session !== ch.session) lost.push(e);
    }
    write(again);
    for (const e of lost) {
      held.delete(keyOf(e.id, e.kind));
      try {
        e.onLost?.();
      } catch (err) {
        console.warn(`[scene] extension “${e.ext}”: onLost failed`, err);
      }
    }
  }
  api.page.on("hide", () => (write([...held.values()], true), (away = true)));
  api.page.on("show", () => ((away = false), queueMicrotask(recheck)));

  return {
    provides: {
      claims: (caller) =>
        Object.freeze({
          claim: (oid, kind, { onLost } = {}) => take(caller, oid ?? null, kind, onLost),
          claimedBy: (oid, kind) => claimedBy(oid ?? null, kind),
        }),
    },
    update: recheck,
    /** for probes: the claims this view holds, [{ id, kind, ext }] */
    held: () => [...held.values()].map(({ id, kind, ext }) => ({ id, kind, ext })),
    dispose: () => write([...held.values()], true),
  };
}

export default { create };
