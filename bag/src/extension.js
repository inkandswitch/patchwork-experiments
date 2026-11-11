// The bag's scene extension (`scene:extension` "bag"): what makes an object a
// container in a scene. Things dropped on it go in, Draw takes one out into
// the drawer's hand, a label says how many it holds, and its 2D panel opens
// beside the scene. A bag is a physical thing, not a rule: it knows nothing
// of turns, hands, seats or limits.
//
// It is built only from the scene's extension contract (scene/STAGE.md).
// Carrying is the hand's (`carry`, collected); what may be picked up is any
// running extension's to veto (`carryable`); who drew is told with api.send.
// The contents live in the bag's own document (contents.js), never in the
// scene doc: that is what "inside" means. The moves and why they merge
// safely are moves.js and contents.js; this file is the stage side.
//
// Which object is a bag: one with the trait `bag.container` ({ doc: url }),
// whose bag document is the trait's `doc`, else the document the object is
// drawn from. So any object can be a container (a box lid, a cup), and the
// sack is only what a bag document looks like by default.
//
// What the stage doesn't give, and how this works round it (README.md,
// "What the stage lacks"):
// - no "put down" event: `landing` is a question the hand asks while it
//   carries, so this remembers which object this view's hand has, and when
//   the doc then shows it moved, looks at where it lies;
// - `carry` wants a press to follow, and a draw starts from a key, with an
//   object that doesn't exist until then: the drawn piece is carried under
//   an arm of this extension's, which feeds the pointer to the hand's
//   session and ends it on the next click.

import { count, inside, shadowsFor } from "./contents.js";
import { DEFAULT_TITLE } from "./datatype.js";
import { replaces, ruleOf } from "./draw.js";
import { drawOne, objectOf, pour, putObjects, settleDraw } from "./moves.js";
import { isGroup } from "./object.js";
import { CONTAINER, bagUrlOf, dropBag } from "./part.js";
import { poseBeside } from "./place.js";

/** How long a finished draw is still watched, to say so if a peer turns out to have drawn the same piece (ms). */
const RECENT_MS = 30_000;
/** How long a notice waits for its sender's name (ms). */
const NAME_MS = 400;
/** The most a single Draw several takes. */
export const MAX_DRAW = 10;

const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, String(v));
  }
  e.append(...children.filter((c) => c != null));
  return e;
};

const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const poseKey = (t) => JSON.stringify([t?.position ?? null, t?.rotation ?? null]);

