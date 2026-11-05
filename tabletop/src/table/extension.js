// The tabletop's scene extension (`scene:extension` "tabletop"): what makes a
// scene a game table. Seats and who sits in them, private zones, hidden cards
// and the decks they belong to, shuffling a pile, laying out a deck dropped on
// the table, and drawing a card into your hand face up. The scene itself knows
// none of this (scene/README, "Extensions").
//
// It is built only from the scene's extension contract (scene/STAGE.md): the
// hand, keys, menu, frame and notices it relies on are other extensions it
// `requires`; its own UI is a seat picker over the table (an overlay), deck
// trouble as HUD lines, and Shuffle as a command. Nothing here assumes a
// sidebar or toolbar exists.
//
// Decks: a hidden object names its deck (trait tabletop.hidden: { by: url }).
// A plain deck (plain-deck.js) is read here; any other kind through the
// `tabletop:deck` plugin for its datatype (card-table's secure deck), whose
// module has createResolver({ repo, handle, viewer, onChange }) and, to be
// laid out when dropped, placement(doc) and bind(handle, ids).

import { HIDDEN, SEATS, ZONE, docUrl, hiddenBy, seatAt, seatOf, seatedPlayers, seatsOf, visibility, zones } from "./visibility.js";
import { LEGACY_PLAIN_DECK, PLAIN_DECK, plainResolver } from "./plain-deck.js";


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

/** Does this scene doc still have the fields the scene used to own? */
export function needsMigration(d) {
  if (d?.seats !== undefined) return true;
  // a table suggests no kits: playing needs none of the editing UI
  if (d?.traits?.[SEATS] && d.view && d.view.kits === undefined) return true;
  return Object.values(d?.objects ?? {}).some((o) => o && (o.zone !== undefined || o.hidden !== undefined));
}

/** Move them into traits (inside a change). A table also opens on its own panel. */
export function migrate(d) {
  if (d.seats !== undefined) {
    if (!d.traits) d.traits = {};
    if (d.traits[SEATS] === undefined && d.seats) d.traits[SEATS] = JSON.parse(JSON.stringify(d.seats));
    delete d.seats;
  }
  if (d.traits?.[SEATS] && d.view && d.view.kits === undefined) d.view.kits = [];
  for (const o of Object.values(d.objects ?? {})) {
    if (!o) continue;
    for (const [field, key] of [
      ["zone", ZONE],
      ["hidden", HIDDEN],
    ]) {
      if (o[field] === undefined) continue;
      if (o[field] != null) {
        if (!o.traits) o.traits = {};
        if (o.traits[key] === undefined) o.traits[key] = JSON.parse(JSON.stringify(o[field]));
      }
      delete o[field];
    }
  }
}

