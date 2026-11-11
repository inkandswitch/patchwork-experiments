// patchwork:tool "tabletop-game" — the game's page: what it is, its pieces,
// and "Set up a table", which lays the pieces out in a new scene and opens it.
// While open it keeps each piece's GLB drawn from its parts (pieces.js). An
// empty game offers every registered `tabletop:game` to start from.

import css from "./styles.css?inline";
import { ensurePieceGLBs } from "./pieces.js";
import { orderedKinds, tableLayout, writeTable } from "./setup.js";
import { sceneImportUrl, scenePatchwork } from "./scene-package.js";
import { emptyScene } from "./empty-scene.js";

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
      const fill = plugin?.module?.fill;
      if (typeof fill !== "function") throw new Error("it can't fill a game in");
      handle.change((d) => fill(d));
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
  function draw() {
    if (dead) return Promise.resolve();
    if (drawing) return drawing.then(draw);
    drawing = ensurePieceGLBs(repo, handle)
      .then(() => (drawError = null))
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
      const n = (d.tables?.length ?? 0) + 1;
      const title = `${d.title || "Game"} table ${n}`;
      // each kind shows the game's own GLB, which redraws when the game changes
      const fileOf = (kind) => {
        const p = d.pieces?.[kind];
        return p?.glbUrl ? { url: p.glbUrl, hint: p.bounds ? { bounds: p.bounds } : null } : null;
      };
      const layout = tableLayout(d, { fileOf, gameUrl: handle.url });
      // the decks first, so the scene never names one that isn't there
      const urls = {};
      for (const [deckId, deck] of Object.entries(layout.decks)) urls[deckId] = (await repo.create2({ ...deck, title: `${title}: ${deck.title}` })).url;
      // an empty scene as the scene makes one (every map and list it has;
      // the stage fills `packages` in), and where the scene package comes
      // from, for a viewer who doesn't have it
      const table = emptyScene({ "@patchwork": scenePatchwork(await sceneImportUrl()), title });
      writeTable(table, layout, urls);
      const scene = await repo.create2(table);
      handle.change((g) => {
        g.tables.push(scene.url);
      });
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
    const kinds = orderedKinds(d);
    const row = (kind) => {
      const p = d.pieces[kind];
      const name = el("input", { type: "text", value: p.name ?? kind, "aria-label": "Name", onchange: (e) => handle.change((g) => (g.pieces[kind].name = e.target.value)) });
      const count = el("input", {
        type: "number",
        min: "0",
        step: "1",
        value: String(p.count ?? 0),
        "aria-label": "How many",
        onchange: (e) => handle.change((g) => (g.pieces[kind].count = Math.max(0, Math.round(Number(e.target.value) || 0)))),
      });
      const locked = el("input", { type: "checkbox", checked: !!p.locked, onchange: (e) => handle.change((g) => (g.pieces[kind].locked = e.target.checked)) });
      return el(
        "tr",
        {},
        el("td", { class: "swatches" }, colorsOf(p).map((c) => el("span", { class: "swatch", style: `background:${c}`, title: c }))),
        el("td", {}, name),
        el("td", {}, count),
        el("td", {}, el("label", { class: "toggle", title: "Set up locked in place (a board)" }, locked, " fixed")),
        el("td", { class: "muted" }, [p.zone?.seat ? `${d.seats?.[p.zone.seat]?.name ?? p.zone.seat}'s private zone` : "", p.snapPoints?.length ? `${p.snapPoints.length} spaces` : ""].filter(Boolean).join(", ")),
      );
    };
    const table = (list) =>
      el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", {}, "Name"), el("th", {}, "Count"), el("th", {}, ""), el("th", {}, ""))), el("tbody", {}, list.map(row)));
    // hidden kinds go in their deck's own fold: a deck of cards is a long list
    const decks = Object.entries(d.decks ?? {}).map(([deckId, deck]) => {
      const inDeck = kinds.filter((k) => d.pieces[k].hidden && (d.pieces[k].deck ?? null) === deckId);
      const total = inDeck.reduce((n, k) => n + (Number(d.pieces[k].count) || 0), 0);
      const deals = (deck.deal ?? []).map((x) => `${x.count} to ${d.pieces[x.to]?.name ?? x.to}`).join(", ");
      return el(
        "details",
        { class: "deck" },
        el("summary", {}, `${deck.name || deckId}: ${total} cards of ${inDeck.length} kinds, shuffled${deck.secure ? " by the players" : ""}${deck.faceDown ? " face down" : ""}${deals ? `; deals ${deals}` : ""}`),
        el(
          "label",
          { class: "toggle", title: "With the card-table package installed: the seated players' own clients shuffle the deck, encrypted, so nobody knows its order and nobody can read a card they aren't shown. Without it, the cards are hidden from the table but listed in an ordinary document." },
          el("input", { type: "checkbox", checked: !!deck.secure, onchange: (e) => handle.change((g) => (g.decks[deckId].secure = e.target.checked)) }),
          " The players shuffle it between them (needs every player at the table)",
        ),
        table(inDeck),
      );
    });
    const shown = kinds.filter((k) => !d.pieces[k].hidden || !d.decks?.[d.pieces[k].deck]);
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

  function definitionSection(d) {
    const text = JSON.stringify(
      {
        order: d.order ?? [],
        pieces: Object.fromEntries(orderedKinds(d).map((k) => [k, strip(d.pieces[k])])),
        ...(d.seats ? { seats: d.seats } : {}),
        ...(d.decks ? { decks: d.decks } : {}),
        ...(d.camera ? { camera: d.camera } : {}),
      },
      null,
      2,
    );
    const area = el("textarea", { class: "json", spellcheck: "false", rows: "16" });
    area.value = text;
    const msg = el("span", { class: "muted" }, definitionMsg);
    const say = (text) => (msg.textContent = definitionMsg = text);
    const apply = el("button", {
      type: "button",
      class: "button",
      onclick: () => {
        let next;
        try {
          next = JSON.parse(area.value);
          if (!next || typeof next.pieces !== "object") throw new Error("expected { order, pieces }");
        } catch (err) {
          say(`Not applied: ${err.message}`);
          return;
        }
        definitionMsg = "Applied.";
        handle.change((g) => {
          const old = g.pieces ?? {};
          const pieces = {};
          for (const [k, p] of Object.entries(next.pieces)) {
            // keep each kind's GLB doc, so tables already set up redraw in place
            pieces[k] = { ...p, glbUrl: old[k]?.glbUrl ?? null, glbKey: old[k]?.glbKey ?? null };
          }
          g.pieces = pieces;
          g.order = Array.isArray(next.order) ? next.order.filter((k) => typeof k === "string") : Object.keys(pieces);
          for (const key of ["seats", "decks", "camera"]) {
            if (next[key] && typeof next[key] === "object") g[key] = next[key];
            else delete g[key];
          }
        });
        say("Applied.");
      },
    }, "Apply");
    return el("details", { class: "definition", open: definitionOpen, ontoggle: (e) => (definitionOpen = e.target.open) }, el("summary", {}, "Definition (JSON)"), area, el("div", { class: "cluster" }, apply, msg));
  }
  const strip = (p) => {
    const { glbUrl, glbKey, bounds, ...rest } = JSON.parse(JSON.stringify(p));
    return rest;
  };

  function render() {
    if (dead) return;
    const d = doc();
    const kinds = orderedKinds(d);
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    // don't rebuild under someone typing in a field of ours
    if (focused && /^(INPUT|TEXTAREA)$/.test(focused.tagName) && rendered) return void updateStatus();
    rendered = true;

    const title = el("input", { type: "text", class: "title", value: d.title ?? "", "aria-label": "Title", onchange: (e) => handle.change((g) => (g.title = e.target.value)) });
    const setUp = el("button", { type: "button", class: "button primary", disabled: settingUp || !kinds.length, onclick: setUpTable }, settingUp ? "Setting up…" : "Set up a table");
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
    );
    updateStatus();
  }

  function updateStatus() {
    const s = root.querySelector(".status");
    if (!s) return;
    const d = doc();
    const kinds = orderedKinds(d);
    const total = kinds.reduce((n, k) => n + (Number(d.pieces[k].count) || 0), 0);
    s.textContent =
      status ??
      (drawError ? `Pieces couldn't be drawn: ${drawError}` : drawing ? "Drawing pieces…" : kinds.length ? `${total} pieces of ${kinds.length} kinds.` : "");
  }

  const onChange = () => {
    status = null;
    render();
    drawSoon();
  };
  handle.on("change", onChange);
  render();
  if (orderedKinds(doc()).length) draw();

  return () => {
    dead = true;
    clearTimeout(drawTimer);
    offRegistry?.();
    handle.off("change", onChange);
    root.remove();
    style.remove();
  };
}