export default {
  create(api) {
    const { repo } = api;
    let dead = false;
    let scene = api.scene();
    const docs = new Map(); // bag url → { handle | null, off }
    const spots = new Map(); // bag object id → how many things it has set down beside itself
    api.style(STAGE_CSS);

    // ── the bags of this scene, and their documents ──
    const objectsNow = () => api.doc()?.objects ?? {};
    const has = (id) => !!objectsNow()[id];
    /** The scene's bags: [{ id, url }]. */
    const bagsIn = (s = scene) => Object.entries(s?.objects ?? {}).flatMap(([id, o]) => (bagUrlOf(o) ? [{ id, url: bagUrlOf(o) }] : []));
    const bagAt = (id) => (id != null && bagUrlOf(scene?.objects?.[id]) ? { id, url: bagUrlOf(scene.objects[id]) } : null);
    const handleOf = (url) => docs.get(url)?.handle ?? null;
    const docOf = (url) => handleOf(url)?.doc?.() ?? null;
    const titleOf = (url) => docOf(url)?.title || DEFAULT_TITLE;
    /** Is this a bag document (it has the map its contents are kept in)? */
    const isBagDoc = (doc) => !!doc && typeof doc.items === "object" && doc.items !== null;

    /** The readers' rule for every bag of the scene (contents.js shadowsFor): bag url → its test. */
    function shadows() {
      const loaded = [];
      for (const { url } of bagsIn()) if (isBagDoc(docOf(url))) loaded.push({ url, doc: docOf(url) });
      return shadowsFor(loaded, { sceneUrl: api.url, has });
    }
    const insideOf = (url, sh = shadows()) => (isBagDoc(docOf(url)) ? inside(docOf(url), sh.get(url)) : []);

    function watch(urls) {
      for (const [url, rec] of docs) {
        if (urls.has(url)) continue;
        rec.off?.();
        docs.delete(url);
      }
      for (const url of urls) {
        if (docs.has(url)) continue;
        const rec = { handle: null, off: null };
        docs.set(url, rec);
        Promise.resolve(repo.find(url))
          .then((h) => {
            if (dead || docs.get(url) !== rec || !h) return;
            rec.handle = h;
            const on = () => changed();
            h.on?.("change", on);
            rec.off = () => h.off?.("change", on);
            changed();
          })
          .catch((err) => console.warn("[bag] a bag's document is unavailable", url, err));
      }
    }
    /** The bag documents to keep open: the scene's bags', and those of bags inside them (to refuse a bag put inside itself). */
    function wanted() {
      const urls = new Set(bagsIn().map((b) => b.url));
      for (const url of [...urls]) for (const u of bagsWithin(url)) urls.add(u);
      return urls;
    }
    /** The bag documents of the containers inside a bag, at any depth among those loaded. */
    function bagsWithin(url, seen = new Set()) {
      if (seen.has(url)) return seen;
      for (const { entry } of isBagDoc(docOf(url)) ? inside(docOf(url)) : []) {
        const u = bagUrlOf(entry.object);
        if (!u || seen.has(u)) continue;
        seen.add(u);
        bagsWithin(u, seen);
      }
      return seen;
    }

    /** A bag's document changed (a put, a draw, here or elsewhere). */
    function changed() {
      if (dead) return;
      watch(wanted());
      settle();
      drawLabels();
      dock?.refresh?.();
      // the surfaces read the verbs again (a count in a label, an empty bag)
      api.schedule(() => {});
    }

    // ── telling the others: that something was done, never what it was ──
    const names = new Map(); // viewer → a promise of their contact's name (null: none)
    /** A viewer's contact name, once: asked the first time they're heard from, and not waited on for long. */
    function contactName(who) {
      if (typeof who !== "string" || !who) return Promise.resolve(null);
      if (!names.has(who)) {
        const asked = who.startsWith("automerge:")
          ? Promise.resolve()
              .then(() => repo?.find?.(who))
              .then((h) => {
                const n = h?.doc?.()?.name;
                return typeof n === "string" && n.trim() ? n.trim() : null;
              })
              .catch(() => null)
          : Promise.resolve(null);
        names.set(who, Promise.race([asked, new Promise((r) => setTimeout(() => r(null), NAME_MS))]));
      }
      return names.get(who);
    }
    const things = (n) => (n === 1 ? "something" : `${n} things`);
    /** What a message says, from `who`; null if it's malformed, or about a bag that isn't in this scene. */
    function told(type, data, who) {
      if (!data || typeof data !== "object" || !Object.hasOwn(MESSAGES, type) || !MESSAGES[type](data)) return null;
      const here = new Set(bagsIn().map((b) => b.url));
      for (const k of ["bag", "from", "to"]) if (k in data && !here.has(data[k])) return null;
      switch (type) {
        case "drew":
          return `${who} drew ${data.n === 1 ? "" : `${data.n} `}from ${titleOf(data.bag)}`;
        case "put":
          return `${who} put ${things(data.n)} in ${titleOf(data.bag)}`;
        case "emptied":
          return `${who} emptied ${titleOf(data.bag)} (${data.n})`;
        case "poured":
          return `${who} poured ${titleOf(data.from)} into ${titleOf(data.to)} (${data.n})`;
        case "looked":
          return `${who} looked inside ${titleOf(data.bag)}`;
      }
      return null;
    }
    /** Say it here (sends are never echoed back), then to every other peer. */
    function announce(type, data) {
      const text = told(type, data, "You");
      if (text) api.notify(text);
      api.send?.(type, data);
    }

    // ── putting things in ──
    function vetoed(id) {
      for (const { value } of api.collect?.("carryable") ?? []) {
        if (typeof value !== "function") continue;
        try {
          if (value(id) === false) return true;
        } catch (err) {
          console.warn("[bag] a carryable rule failed", err);
        }
      }
      return false;
    }
    /** Why object `id` can't go into the bag at `url` (a sentence), or null when it can. */
    function refusal(bag, id) {
      const o = objectsNow()[id];
      if (!o || isGroup(o)) return "That isn't there any more.";
      if (id === bag.id) return "A bag can't go inside itself.";
      const inner = bagUrlOf(o);
      if (inner && (inner === bag.url || bagsWithin(inner).has(bag.url))) return "A bag can't go inside itself.";
      if (o.locked) return `${o.name || "That"} is locked in place.`;
      if (api.heldBy?.(id) != null) return "Someone is holding that.";
      if (vetoed(id)) return `${o.name || "That"} can't be picked up just now.`;
      return null;
    }
    /** Put objects (a group: its members) into a bag: out of the scene in one change, into the bag in one. */
    function putInto(bagId, targets, { quiet = false } = {}) {
      const bag = bagAt(bagId);
      const handle = bag ? handleOf(bag.url) : null;
      if (!bag) return 0;
      if (!isBagDoc(handle?.doc?.())) return void api.notify(handle ? "That object's contents aren't a bag document." : "The bag is still loading.", "error");
      const objects = objectsNow();
      const groups = [];
      const ids = [];
      for (const t of targets) {
        if (isGroup(objects[t])) {
          groups.push(t);
          for (const m of scene?.members?.get?.(t) ?? []) if (!isGroup(objects[m])) ids.push(m);
        } else ids.push(t);
      }
      const ok = [];
      let why = null;
      for (const id of new Set(ids)) {
        const r = refusal(bag, id);
        if (r) why ??= r;
        else ok.push(id);
      }
      if (why && !quiet) api.notify(why, ok.length ? "info" : "error");
      if (!ok.length) return 0;
      // a group whose every member went in goes too (it would be an empty row)
      const went = new Set(ok);
      const emptied = groups.filter((g) => (scene?.members?.get?.(g) ?? []).every((m) => isGroup(objects[m]) || went.has(m)));
      for (const p of [...pendings]) if (went.has(p.id)) retire(p, { quietly: true });
      putObjects({ objects, ids: ok, sceneUrl: api.url, remove: (gone) => api.remove([...gone, ...emptied]), bag: handle });
      announce("put", { bag: bag.url, n: ok.length });
      return ok.length;
    }

    // A piece this view's hand let go of over a bag goes in. The stage has no
    // "put down" event, so: `landing` (asked by the hand while it carries)
    // says which object this view's hand has; when the doc then shows that
    // object somewhere new, the hand has put it down, and where it lies says
    // whether that was on a bag.
    let carried = null; // { id, was: its pose when the hand first asked, on: what it last hovered over }
    function landing(id, _point, hitId) {
      if (carried?.id !== id) carried = { id, was: poseKey(objectsNow()[id]?.transform), on: null };
      carried.on = hitId ?? null;
      return null;
    }
    /** The bag an object lies on: the middle of its base is within a bag's footprint. */
    function bagUnder(id) {
      const m = scene.world(id);
      const box = api.content?.(id)?.box ?? null;
      const base = box ? apply(m, [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2]) : [m[12], m[13], m[14]];
      for (const b of bagsIn()) {
        if (b.id === id) continue;
        const bb = api.box?.(b.id);
        if (bb && base[0] >= bb.min[0] && base[0] <= bb.max[0] && base[2] >= bb.min[2] && base[2] <= bb.max[2] && base[1] >= bb.min[1] - 0.005) return b.id;
      }
      return null;
    }
    function putDown() {
      if (!carried) return;
      const o = scene?.objects?.[carried.id];
      if (!o) return void (carried = null);
      if (poseKey(o.transform) === carried.was) return; // still in the hand (or put back)
      const { id, on } = carried;
      carried = null;
      const bagId = bagUnder(id) ?? (bagAt(on) && on !== id ? on : null);
      if (bagId) putInto(bagId, [id]);
    }

    // ── drawing ──
    // A draw this view made, until it is settled: { key, take, id, fresh, copy,
    // url, bagId, carry, session, disarm }. `session` is the hand's carry.
    let pendings = [];
    let recent = []; // finished draws, watched a while longer: { key, take, id, fresh, url, bagId, until }
    let stopLoop = null;
    let pointer = null; // the pointer in the port (px), for a carry that starts from a key
    if (api.port && api.listen) {
      api.listen(api.port, "pointermove", (e) => {
        const r = api.port.getBoundingClientRect();
        pointer = { x: e.clientX - r.left, y: e.clientY - r.top, alt: !!e.altKey };
      });
    }
    const pointerNow = () => pointer ?? { x: (api.port?.clientWidth ?? 0) / 2, y: (api.port?.clientHeight ?? 0) / 2, alt: false };
    /** The hand's carry, if a running extension provides one (STAGE.md, `carry`). */
    const carryFn = () => (api.collect?.("carry") ?? []).map((c) => c.value).find((v) => typeof v === "function") ?? null;

    /** How far a bag reaches from its middle, in plan (m). */
    function reachOf(bagId) {
      const b = api.box?.(bagId);
      return b ? Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2 : 0.1;
    }
    /** Where the next thing out of a bag is set down: beside it, in the frame it stands in. */
    function besideBag(bagId, entry) {
      const o = objectsNow()[bagId];
      const k = spots.get(bagId) ?? 0;
      spots.set(bagId, (k + 1) % 48);
      const parent = o?.parent && has(o.parent) ? o.parent : null;
      const group = o?.group && has(o.group) ? o.group : null;
      const position = [...(o?.transform?.position ?? [0, 0, 0])].map(Number);
      return { ...poseBeside({ position }, reachOf(bagId), k, entry), parent, group };
    }

    /** The scene side of a draw (moves.js drawOne): how an item becomes an object here. */
    function sceneSide(bag, made) {
      return {
        url: api.url,
        has,
        newId: () => api.newId("o"),
        insert(id, entry) {
          const at = besideBag(bag.id, entry);
          api.change((d) => {
            d.objects[id] = objectOf(entry, { ...at, parent: at.parent && d.objects[at.parent] ? at.parent : null, group: at.group && d.objects[at.group] ? at.group : null });
            if (![...d.order].includes(id)) d.order.push(id);
          });
        },
        // with replacement: a copy, the stage's way (addObject: a new render doc seeded from the item's)
        copy(entry) {
          const at = besideBag(bag.id, entry);
          const { name, sourceUrl, providerId, renderUrl, kind, ...fields } = entry.object;
          const transform = { position: at.position, rotation: at.rotation, scale: entry.scale };
          made.push(
            (async () => {
              if (!sourceUrl) {
                const id = api.newId("o");
                api.change((d) => {
                  d.objects[id] = objectOf(entry, { ...at, parent: at.parent && d.objects[at.parent] ? at.parent : null, group: at.group && d.objects[at.group] ? at.group : null });
                  d.order.push(id);
                });
                return id;
              }
              let render = null;
              if (renderUrl) {
                try {
                  render = JSON.parse(JSON.stringify((await repo.find(renderUrl))?.doc?.() ?? null));
                } catch {
                  // no seed: the copy builds its own
                }
              }
              return api.addObject(sourceUrl, { providerId: providerId ?? undefined, name: name || undefined, ...(at.parent ? { parent: at.parent } : {}), group: at.group, transform, fields, ...(render ? { render } : {}) });
            })(),
          );
        },
      };
    }

    /**
     * Draw `n` from a bag. One drawn with `carry` goes into this view's hand;
     * the rest (and all of them when nothing provides `carry`) are set down
     * beside the bag. Each is drawn on its own: if a peer took the same one
     * at the same moment, settle() draws another.
     */
    function draw(bagId, n = 1, { carry = true, rule = null, verb = "drew", again = false } = {}) {
      const bag = bagAt(bagId);
      const handle = bag ? handleOf(bag.url) : null;
      if (!bag) return 0;
      if (!isBagDoc(handle?.doc?.())) return void api.notify(handle ? "That object's contents aren't a bag document." : "The bag is still loading.", "error");
      const by = api.session;
      const how = rule ?? ruleOf(handle.doc());
      const copies = [];
      let got = 0;
      for (let i = 0; i < n; i++) {
        const drawn = drawOne({ bag: handle, rule: how, by, shadow: shadows().get(bag.url), scene: sceneSide(bag, copies) });
        if (!drawn) break;
        got++;
        const wantCarry = carry && i === n - 1;
        if (drawn.copy) copies.at(-1)?.then((id) => !dead && id && track({ ...drawn, id, url: bag.url, bagId, carry: wantCarry }), (err) => api.notify(`Couldn't make a copy: ${err?.message ?? err}`, "error"));
        else track({ ...drawn, url: bag.url, bagId, carry: wantCarry });
      }
      if (!got) api.notify(`${titleOf(bag.url)} is empty.`);
      else if (!again) announce(verb, { bag: bag.url, n: got });
      return got;
    }

    function track(drawn) {
      const p = { key: drawn.key, take: drawn.take ?? null, id: drawn.id, fresh: drawn.fresh, copy: drawn.copy, url: drawn.url, bagId: drawn.bagId, carry: !!drawn.carry, session: null, disarm: null };
      // one piece in the hand at a time: the one before is set down where it came out
      if (p.carry) for (const q of pendings) if (q.carry) letGo(q, "back");
      pendings.push(p);
      if (!p.carry) retire(p);
      else stopLoop ??= api.loop?.(() => step()) ?? null;
      step();
    }
    /** End a pending draw's carry: "back" puts it where it came out, "down" where the pointer is. */
    function letGo(p, how, ev = null) {
      const s = p.session;
      p.session = null;
      p.disarm?.();
      p.disarm = null;
      if (s) {
        try {
          if (how === "down") s.end(ev ?? pointerNow());
          else s.cancel();
        } catch (err) {
          console.warn("[bag] the carry didn't end cleanly", err);
        }
      }
      retire(p);
    }
    /** A draw is done with here; it's watched a while for a peer's claim on the same piece. */
    function retire(p, { quietly = false } = {}) {
      if (p.session) {
        const s = p.session;
        p.session = null;
        try {
          s.cancel();
        } catch {
          // already over
        }
      }
      p.disarm?.();
      p.disarm = null;
      pendings = pendings.filter((x) => x !== p);
      if (!quietly && !p.copy) recent.push({ key: p.key, take: p.take, id: p.id, fresh: p.fresh, copy: false, url: p.url, bagId: p.bagId, until: Date.now() + RECENT_MS });
      if (!pendings.some((x) => x.carry) && stopLoop) {
        stopLoop();
        stopLoop = null;
      }
    }

    /** Start carrying a drawn piece: the hand's session, fed by an arm of ours until the next click. */
    function startCarry(p) {
      const fn = carryFn();
      const s = fn?.(p.id, pointerNow(), { now: true, offset: [0, 0] });
      if (!s) return false;
      p.session = s;
      const mine = () => p.session === s;
      p.disarm = api.arm({
        move: (ev) => void (mine() && s.move(ev)),
        press(ev) {
          if (!mine() || (ev.button != null && ev.button !== 0)) return null;
          return {
            cursor: "grabbing",
            move: (e) => void (mine() && s.move(e)),
            end: (e) => void (mine() && letGo(p, "down", e)),
            tap: (e) => (mine() && letGo(p, "down", e), true),
            cancel() {},
            key: (e) => mine() && !!s.key?.(e),
          };
        },
        key(ev) {
          if (!mine()) return false;
          if (ev.key === "Escape") return letGo(p, "back"), true;
          return !!s.key?.(ev);
        },
        keyup: (ev) => mine() && !!s.keyup?.(ev),
        cursor: () => "grabbing",
      });
      return true;
    }

    /** Each frame while a drawn piece is on its way to the hand: pick it up once it can be. */
    function step() {
      if (dead) return;
      for (const p of [...pendings]) {
        if (!p.carry) continue;
        if (!has(p.id)) continue; // settle() will say what became of it
        // A peer holds this piece too (both drew it at once: one object, two
        // hands). The stage's hold order says whose hand keeps it, and ours
        // gives way; what the peer then does says whose piece it was. If
        // they let go where it lies (the bag told them it's ours), we pick
        // it up; if they put it somewhere, it was theirs, and we draw
        // another. (The bag's own verdict settles two draws from one bag
        // before this matters; this is for the cases it can't see: a pour
        // racing a draw, a piece put away under a drawer's hand.)
        if (api.heldBy?.(p.id) != null) {
          p.contested ??= poseKey(objectsNow()[p.id]?.transform);
          if (p.session) {
            const s = p.session;
            p.session = null;
            p.disarm?.();
            p.disarm = null;
            try {
              s.cancel();
            } catch {
              // the hand already put it back
            }
          }
          continue;
        }
        if (p.contested != null) {
          if (poseKey(objectsNow()[p.id]?.transform) !== p.contested) {
            lose(p);
            continue;
          }
          p.contested = null;
        }
        if (p.session) continue;
        if (!carryFn()) {
          retire(p); // nothing carries here: it stays where it was set down, beside the bag
          continue;
        }
        if (api.content?.(p.id)?.box && api.worldOf?.(p.id)) startCarry(p);
      }
    }

    /**
     * After any change: what became of this view's draws. One a peer took at
     * the same moment (the bag says so) is theirs: this view lets go of it,
     * removes it only if it stood under an id of this view's own making, and
     * draws again.
     */
    /** A draw turned out to be a peer's: let go, remove only what stood under an id of our own, draw another. */
    function lose(p) {
      retire(p, { quietly: true });
      if (p.fresh && !p.copy && has(p.id)) api.remove([p.id]);
      api.notify("Someone else drew that one at the same moment: drawing another.");
      if (bagAt(p.bagId)) draw(p.bagId, 1, { carry: p.carry, again: true });
    }
    let settling = false;
    function settle() {
      if (settling || dead) return;
      settling = true;
      try {
        for (const p of [...pendings]) {
          const doc = docOf(p.url);
          if (!doc || settleDraw(doc, p, api.session, has) !== "lost") continue;
          lose(p);
        }
        // one already put down: the same, and the one drawn instead is set down beside the bag
        const now = Date.now();
        const lost = [];
        recent = recent.filter((r) => {
          if (r.until < now) return false;
          const doc = docOf(r.url);
          if (!doc || settleDraw(doc, r, api.session) !== "lost") return true;
          lost.push(r);
          return false;
        });
        for (const r of lost) {
          if (r.fresh && has(r.id)) api.remove([r.id]);
          api.notify(`Someone else drew the same piece from ${titleOf(r.url)} at the same moment, and it is theirs: drawing another.`);
          if (bagAt(r.bagId)) draw(r.bagId, 1, { carry: false, again: true });
        }
      } finally {
        settling = false;
      }
    }

    // ── pouring ──
    function pourInto(fromId, toId) {
      const from = bagAt(fromId);
      const to = bagAt(toId);
      if (!from || !to || from.url === to.url) return;
      const a = handleOf(from.url);
      const b = handleOf(to.url);
      if (!isBagDoc(a?.doc?.()) || !isBagDoc(b?.doc?.())) return void api.notify("The bags are still loading.", "error");
      // a bag inside the one being poured mustn't end up inside itself
      const sh = shadows();
      if (insideOf(from.url, sh).some(({ entry }) => bagUrlOf(entry.object) === to.url || (bagUrlOf(entry.object) && bagsWithin(bagUrlOf(entry.object)).has(to.url)))) {
        return void api.notify("A bag can't go inside itself.", "error");
      }
      const n = pour({ from: a, to: b, by: api.session, shadow: sh.get(from.url) });
      if (n) announce("poured", { from: from.url, to: to.url, n });
      else api.notify(`${titleOf(from.url)} is empty.`);
    }

    // ── the count on each bag ──
    const labels = api.labels?.() ?? null;
    let labelKey = "";
    function drawLabels() {
      if (!labels || dead || !scene) return;
      const sh = shadows();
      const items = [];
      for (const b of bagsIn()) {
        if (!isBagDoc(docOf(b.url))) continue;
        const box = api.box?.(b.id);
        const m = api.worldOf?.(b.id) ?? scene.world(b.id);
        const position = (box ? [(box.min[0] + box.max[0]) / 2, box.max[1], (box.min[2] + box.max[2]) / 2] : [m[12], m[13] + 0.2, m[14]]).map((v) => +v.toFixed(4));
        const n = insideOf(b.url, sh).length;
        items.push({ key: b.id, text: `${titleOf(b.url)} · ${n}`, position, className: "bag-count", data: { empty: n === 0 }, rank: 2 });
      }
      const k = JSON.stringify(items);
      if (k === labelKey) return;
      labelKey = k;
      labels.set(items);
    }

    // ── the bag's own panel, docked beside the scene ──
    let dock = null; // { bagId, url, edge, unmount, refresh }
    function closeDock() {
      if (!dock) return;
      const d = dock;
      dock = null;
      try {
        d.unmount?.();
      } catch (err) {
        console.warn("[bag] the panel didn't close cleanly", err);
      }
      d.edge.remove();
      api.schedule(() => {});
    }
    function openDock(bagId) {
      const bag = bagAt(bagId);
      const handle = bag ? handleOf(bag.url) : null;
      if (!bag || !handle) return;
      closeDock();
      const edge = api.edge("right");
      edge.classList.add("bag-dock");
      // keys typed in the panel are the panel's, never the scene's (STAGE.md, "Keys")
      edge.setAttribute("data-stage-embed", "");
      const body = el("div", { class: "bag-dock-body" });
      edge.append(el("header", {}, el("span", { class: "bag-dock-name" }, titleOf(bag.url)), el("button", { type: "button", onclick: closeDock, title: "Close the bag's panel" }, "Close")), body);
      const d = { bagId, url: bag.url, edge, unmount: null, refresh: null };
      dock = d;
      // the panel is this package's own tool, on the bag's document; in a
      // scene it reads by the scene's rule and its Draw sets pieces down here
      const host = {
        shadow: () => shadows().get(bag.url) ?? null,
        draw: (n) => draw(bagId, n, { carry: false }),
        empty: () => draw(bagId, count(docOf(bag.url), shadows().get(bag.url)), { carry: false, rule: "top", verb: "emptied" }),
        subscribe: (fn) => void (d.refresh = fn),
      };
      import("./tool.js")
        .then(({ default: Tool }) => {
          if (dead || dock !== d) return;
          d.unmount = Tool(handle, body, host);
        })
        .catch((err) => api.notify(`Couldn't open the bag: ${err?.message ?? err}`, "error"));
      announce("looked", { bag: bag.url });
      api.schedule(() => {});
    }

    const editing = (local) => (local ?? api.local?.get?.())?.activities?.current === "edit";
    /** A verb's state for a bag target: null off a bag, disabled while it loads. */
    function onBag(target, make) {
      const bag = bagAt(target);
      if (!bag) return null;
      if (!isBagDoc(docOf(bag.url))) return { disabled: true, title: "The bag is still loading" };
      return make(bag, insideOf(bag.url).length);
    }

    watch(wanted());

    return {
      update(snapshot) {
        scene = snapshot;
        watch(wanted());
        putDown();
        settle();
        step();
        drawLabels();
        if (dock && !bagAt(dock.bagId)) closeDock();
        else dock?.refresh?.();
      },
      landing,
      receive(type, data, from) {
        // checked as it arrives; said once the sender's name is known (or isn't to be had)
        if (!told(type, data, "Someone")) return;
        contactName(from?.viewer).then((name) => {
          const text = dead ? null : told(type, data, name || "Someone");
          if (text) api.notify(text);
        });
      },
      commands: [
        {
          id: "draw",
          name: "Draw",
          key: "d",
          // on the use prompt, so hovering a bag in play says it can be drawn from
          show: ["use", "menu", "inspector"],
          state: (target) =>
            onBag(target, (bag, n) => {
              const title = titleOf(bag.url);
              if (!n) return { disabled: true, label: `${title} is empty`, title: "There is nothing inside to draw" };
              const copy = replaces(ruleOf(docOf(bag.url)));
              return { label: `Draw from ${title} (${n})`, title: copy ? "Draw a copy of one into your hand; it stays in the bag (D)" : "Draw one into your hand (D)" };
            }),
          run: (target) => void draw(target, 1),
        },
        {
          id: "draw-several",
          name: "Draw several",
          show: ["menu", "inspector"],
          state: (target) =>
            onBag(target, (bag, n) => {
              const most = replaces(ruleOf(docOf(bag.url))) ? (n ? MAX_DRAW : 0) : Math.min(n, MAX_DRAW);
              if (most < 2) return null;
              return { value: null, title: "Draw this many at once, set down beside the bag", choices: Array.from({ length: most - 1 }, (_, i) => ({ value: i + 2, label: `Draw ${i + 2}` })) };
            }),
          run(target, value) {
            const n = typeof value === "number" ? value : NaN;
            if (Number.isInteger(n) && n >= 1 && n <= MAX_DRAW) draw(target, n, { carry: false });
          },
        },
        {
          id: "put",
          name: "Put in a bag",
          show: ["menu", "inspector"],
          // on anything that isn't the only bag: which bag it goes into
          state(target) {
            const o = target != null ? scene?.objects?.[target] : null;
            if (!o) return null;
            const members = isGroup(o) ? (scene?.members?.get?.(target) ?? []) : [target];
            const into = bagsIn().filter((b) => isBagDoc(docOf(b.url)) && members.some((m) => !refusal(b, m)));
            if (!into.length) return null;
            return { value: null, title: isGroup(o) ? "Put everything in this group into a bag" : "Put this into a bag", choices: into.map((b) => ({ value: b.id, label: `Put in ${titleOf(b.url)}` })) };
          },
          run(target, value) {
            if (bagAt(value)) putInto(value, [target]);
          },
        },
        {
          id: "pour",
          name: "Pour into",
          show: ["menu", "inspector"],
          state: (target) =>
            onBag(target, (bag, n) => {
              const others = bagsIn().filter((b) => b.url !== bag.url && isBagDoc(docOf(b.url)));
              // (one row per bag document: two objects of one bag are one bag)
              const seen = new Set();
              const choices = others.filter((b) => !seen.has(b.url) && seen.add(b.url)).map((b) => ({ value: b.id, label: `Pour into ${titleOf(b.url)}` }));
              if (!n || !choices.length) return null;
              return { value: null, title: "Tip everything in this bag into another", choices };
            }),
          run: (target, value) => void pourInto(target, value),
        },
        {
          id: "empty",
          name: "Empty out",
          show: ["menu", "inspector"],
          // setting a table up, not playing: everything set down round the bag
          state: (target, ctx) => (editing(ctx?.local) ? onBag(target, (bag, n) => (n ? { title: `Set all ${n} down round the bag` } : null)) : null),
          run(target) {
            const bag = bagAt(target);
            if (bag && isBagDoc(docOf(bag.url))) draw(target, insideOf(bag.url).length, { carry: false, rule: "top", verb: "emptied" });
          },
        },
        {
          id: "inside",
          name: "Look inside",
          show: ["menu", "inspector"],
          state: (target) => onBag(target, () => ({ checked: dock?.bagId === target, title: "Open the bag's panel beside the scene. Anyone can: what is inside is not a secret, and the others are told you looked" })),
          run: (target) => (dock?.bagId === target ? closeDock() : openDock(target)),
        },
      ],
      dispose() {
        dead = true;
        for (const p of [...pendings]) retire(p, { quietly: true });
        stopLoop?.();
        stopLoop = null;
        closeDock();
        for (const rec of docs.values()) rec.off?.();
        docs.clear();
      },
    };
  },

  /** A bag document dropped into a scene becomes a bag in it (part.js). */
  drop: (ctx, info) => dropBag(ctx, info),
};

