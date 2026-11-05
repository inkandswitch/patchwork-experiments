// scene.activity (always on): what this viewer is doing in the scene, and
// switching it. The stage publishes the activity that runs and the ones the
// scene offers as local.activities ({ current, available }); this shows them
// as a segmented control at the bottom left of the view ("Play | Edit"), but
// only when there is a choice: a plain model offers only editing, so it shows
// nothing. Pressing one writes local.activity, this viewer's alone (STAGE.md,
// "Activities"); the stage then stops what the old activity ran and starts
// what the new one calls for. No keys.

import css from "./activity.css?inline";
import { activityLabel } from "../activities.js";

export { activityLabel };

/**
 * The order the switcher shows them in: what the scene is for first
 * (registry order), and editing, which every scene offers, last. Pure.
 * @param {string[]} available
 */
export const switcherOrder = (available) => [...available.filter((a) => a !== "edit"), ...available.filter((a) => a === "edit")];

function create(api) {
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("activity-layer");
  const bar = document.createElement("div");
  bar.className = "activity-switch";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "What you're doing here");
  bar.hidden = true;
  overlay.append(bar);

  let shownKey = "";

  function render(activities) {
    const available = Array.isArray(activities?.available) ? activities.available : [];
    const current = activities?.current ?? null;
    const choice = available.length > 1;
    if (bar.hidden === choice) bar.hidden = !choice;
    if (!choice) return;
    const order = switcherOrder(available);
    const key = order.join("\n");
    if (key !== shownKey) {
      shownKey = key;
      bar.replaceChildren(
        ...order.map((id) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "button activity-option";
          b.dataset.activity = id;
          b.textContent = activityLabel(id);
          b.addEventListener("click", () => {
            api.local.swap((m) => (m.activity === id ? m : { ...m, activity: id }));
          });
          return b;
        }),
      );
    }
    for (const b of bar.querySelectorAll("button[data-activity]")) {
      const on = b.dataset.activity === current;
      b.setAttribute("aria-pressed", String(on));
      b.title = on ? `You're in ${activityLabel(b.dataset.activity)}` : `Switch to ${activityLabel(b.dataset.activity)} (only for you)`;
    }
  }

  render(api.local.get().activities);

  return {
    update(scene, local, prev) {
      if (local.activities !== prev?.local?.activities) render(local.activities);
    },
  };
}

export default { create };
