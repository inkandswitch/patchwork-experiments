// scene.clock-chip (always on): the clock chips (EDITOR.md, "The interface").
// One chip for each doc on the focus path that has a clock to show,
// outermost first: its world time as its stage's "clock" service says it
// (its status: src/native/clock.js), heard through each stage's reader. A doc
// shows a chip only with a process: ▶ while it runs, ⏸ "Paused by Ana"
// while it doesn't, and its one button pauses or resumes that doc (anyone
// who may write it: the lead's decision 5). Who computes is shown only when it's news: on a stall
// ("waiting for Ben's machine") or when nobody here can ("nobody here can run
// it: view only"). While the focus is inside a link each chip names its doc
// (the trail's name for it); at the outermost there is one
// doc and no name. Notices
// are aria-live. No keys.
//
// It sits in a slim bar on the stage's top edge, the seed of EDITOR.md, "The interface"'s
// world bar, beside the view rather than over it: the view's corners and its
// top middle are games' (seats' picker, an arena's lobby, a ship's hint).

import css from "./clock.css?inline";

/**
 * What the chip says, from the clock's status and a way to name a viewer
 * ("you" for this one). null: no chip. Pure.
 * @param {{ running: boolean, by: string | null, computer: { viewer: string | null, mine: boolean } | null, stalled: boolean, able: boolean, why: string | null } | null} status
 * @param {(viewer: string | null) => string} name
 * @returns {{ icon: string, text: string, action: "pause" | "resume", label: string } | null}
 */
export function chipOf(status, name) {
  if (!status) return null;
  if (!status.running) return { icon: "⏸", text: status.by ? `Paused by ${name(status.by)}` : "Paused", action: "resume", label: "Resume" };
  let text = "Running";
  if (status.computer && !status.computer.mine && status.stalled) text = `Waiting for ${possessive(name(status.computer.viewer))} machine`;
  else if (!status.computer && !status.able) text = `Nobody here can run it${status.why && status.why !== "no process" ? ` (${status.why})` : ""}`;
  return { icon: "▶", text, action: "pause", label: "Pause" };
}

const possessive = (n) => (n === "you" ? "your" : /s$/.test(n) ? `${n}'` : `${n}'s`);

function create(api) {
  api.style(css);
  const bar = api.edge("top");
  bar.classList.add("clock-bar");
  bar.hidden = true;

  let dead = false;
  let shown = null;
  const chips = new Map(); // stage → { el, doc, text, button }
  const names = new Map(); // viewer → their contact's name; null while asking, or if it has none
  function name(viewer) {
    if (viewer && viewer === api.viewer) return "you";
    if (typeof viewer !== "string" || !viewer) return "someone";
    if (!names.has(viewer)) {
      names.set(viewer, null);
      if (viewer.startsWith("automerge:"))
        Promise.resolve(api.repo?.find?.(viewer))
          .then((h) => {
            const n = h?.doc?.()?.name;
            if (dead || typeof n !== "string" || !n.trim()) return;
            names.set(viewer, n.trim());
            shown = null;
            render();
          })
          .catch(() => {});
    }
    return names.get(viewer) ?? "someone";
  }

  function chipEl(stage) {
    let c = chips.get(stage);
    if (c) return c;
    const el = document.createElement("div");
    el.className = "clock-chip";
    el.dataset.stage = String(stage);
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    const doc = document.createElement("span");
    doc.className = "clock-doc";
    const text = document.createElement("span");
    text.className = "clock-text";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button clock-toggle";
    el.append(doc, text, button);
    button.addEventListener("click", () => {
      const c = readerOf(stage)?.use("clock");
      if (button.dataset.action === "pause") c?.pause();
      else c?.resume();
    });
    chips.set(stage, (c = { el, doc, text, button }));
    return c;
  }

  // the focus path's stages, as the view's readers (the outermost last)
  const path = () => api.path({ focus: true });
  const readerOf = (stage) => path().find((r) => r.stage === stage) ?? null;

  const heard = new Set(); // the stages whose clocks it hears (each stage's lasts while it's open)
  /** What the trail calls the doc of reader `r` (`readers` the focus path, innermost first): the outermost's title, else its host's name for the link. */
  const docName = (r, readers) => (r.path.length ? readers.find((x) => x.path.length === r.path.length - 1)?.nameOf(r.path.at(-1)) || "Linked scene" : String(r.scene().d?.title || "Scene"));

  function render() {
    const readers = path();
    // (inside a link there is more than one doc on the path: each chip says whose)
    const named = readers.length > 1;
    const items = [];
    for (const r of [...readers].reverse()) {
      const clock = r.use("clock");
      if (clock && !heard.has(r.stage)) heard.add(r.stage) && clock.watch(render);
      const c = clock ? chipOf(clock.status(), name) : null;
      if (c) items.push({ stage: r.stage, chip: c, doc: named ? docName(r, readers) : "", writable: !!r.writable() });
    }
    const key = JSON.stringify(items);
    if (key === shown) return;
    shown = key;
    bar.hidden = !items.length;
    const els = [];
    for (const it of items) {
      const c = chipEl(it.stage);
      c.doc.textContent = it.doc;
      c.doc.hidden = !it.doc;
      c.text.textContent = `${it.chip.icon} ${it.chip.text}`;
      c.button.textContent = it.chip.label;
      c.button.dataset.action = it.chip.action;
      c.button.hidden = !it.writable;
      c.button.title = it.chip.action === "pause" ? `Pause ${it.doc || "the world here"}, for everyone` : `Let ${it.doc || "the world"} run again, for everyone`;
      els.push(c.el);
    }
    for (const [stage, c] of [...chips]) if (!items.some((it) => it.stage === stage)) (c.el.remove(), chips.delete(stage));
    bar.replaceChildren(...els);
  }

  render();

  return {
    update: render,
    dispose() {
      dead = true;
    },
  };
}

export default { create };
