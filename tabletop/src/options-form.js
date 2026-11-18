// A game's options (GAME-FORMAT.md §6, its recipe's `options`) as a few
// controls, for the game page's "Set up a table" and the launcher's New
// game: a picker for an integer (each value in its range) or a choice, a
// checkbox for a yes or no. Plain DOM; `values` is the caller's to keep.

import { optionValues, optionsOf, valuesOf } from "../contract/v2/recipe.js";

/**
 * @param {object} game  @param {object} values  what's chosen so far (a default for each not given)
 * @param {(key: string, value: unknown) => void} onChange  @param {string} [label]  for each control's aria-label
 * @returns {HTMLElement | null}  null for a game that asks nothing
 */
export function optionsForm(game, values, onChange, label = "") {
  const options = optionsOf(game);
  if (!options.length) return null;
  const now = optionValues(game, values) ?? optionValues(game, {}) ?? {};
  const box = document.createElement("span");
  box.className = "options";
  for (const o of options) {
    const name = `${label ? `${label}: ` : ""}${o.label ?? o.key}`;
    if (o.kind === "boolean") {
      const row = document.createElement("label");
      row.className = "option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!now[o.key];
      input.dataset.key = o.key;
      input.addEventListener("change", () => onChange(o.key, input.checked));
      row.append(input, ` ${o.label ?? o.key}`);
      box.append(row);
      continue;
    }
    const select = document.createElement("select");
    select.className = "option";
    select.dataset.key = o.key;
    select.setAttribute("aria-label", name);
    select.title = o.label ?? o.key;
    for (const v of valuesOf(o)) {
      const opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = o.kind === "enum" ? ((o.options ?? []).find((x) => x.value === v)?.label ?? String(v)) : `${v} ${String(o.label ?? o.key).toLowerCase()}`;
      opt.selected = v === now[o.key];
      select.append(opt);
    }
    select.addEventListener("change", () => onChange(o.key, valuesOf(o).find((v) => String(v) === select.value)));
    box.append(select);
  }
  return box;
}
