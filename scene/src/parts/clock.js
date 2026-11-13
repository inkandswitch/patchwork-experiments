// scene.clock (always on): the clock chip (TOOLS.md §6, §7). It shows the
// doc's world time as the stage publishes it in local.clock (the clock's
// status: src/stage/clock.js), and only for a doc with a process: ▶ while it
// runs, ⏸ "Paused by Ana" while it doesn't, and its one button pauses or
// resumes it (anyone who may write: the lead's decision 5). Who computes is
// shown only when it's news: on a stall ("waiting for Ben's machine") or
// when nobody here can ("nobody here can run it: view only"). Notices are
// aria-live. No keys.
//
// It sits in a slim bar on the stage's top edge, the seed of TOOLS.md §6's
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
  const chip = document.createElement("div");
  chip.className = "clock-chip";
  chip.setAttribute("role", "status");
  chip.setAttribute("aria-live", "polite");
  const text = document.createElement("span");
  text.className = "clock-text";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button clock-toggle";
  chip.append(text, button);
  bar.append(chip);

  let dead = false;
  let shown = null;
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
            render(api.local.get().clock);
          })
          .catch(() => {});
    }
    return names.get(viewer) ?? "someone";
  }

  function render(status) {
    const c = chipOf(status, name);
    if (!c) {
      bar.hidden = true;
      shown = null;
      return;
    }
    bar.hidden = false;
    const writable = api.writable();
    const key = JSON.stringify([c, writable]);
    if (key === shown) return;
    shown = key;
    text.textContent = `${c.icon} ${c.text}`;
    button.textContent = c.label;
    button.dataset.action = c.action;
    button.hidden = !writable;
    button.title = c.action === "pause" ? "Pause the world here, for everyone" : "Let the world run again, for everyone";
  }
  button.addEventListener("click", () => {
    if (button.dataset.action === "pause") api.clock.pause();
    else api.clock.resume();
  });

  render(api.local.get().clock);

  return {
    update(scene, local, prev) {
      if (local.clock !== prev?.local?.clock) render(local.clock);
    },
    dispose() {
      dead = true;
    },
  };
}

export default { create };
