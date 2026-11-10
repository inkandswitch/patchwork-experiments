// scene.packages: the prompt for the packages a scene lists and this viewer
// doesn't have (STAGE.md, "Packages"). One card for all of them, over the
// view in every activity:
//   - asked about: "This scene uses 2 packages you don't have.", each by its
//     own name and its URL, with Load and Not now;
//   - loading: the same rows, greyed, with nothing to press;
//   - failed: the row says why, with Try again and Dismiss.
// The stage decides what's in each list (local.packages) and does the
// loading (api.packages); this only shows it and passes on the click.

import css from "./packages.css?inline";
import { promptText, shortUrl } from "../packages.js";

/**
 * What the card says: `{ title, rows: [{ url, name, short, state, error? }],
 * actions: [{ id, label, primary? }], warn }`, or null when there's nothing
 * to say. Asking comes before failures, and both before loading; the
 * actions are for what's asked about, else for what failed. Pure.
 * @param {{ ask?: object[], loading?: object[], failed?: object[] } | null} p  local.packages
 */
export function cardOf(p) {
  const ask = p?.ask ?? [];
  const loading = p?.loading ?? [];
  const failed = p?.failed ?? [];
  if (!ask.length && !loading.length && !failed.length) return null;
  const row = (state) => (e) => ({ url: e.url, name: e.name || null, short: shortUrl(e.url), state, ...(e.error ? { error: e.error } : {}) });
  const rows = [...ask.map(row("ask")), ...failed.map(row("failed")), ...loading.map(row("loading"))];
  const title = ask.length
    ? promptText(ask.length)
    : failed.length
      ? failed.length === 1
        ? "A package this scene uses couldn't be loaded."
        : `${failed.length} packages this scene uses couldn't be loaded.`
      : loading.length === 1
        ? "Loading a package this scene uses…"
        : `Loading ${loading.length} packages this scene uses…`;
  const actions = ask.length
    ? [
        { id: "dismiss", label: "Not now" },
        { id: "load", label: ask.length === 1 ? "Load it" : "Load them", primary: true },
      ]
    : failed.length
      ? [
          { id: "dismiss", label: "Dismiss" },
          { id: "load", label: "Try again", primary: true },
        ]
      : [];
  return { title, rows, actions, warn: ask.length > 0 };
}

function create(api) {
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("packages-layer");
  const card = document.createElement("div");
  card.className = "packages-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Packages this scene uses");
  card.hidden = true;
  overlay.append(card);
  let key = "";

  const el = (tag, className, text) => {
    const e = document.createElement(tag);
    e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };

  function render(p) {
    const c = cardOf(p);
    const next = JSON.stringify(c);
    if (next === key) return;
    key = next;
    card.hidden = !c;
    if (!c) return card.replaceChildren();
    const list = el("ul", "packages-list");
    for (const r of c.rows) {
      const li = el("li", "package");
      li.dataset.state = r.state;
      li.dataset.url = r.url;
      li.title = r.url;
      // the name is the package's own word for itself; the URL is what will be loaded
      if (r.name) li.append(el("span", "package-name", r.name));
      li.append(el("span", "package-url", r.short));
      if (r.error) li.append(el("span", "package-error", r.error));
      list.append(li);
    }
    const parts = [el("div", "packages-title", c.title), list];
    if (c.warn) parts.push(el("div", "packages-warning", "Loading a package runs its code here, as you. Load only what you trust."));
    if (c.actions.length) {
      const actions = el("div", "packages-actions");
      for (const a of c.actions) {
        const b = el("button", a.primary ? "button primary" : "button", a.label);
        b.type = "button";
        b.dataset.action = a.id;
        actions.append(b);
      }
      parts.push(actions);
    }
    card.replaceChildren(...parts);
  }

  api.listen(card, "click", (e) => {
    const action = e.target?.closest?.("[data-action]")?.dataset.action;
    if (action === "load") void api.packages.load();
    else if (action === "dismiss") api.packages.dismiss();
  });

  return {
    update(scene, local, prev) {
      if (local.packages !== prev?.local?.packages) render(local.packages);
    },
  };
}

export default { create };