/** What a peer may tell us, and the shape each must have: which bag and how many, never what. */
const url = (u) => typeof u === "string" && u.length < 512 && u.startsWith("automerge:");
const howMany = (n) => Number.isInteger(n) && n > 0 && n <= 100_000;
const MESSAGES = {
  drew: (d) => url(d.bag) && howMany(d.n),
  put: (d) => url(d.bag) && howMany(d.n),
  emptied: (d) => url(d.bag) && howMany(d.n),
  poured: (d) => url(d.from) && url(d.to) && howMany(d.n),
  looked: (d) => url(d.bag),
};

export { CONTAINER, MESSAGES };

const STAGE_CSS = `
.scene-stage .label.bag-count:where(:not(.about-embed *), .about-embed .scene-tool *) {
  color: #f6f3ea; background: color-mix(in oklch, #0b0d10 62%, transparent);
  padding: 1px 7px; border-radius: 6px; font-size: 12px; text-shadow: 0 1px 1px rgb(0 0 0 / 0.4);
}
.scene-stage .label.bag-count[data-empty]:where(:not(.about-embed *), .about-embed .scene-tool *) { opacity: 0.7; }
.scene-stage .bag-dock:where(:not(.about-embed *), .about-embed .scene-tool *) {
  flex: 0 0 auto; width: clamp(240px, 30cqw, 380px); height: 100%; min-height: 0; display: flex; flex-direction: column;
  border-left: 1px solid var(--scene-border, rgb(0 0 0 / 0.15)); background: var(--scene-panel-bg, #fff); color: var(--scene-fg, #222);
}
.scene-stage .bag-dock > header:where(:not(.about-embed *), .about-embed .scene-tool *) {
  flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 6px 10px; font: 600 13px system-ui, sans-serif;
  border-bottom: 1px solid var(--scene-border, rgb(0 0 0 / 0.15));
}
.scene-stage .bag-dock .bag-dock-name:where(:not(.about-embed *), .about-embed .scene-tool *) { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-stage .bag-dock > header button:where(:not(.about-embed *), .about-embed .scene-tool *) { font: inherit; padding: 2px 10px; border-radius: 6px; cursor: pointer; }
.scene-stage .bag-dock-body:where(:not(.about-embed *), .about-embed .scene-tool *) { flex: 1 1 auto; min-height: 0; overflow: auto; }
`;