export default {
  create(api) {
    const { repo, viewer } = api;
    const decks = new Map(); // url → { resolver, module, problem }
    let scene = null;
    let looks = new Map();
    let regions = null;
    let dead = false;
    // a deck learned something (a card's face, a shuffle): read the lens again
    const refresh = () => {
      if (dead) return;
      if (scene) lens(scene);
      api.schedule(() => {});
    };

    const deckProvider = (type) => deckProviderFor(api.registry, type);

    function watchDecks(urls) {
      for (const [url, deck] of decks) {
        if (urls.has(url)) continue;
        deck.resolver?.dispose?.();
        decks.delete(url);
      }
      for (const url of urls) {
        if (decks.has(url)) continue;
        const deck = { resolver: null, problem: null, title: null };
        decks.set(url, deck);
        (async () => {
          const h = await repo.find(url);
          if (dead || decks.get(url) !== deck || !h) return;
          let type = h.doc()?.["@patchwork"]?.type ?? null;
          // a plain deck from before tabletop owned it
          if (type === LEGACY_PLAIN_DECK) {
            h.change((d) => {
              if (d["@patchwork"]?.type === LEGACY_PLAIN_DECK) d["@patchwork"].type = PLAIN_DECK;
            });
            type = PLAIN_DECK;
          }
          deck.title = h.doc()?.title ?? null;
          const provider = await deckProvider(type);
          if (dead || decks.get(url) !== deck) return;
          if (!provider) {
            deck.problem = `Some cards can't be shown: nothing installed reads “${type}” decks.`;
            return refresh();
          }
          deck.resolver = provider.create({ repo, handle: h, viewer, onChange: () => refresh() });
          refresh();
        })().catch((err) => {
          console.warn("[tabletop] deck unavailable", url, err);
          deck.problem = `Some cards can't be shown: ${err?.message ?? err}`;
          refresh();
        });
      }
    }

    /** The pile an object is in: the objects of its deck whose footprints overlap its own by half or more (in plan). */
    function stackOf(id) {
      const objects = scene?.objects ?? {};
      const by = hiddenBy(objects[id]);
      if (!by) return [];
      const same = Object.keys(objects).filter((x) => hiddenBy(objects[x]) === by);
      const box = api.box(id);
      if (!box) {
        // no geometry to go by: the same spot on the table
        const at = scene.world(id);
        return same.filter((x) => {
          const m = scene.world(x);
          return Math.hypot(m[12] - at[12], m[14] - at[14]) < 0.005;
        });
      }
      const area = (b) => Math.max(0, b.max[0] - b.min[0]) * Math.max(0, b.max[2] - b.min[2]);
      return same.filter((x) => {
        const b = x === id ? box : api.box(x);
        if (!b) return false;
        const ox = Math.min(b.max[0], box.max[0]) - Math.max(b.min[0], box.min[0]);
        const oz = Math.min(b.max[2], box.max[2]) - Math.max(b.min[2], box.min[2]);
        return ox > 0 && oz > 0 && ox * oz >= 0.5 * Math.min(area(b), area(box));
      });
    }

    function shuffleStack(id) {
      const by = hiddenBy(scene?.objects?.[id]);
      const deck = by ? decks.get(by) : null;
      if (!deck?.resolver?.shuffle) return api.notify(by ? "This deck can't be shuffled." : "Only cards in a deck can be shuffled.", "error");
      const n = deck.resolver.shuffle(stackOf(id));
      if (!n) return api.notify("There's nothing here to shuffle with it.", "error");
      api.notify(`Shuffling ${n} card${n === 1 ? "" : "s"}…`);
    }

    // ── where you sit: a picker over the table, since a table has no sidebar ──
    const overlay = api.overlay();
    overlay.classList.add("tabletop-overlay");
    const seatPicker = el("select", { class: "tabletop-seat", "aria-label": "Seat", title: "Where you sit: what's in your seat's private zone (your hand) is shown to you alone" });
    seatPicker.addEventListener("change", () => {
      const want = seatPicker.value || null;
      // a seat is the doc's (it lasts); whether its player is here is presence's
      const now = seatsOf(api.scene());
      const holder = want ? now[want]?.player : null;
      if (holder && holder !== viewer && present().has(holder) && typeof globalThis.confirm === "function") {
        if (!globalThis.confirm("Someone is sitting there now. Take their seat? (You'll see what's in their hand.)")) {
          seatPicker.value = seatOf(now, viewer) ?? "";
          return;
        }
      }
      sit(want);
    });
    const seatBar = el("label", { class: "tabletop-seatbar" }, el("span", {}, "Seat"), seatPicker);
    overlay.append(seatBar);
    api.style(SEAT_CSS);
    // who is here changes without a doc change: a seat's (taken) / (away)
    api.presence.watch(() => {
      if (scene) drawSeats();
    });
    let seatKey = "";
    /** The viewers with this table open now (presence), this one included. */
    const present = () => new Set([viewer, ...Object.values(api.presence.get() ?? {}).map((r) => r?.viewer).filter(Boolean)]);
    function drawSeats() {
      const seats = Object.entries(seatsOf(scene));
      seatBar.hidden = !seats.length;
      const mine = seatOf(seatsOf(scene), viewer) ?? "";
      const here = present();
      const note = (s) => (!s?.player || s.player === viewer ? "" : here.has(s.player) ? " (taken)" : " (away)");
      const options = [["", "Watching"], ...seats.map(([id, s]) => [id, `${s?.name || id}${note(s)}`])];
      const k = JSON.stringify(options);
      if (k !== seatKey) {
        seatKey = k;
        seatPicker.replaceChildren(...options.map(([v, t]) => el("option", { value: v }, t)));
      }
      if (document.activeElement !== seatPicker) seatPicker.value = mine;
    }

    /** What each hidden card looks like to this viewer: every deck speaks for its own cards. */
    function lens(snapshot) {
      looks = new Map();
      if (!decks.size) return;
      const objects = snapshot.objects;
      const seats = seatsOf(snapshot);
      const ctx = {
        objects,
        seats,
        viewer,
        players: seatedPlayers(seats),
        openSeats: Object.entries(seats).filter(([, s]) => !s?.player).map(([id, s]) => s?.name || id),
        visibleTo: visibility(snapshot, seats),
        nameOf: (player) => Object.values(seats).find((s) => s?.player === player)?.name ?? "someone",
      };
      for (const [url, deck] of decks) {
        if (!deck.resolver) continue;
        deck.resolver.update(ctx);
        for (const [id, look] of deck.resolver.looks()) if (hiddenBy(objects[id]) === url) looks.set(id, look);
      }
    }

    function sit(seatId) {
      api.change((d) => {
        const seats = d.traits?.[SEATS];
        if (!seats) return;
        for (const s of Object.values(seats)) if (s.player === viewer) s.player = null;
        if (seatId && seats[seatId]) seats[seatId].player = viewer;
      });
      // each seat can say where its player looks from
      const cam = seatId ? seatsOf(api.scene())[seatId]?.camera : null;
      if (cam) api.camera.set(cam);
    }

    return {
      needsMigration,
      migrate,
      update(snapshot, local, prev) {
        if (snapshot === prev?.scene) return;
        scene = snapshot;
        regions = null;
        const urls = new Set();
        for (const o of Object.values(snapshot.objects)) {
          const by = hiddenBy(o);
          if (by) urls.add(by);
        }
        watchDecks(urls);
        lens(snapshot);
        drawSeats();
      },
      looks: () => looks,
      hud() {
        const out = [];
        for (const deck of decks.values()) {
          const line = deck.problem ?? deck.resolver?.status?.();
          if (line) out.push({ text: line, state: deck.problem ? "error" : "loading" });
        }
        return out;
      },
      commands: [
        {
          id: "shuffle",
          name: "Shuffle pile",
          key: "s",
          show: ["menu", "inspector"],
          state: (id) => (id && hiddenBy(scene?.objects?.[id]) ? { title: "Shuffle the pile this card is in (S)" } : null),
          run: shuffleStack,
        },
      ],
      // a hidden card carried into your own zone turns face up for you
      landing(id, world) {
        if (!scene || !hiddenBy(scene.objects[id])) return null;
        const mine = seatOf(seatsOf(scene), viewer);
        if (!mine) return null;
        regions ??= zones(scene);
        return seatAt(scene, regions, world) === mine ? { faceUp: true } : null;
      },
      dispose() {
        dead = true;
        for (const deck of decks.values()) deck.resolver?.dispose?.();
        decks.clear();
      },
    };
  },

  /**
   * A deck dropped on the table: its cards, face down in a stack, in a group
   * named for it. Called by whatever adds documents to the scene, before the
   * extension runs (its traits are what start it).
   */
  async drop(ctx, { url, doc, handle, group }) {
    const type = doc?.["@patchwork"]?.type ?? null;
    if (type === PLAIN_DECK || type === LEGACY_PLAIN_DECK) return false; // it has no layout of its own
    const provider = await deckProviderFor(ctx.registry, type).catch(() => null);
    if (!provider?.module?.placement) return false;
    const place = provider.module.placement(doc);
    if (!place) {
      ctx.notify?.("That deck is already on a table.", "error");
      return true;
    }
    const b = place.bounds;
    const h = b ? Math.max(1e-4, b.max[1] - b.min[1]) : 0.001;
    const gid = ctx.newId("g");
    const ids = Array.from({ length: place.count }, () => ctx.newId("o"));
    ctx.change((d) => {
      if (!d.objects) d.objects = {};
      if (!d.order) d.order = [];
      d.objects[gid] = { kind: "group", name: `${place.name} (${place.count})`, group: group ?? null, visible: true, opacity: 1 };
      d.order.push(gid);
      ids.forEach((oid, j) => {
        d.objects[oid] = {
          name: place.look.name,
          sourceUrl: place.look.sourceUrl,
          providerId: "file-glb",
          renderUrl: null,
          parent: null,
          group: gid,
          visible: true,
          color: null,
          opacity: 1,
          wireframe: false,
          // face down, a card's height apart: turned about its length, a card stands on its top
          transform: { position: [0, +((j + 1) * h).toFixed(6), 0], rotation: [0, 0, Math.PI], scale: 1 },
          traits: { [HIDDEN]: { by: url } },
          ...(b ? { hint: { bounds: { min: [...b.min], max: [...b.max] } } } : {}),
        };
        d.order.push(oid);
      });
    });
    provider.module.bind?.(handle, ids);
    ctx.local.swap((l) => ({ ...l, selected: gid }));
    return true;
  },
};

