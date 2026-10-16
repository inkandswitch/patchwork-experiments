// A form built from ParamSpec metadata. Vanilla DOM; builds once per spec list
// and then only updates values, so typing into a field is never clobbered.

import { coerceParam, stableStringify } from "./staleness.js";

export { coerceParam };

// log sliders map 0..1000 onto [min, max] exponentially
const SLIDER_STEPS = 1000;
const toSlider = (v, s) => (Math.log(v / s.min) / Math.log(s.max / s.min)) * SLIDER_STEPS;
const fromSlider = (x, s) => s.min * Math.pow(s.max / s.min, x / SLIDER_STEPS);

/**
 * @param {HTMLElement} container
 * @param {object[]} specs
 * @param {(key, value) => void} onChange   called with a coerced value
 * @returns {{ update(params), dispose(), key: string }}
 */
export function createParamForm(container, specs, onChange) {
  const form = document.createElement("div");
  form.className = "param-form";
  container.append(form);
  const fields = new Map();

  for (const spec of specs ?? []) {
    if (!spec?.key) continue;
    const row = document.createElement("label");
    row.className = "param";
    row.dataset.kind = spec.kind;
    const name = document.createElement("span");
    name.className = "param-label";
    name.textContent = spec.label ?? spec.key;
    row.append(name);
    const commit = (raw) => {
      const v = coerceParam(spec, raw);
      if (v !== null) onChange(spec.key, v);
    };
    let set;

    if (spec.kind === "boolean") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.addEventListener("change", () => commit(input.checked));
      row.prepend(input);
      set = (v) => (input.checked = !!v);
    } else if (spec.kind === "enum") {
      const select = document.createElement("select");
      for (const o of spec.options ?? []) {
        const opt = document.createElement("option");
        opt.value = String(o.value);
        opt.textContent = o.label ?? String(o.value);
        select.append(opt);
      }
      select.addEventListener("change", () => commit(select.value));
      row.append(select);
      set = (v) => (select.value = String(v));
    } else if (spec.kind === "number" || spec.kind === "integer") {
      const wrap = document.createElement("span");
      wrap.className = "param-number";
      const input = document.createElement("input");
      input.type = "number";
      if (spec.min != null) input.min = String(spec.min);
      if (spec.max != null) input.max = String(spec.max);
      input.step = String(spec.step ?? (spec.kind === "integer" ? 1 : "any"));
      input.addEventListener("change", () => commit(input.value));
      let range = null;
      const log = spec.log && spec.min > 0 && spec.max > spec.min;
      if (spec.min != null && spec.max != null) {
        range = document.createElement("input");
        range.type = "range";
        if (log) {
          range.min = "0";
          range.max = String(SLIDER_STEPS);
          range.step = "1";
        } else {
          range.min = String(spec.min);
          range.max = String(spec.max);
          range.step = String(spec.step ?? (spec.kind === "integer" ? 1 : (spec.max - spec.min) / 200));
        }
        range.addEventListener("input", () => {
          const v = log ? fromSlider(Number(range.value), spec) : Number(range.value);
          input.value = String(coerceParam(spec, v));
          commit(v);
        });
        wrap.append(range);
      }
      wrap.append(input);
      row.append(wrap);
      set = (v) => {
        if (document.activeElement !== input) input.value = v == null ? "" : String(v);
        if (range && document.activeElement !== range && Number.isFinite(Number(v))) {
          range.value = String(log ? toSlider(Number(v), spec) : v);
        }
      };
    } else if (spec.kind === "color") {
      const input = document.createElement("input");
      input.type = "color";
      input.addEventListener("input", () => commit(input.value));
      row.append(input);
      set = (v) => (input.value = typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : "#808080");
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.addEventListener("change", () => commit(input.value));
      row.append(input);
      set = (v) => {
        if (document.activeElement !== input) input.value = v == null ? "" : String(v);
      };
    }
    fields.set(spec.key, { spec, set });
    form.append(row);
  }

  return {
    key: stableStringify(specs ?? []),
    update(params) {
      for (const [key, { spec, set }] of fields) set(params?.[key] ?? spec.default);
    },
    dispose() {
      form.remove();
    },
  };
}
