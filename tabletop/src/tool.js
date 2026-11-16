// patchwork:tool "tabletop-game" — the game's page: what it is, its pieces,
// and "Set up a table", which lays the game out in a new scene and opens it.
// While open it keeps each piece's GLB drawn from what it is (pieces.js). An
// empty game offers every registered `tabletop:game` to start from, and the
// whole game is editable as JSON (GAME-FORMAT.md), checked before it's kept.

import css from "./styles.css?inline";
import { ensurePieceGLBs } from "./pieces.js";
import { isCard, tableLayout, writeTable } from "./setup.js";
import { sceneImportUrl, scenePatchwork } from "./scene-package.js";
import { findSeats, findSource, hostRegistry, makeHolders, tableNotes } from "./table/made-with.js";
import { emptyScene } from "./empty-scene.js";
import { gameOf, writeGame } from "./game.js";
import { defaultImages } from "./look/images.js";
import { errorText, validate } from "../contract/v1/validate.js";

const OPEN_EVENT = "patchwork:open-document";
const DRAW_DEBOUNCE_MS = 400;

const el = (tag, props = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    else if (k in n && typeof v !== "string") n[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...children.flat().filter((c) => c != null));
  return n;
};

const colorsOf = (piece) => [...new Set((piece.parts ?? []).map((p) => p.color).filter((c) => /^#[0-9a-f]{6}$/i.test(c ?? "")))];
/** A game's piece kinds, in the order they're written. */
const kindsOf = (d) => Object.keys(d?.pieces ?? {});
/** Every deck in a game's setup, contents too: [{ deck, at }]. */
function decksOf(things, out = []) {
  for (const t of things ?? []) {
    if (t.deck) out.push(t);
    decksOf(t.contents, out);
  }
  return out;
}
/** What a thing of the setup is called (its id's): its own name, else its piece's. */
function thingName(d, id, things = d.setup) {
  for (const t of things ?? []) {
    if (t.id === id) return t.name ?? d.pieces?.[t.piece]?.name ?? id;
    const inner = thingName(d, id, t.contents ?? []);
    if (inner !== id) return inner;
  }
  return id;
}
/** How many copies of each kind a fresh table has: { [kind]: n } (a deck's cards counted, contents too). */
function copiesOf(things, out = {}) {
  for (const t of things ?? []) {
    if (t.deck) for (const k of t.deck.cards ?? []) out[k] = (out[k] ?? 0) + 1;
    else out[t.piece] = (out[t.piece] ?? 0) + Math.max(1, Number(t.count) || 1);
    copiesOf(t.contents, out);
  }
  return out;
}

export default function TabletopGameTool(handle, element) {
  const repo = element.repo ?? globalThis.repo;
  const style = document.createElement("style");
  style.textContent = css;
  const root = el("div", { class: "tabletop-game" });
  element.append(style, root);
  let dead = false;
  let status = null; // a message that outranks the usual status line until the next change
  let rendered = false;
  let definitionOpen = false;
  let definitionMsg = ""; // the last Apply's outcome; survives the re-render that applying causes

  const doc = () => handle.doc() ?? {};

  // ─── the games there are to start from ────────────────────────────────────
  let games = null; // null while the registry loads; then [{ id, name, players, blurb, load }]
  import("@inkandswitch/patchwork-plugins")
    .then((m) => {
      const registry = m.getRegistry("tabletop:game");
      const list = () => {
        games = (registry.filter?.(() => true) ?? []).filter((g) => g?.id);
        if (!dead) render();
      };
      list();
      const off = registry.on?.("changed", list);
      if (typeof off === "function") offRegistry = off;
    })
    .catch((err) => {
      console.warn("[tabletop] no plugin registry", err);
      games = [];
      if (!dead) render();
    });
  let offRegistry = null;

  async function startFrom(game) {
    try {
      const plugin = await (await import("@inkandswitch/patchwork-plugins")).getRegistry("tabletop:game").load(game.id);
      const g = plugin?.module?.default ?? plugin?.module;
      const checked = validate(g);
      if (!checked.ok) throw new Error(errorText(checked));
      handle.change((d) => writeGame(d, g));
    } catch (err) {
      status = `Couldn't start from ${game.name}: ${err?.message ?? err}`;
      render();
    }
  }
  const open = (url, toolId) => element.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { url, toolId }, bubbles: true, composed: true }));

  // ─── keeping the piece GLBs drawn ─────────────────────────────────────────
  let drawing = null;
  let drawTimer = null;
  let drawError = null;
  let drawNotes = [];
  function draw() {
    if (dead) return Promise.resolve();
    if (drawing) return drawing.then(draw);
    drawing = ensurePieceGLBs(repo, handle, { images: defaultImages(), source: (type) => findSource(hostRegistry, type) })
      .then(({ notes }) => {
        drawError = null;
        drawNotes = notes;
      })
      .catch((err) => {
        drawError = err?.message ?? String(err);
        console.warn("[tabletop] drawing pieces failed", err);
      })
      .finally(() => {
        drawing = null;
        render();
      });
    render();
    return drawing;
  }
  const drawSoon = () => {
    clearTimeout(drawTimer);
    drawTimer = setTimeout(draw, DRAW_DEBOUNCE_MS);
  };

  // ─── setting up a table ───────────────────────────────────────────────────
  let settingUp = false;
  async function setUpTable() {
    if (settingUp) return;
    settingUp = true;
    render();
    try {
      clearTimeout(drawTimer);
      await draw();
      if (drawError) throw new Error(drawError);
      const d = doc();
      const checked = validate(gameOf(d));
      if (!checked.ok) throw new Error(`the game isn't valid: ${errorText(checked)}`);
      const n = (d.tables?.length ?? 0) + 1;
      const title = `${d.title || "Game"} table ${n}`;
      // each kind shows the game's own GLB, which redraws when the game changes
      const fileOf = (kind) => {
        const f = d.drawn?.[kind];
        return f?.url ? { url: f.url, hint: f.bounds ? { bounds: f.bounds } : null } : null;
      };
      const layout = tableLayout(gameOf(d), { fileOf, gameUrl: handle.url });
      // the decks' containers and the bags first (from a keeper and a bag maker, found in the
      // registry by what they are: table/made-with.js), so the scene never names one that isn't there
      const made = await makeHolders({ repo, registry: hostRegistry }, layout);
      // the seats are their owner's to write (none where nothing installed owns seats)
      const lay = Object.keys(layout.seats).length ? await findSeats(hostRegistry) : null;
      // an empty scene as the scene makes one (every map and list it has;
      // the stage fills `packages` in), and where the scene package comes
      // from, for a viewer who doesn't have it
      const table = emptyScene({ "@patchwork": scenePatchwork(await sceneImportUrl()), title });
      writeTable(table, layout, made, { seats: lay });
      const scene = await repo.create2(table);
      handle.change((g) => {
        if (!g.tables) g.tables = [];
        g.tables.push(scene.url);
      });
      // what the maker is owed: bags not laid out, a secure deck kept in the open, seats nobody owns
      const notes = tableNotes(layout, made, lay);
      if (notes.length) status = notes.join(" ");
      open(scene.url, "scene");
    } catch (err) {
      status = `Couldn't set up a table: ${err?.message ?? err}`;
    } finally {
      settingUp = false;
      render();
    }
  }

  // ─── view ─────────────────────────────────────────────────────────────────
  const titles = new Map(); // table url → its title, once looked up
  function tableTitle(url) {
    if (!titles.has(url)) {
      titles.set(url, null);
      Promise.resolve(repo?.find?.(url))
        .then((h) => {
          titles.set(url, h?.doc()?.title ?? null);
          if (!dead) render();
        })
        .catch(() => {});
    }
    return titles.get(url) || "Table";
  }

  function piecesSection(d) {
    const kinds = kindsOf(d);
    const copies = copiesOf(d.setup);
    const what = (p) =>
      [
        p.back ? `a card (its back: ${d.pieces[p.back]?.name ?? p.back})` : "",
        p.zone ? "a hand" : "",
        p.bag ? `a bag (${p.bag.rule})` : "",
        p.doc ? `drawn as a ${p.doc?.["@patchwork"]?.type ?? "document"}` : "",
        p.snapPoints?.length ? `${p.snapPoints.length} spaces` : "",
      ]
        .filter(Boolean)
        .join(", ");
    const row = (kind) => {
      const p = d.pieces[kind];
      const name = el("input", { type: "text", value: p.name ?? kind, "aria-label": "Name", onchange: (e) => handle.change((g) => (g.pieces[kind].name = e.target.value || kind)) });
      const locked = el("input", { type: "checkbox", checked: !!p.locked, onchange: (e) => handle.change((g) => (e.target.checked ? (g.pieces[kind].locked = true) : delete g.pieces[kind].locked)) });
      return el(
        "tr",
        {},
        el("td", { class: "swatches" }, colorsOf(p).map((c) => el("span", { class: "swatch", style: `background:${c}`, title: c }))),
        el("td", {}, name),
        el("td", { class: "muted" }, String(copies[kind] ?? 0)),
        el("td", {}, el("label", { class: "toggle", title: "Set up locked in place (a board)" }, locked, " fixed")),
        el("td", { class: "muted" }, what(p)),
      );
    };
    const table = (list) =>
      el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", {}, "Name"), el("th", {}, "On a table"), el("th", {}, ""), el("th", {}, ""))), el("tbody", {}, list.map(row)));
    // a deck of cards is a long list: each in its own fold
    const decks = decksOf(d.setup).map((t, i) => {
      const deck = t.deck;
      const inDeck = [...new Set(deck.cards ?? [])];
      const deals = (deck.deal ?? []).map((x) => `${x.count} to ${thingName(d, x.to)}`).join(", ");
      const path = deckPath(d.setup, t);
      return el(
        "details",
        { class: "deck" },
        el("summary", {}, `${deck.name || `Deck ${i + 1}`}: ${deck.cards?.length ?? 0} cards of ${inDeck.length} kinds${deck.secure ? ", shuffled by the players" : deck.shuffle ? ", shuffled" : ""}${deck.faceDown ? " face down" : ""}${deals ? `; deals ${deals}` : ""}`),
        el(
          "label",
          { class: "toggle", title: "With a keeper whose players shuffle installed: the seated players' own clients shuffle the deck, encrypted, so nobody knows its order and nobody can read a card they aren't shown. Without one, the cards are hidden from the table but listed in an ordinary document." },
          el("input", { type: "checkbox", checked: !!deck.secure, onchange: (e) => handle.change((g) => {
            const dk = path.reduce((x, k) => x[k], g.setup).deck;
            if (e.target.checked) dk.secure = true;
            else delete dk.secure;
          }) }),
          " The players shuffle it between them (needs every player at the table)",
        ),
        table(inDeck.filter((k) => d.pieces[k])),
      );
    });
    const shown = kinds.filter((k) => !isCard(d, k));
    const seats = Object.values(d.seats ?? {}).map((s) => s.name).filter(Boolean);
    return el(
      "section",
      { class: "pieces" },
      el("h3", {}, "Pieces"),
      seats.length ? el("p", { class: "muted" }, `Seats: ${seats.join(", ")}.`) : null,
      table(shown),
      decks,
    );
  }
  /** Where a deck thing is in the setup, as keys into it ([i] or [i, "contents", j, …]). */
  function deckPath(setup, target, path = []) {
    for (const [i, t] of (setup ?? []).entries()) {
      if (t === target) return [...path, i];
      const inner = deckPath(t.contents, target, [...path, i, "contents"]);
      if (inner) return inner;
    }
    return null;
  }

  function definitionSection(d) {
    const area = el("textarea", { class: "json", spellcheck: "false", rows: "16" });
    area.value = JSON.stringify(gameOf(d), null, 2);
    const msg = el("span", { class: "muted" }, definitionMsg);
    const say = (text) => (msg.textContent = definitionMsg = text);
    const apply = el(
      "button",
      {
        type: "button",
        class: "button",
        onclick: () => {
          let next;
          try {
            next = JSON.parse(area.value);
          } catch (err) {
            say(`Not applied: ${err.message}`);
            return;
          }
          const checked = validate(next);
          if (!checked.ok) {
            say(`Not applied: ${errorText(checked)}`);
            return;
          }
          definitionMsg = "Applied.";
          // each kind keeps its GLB doc, so tables already set up redraw in place
          handle.change((g) => writeGame(g, next));
          say("Applied.");
        },
      },
      "Apply",
    );
    return el("details", { class: "definition", open: definitionOpen, ontoggle: (e) => (definitionOpen = e.target.open) }, el("summary", {}, "Definition (JSON: the tabletop-game format)"), area, el("div", { class: "cluster" }, apply, msg));
  }

  function render() {
    if (dead) return;
    const d = doc();
    const kinds = kindsOf(d);
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    // don't rebuild under someone typing in a field of ours
    if (focused && /^(INPUT|TEXTAREA)$/.test(focused.tagName) && rendered) return void updateStatus();
    rendered = true;

    const title = el("input", { type: "text", class: "title", value: d.title ?? "", "aria-label": "Title", onchange: (e) => handle.change((g) => (g.title = e.target.value)) });
    const setUp = el("button", { type: "button", class: "button primary", disabled: settingUp || !(d.setup ?? []).length, onclick: setUpTable }, settingUp ? "Setting up…" : "Set up a table");
    const about = el("textarea", { class: "about", rows: "8", placeholder: "What the game is, and how it's played…", onchange: (e) => handle.change((g) => (g.about = e.target.value)) });
    about.value = d.about ?? "";

    const empty = kinds.length
      ? null
      : el(
          "section",
          { class: "empty" },
          el("p", {}, "This game has no pieces yet. Start from one of these:"),
          games == null
            ? el("p", { class: "muted" }, "Looking for games…")
            : games.length
              ? el(
                  "ul",
                  { class: "games" },
                  games.map((g) =>
                    el(
                      "li",
                      {},
                      el("button", { type: "button", class: "button", onclick: () => startFrom(g) }, g.name ?? g.id),
                      el("span", { class: "muted" }, [g.players ? `${g.players} players. ` : "", g.blurb ?? ""].join("")),
                    ),
                  ),
                )
              : el("p", { class: "muted" }, "No games are installed."),
          el("p", { class: "muted" }, "Or describe pieces in the definition below."),
        );

    const tables = (d.tables ?? []).filter((u) => typeof u === "string");
    root.replaceChildren(
      ...[
      el("header", { class: "head" }, title, setUp),
      el("p", { class: "status muted" }),
      empty,
      about,
      kinds.length ? piecesSection(d) : null,
      tables.length
        ? el(
            "section",
            { class: "tables" },
            el("h3", {}, "Tables"),
            el("ul", {}, tables.map((u) => el("li", {}, el("a", { href: "#", onclick: (e) => (e.preventDefault(), open(u, "scene")) }, tableTitle(u))))),
          )
        : null,
      definitionSection(d),
      ].filter(Boolean),
    );
    updateStatus();
  }

  function updateStatus() {
    const s = root.querySelector(".status");
    if (!s) return;
    const d = doc();
    const kinds = kindsOf(d);
    const total = Object.values(copiesOf(d.setup)).reduce((n, k) => n + k, 0);
    const notes = drawNotes.length ? ` ${drawNotes.length} note${drawNotes.length === 1 ? "" : "s"} on drawing them: ${drawNotes.slice(0, 3).join("; ")}${drawNotes.length > 3 ? "; …" : ""}` : "";
    s.textContent =
      status ??
      (drawError ? `Pieces couldn't be drawn: ${drawError}` : drawing ? "Drawing pieces…" : kinds.length ? `${total} pieces of ${kinds.length} kinds.${notes}` : "");
  }

  const onChange = () => {
    status = null;
    render();
    drawSoon();
  };
  handle.on("change", onChange);
  render();
  if (kindsOf(doc()).length) draw();

  return () => {
    dead = true;
    clearTimeout(drawTimer);
    offRegistry?.();
    handle.off("change", onChange);
    root.remove();
    style.remove();
  };
}