/** The resolver factory for a deck doc's datatype: { create, module } or null. */
async function deckProviderFor(registry, type) {
  if (!type || type === PLAIN_DECK || type === LEGACY_PLAIN_DECK) return { create: plainResolver, module: null };
  const reg = await registry("tabletop:deck");
  const p = reg?.filter?.((x) => Array.isArray(x.supportedDatatypes) && x.supportedDatatypes.includes(type))?.[0];
  if (!p) return null;
  const module = (await reg.load(p.id))?.module ?? null;
  return module?.createResolver ? { create: module.createResolver, module } : null;
}

const SEAT_CSS = `
.scene-stage .tabletop-overlay:where(:not(.about-embed *), .about-embed .scene-tool *) { position: absolute; inset: 0; pointer-events: none; }
.scene-stage .tabletop-seatbar:where(:not(.about-embed *), .about-embed .scene-tool *) {
  position: absolute; top: 10px; left: 10px; display: flex; gap: 6px; align-items: center;
  padding: 4px 6px 4px 10px; border-radius: 999px; pointer-events: auto;
  background: var(--scene-panel-bg, rgb(255 255 255 / 0.9)); color: var(--scene-fg, #222);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.15); font: 13px system-ui, sans-serif;
}
.scene-stage .tabletop-seatbar[hidden]:where(:not(.about-embed *), .about-embed .scene-tool *) { display: none; }
.scene-stage .tabletop-seat:where(:not(.about-embed *), .about-embed .scene-tool *) { font: inherit; border-radius: 999px; padding: 2px 6px; }
`;

export { docUrl };
