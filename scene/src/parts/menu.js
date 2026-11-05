// scene.menu: the context menu. A right-click (or a touch hold) opens a small
// menu at the pointer listing the commands that apply to the object under it
// (show includes "menu", or says nothing), then, under a separator, the
// scene's commands that ask for a menu (show includes "menu"). Picking one
// runs it; Escape, a click outside, or picking closes it. Arrow keys move
// through it, Enter (or Space) picks. Nothing applies: no menu, and the event
// goes on down the chain.

import css from "./menu.css?inline";
import { applicable, cleanChoices, controlKind, flatCommands, keyLabel } from "./toolbar-commands.js";

/**
 * The menu's entries for a target: [{ ext, command, state }] for the object,
 * then for the scene. Pure (given the collected commands).
 */
export function menuEntries(collected, target, ctx) {
  const flat = flatCommands(collected);
  const forObject = target != null ? applicable(flat, target, ctx, "menu") : [];
  const forScene = applicable(flat, null, ctx, "menu", { strict: true });
  return { forObject, forScene };
}

function create(api) {
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("menu-layer");
  let open = null; // { el, target, offs: [] }

  function close({ refocus = false } = {}) {
    if (!open) return;
    const o = open;
    open = null;
    for (const off of o.offs) off();
    o.el.remove();
    if (refocus) overlay.closest(".scene-stage")?.focus?.({ preventScroll: true });
  }

  const items = () => (open ? [...open.el.querySelectorAll(".menu-item:not(:disabled)")] : []);

  function move(delta) {
    const list = items();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement);
    const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : (at + delta + list.length) % list.length;
    list[next].focus({ preventScroll: true });
  }

  function item({ ext, command, state }, target, extra = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-item";
    b.setAttribute("role", extra.role ?? "menuitem");
    b.dataset.ext = ext;
    b.dataset.command = command.id;
    const label = document.createElement("span");
    label.className = "menu-label";
    label.textContent = extra.label ?? String(state.label ?? command.name ?? command.id);
    b.append(label);
    const key = extra.key ?? keyLabel(command);
    if (key) {
      const k = document.createElement("kbd");
      k.className = "menu-key";
      k.textContent = key;
      b.append(k);
    }
    if (extra.checked != null) b.setAttribute("aria-checked", String(!!extra.checked));
    if (state.title) b.title = String(state.title);
    b.disabled = !!state.disabled;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      close({ refocus: true });
      api.run({ ext, command: command.id, target, value: extra.value });
    });
    return b;
  }

  // One command's rows: a plain item, a checkable one, or a heading and one
  // radio row per choice.
  function rows(entry, target) {
    const { command, state } = entry;
    const kind = controlKind(state);
    if (kind === "toggle")
      return [
        item(entry, target, {
          role: "menuitemcheckbox",
          checked: state.checked,
          value: !state.checked,
        }),
      ];
    if (kind === "choices") {
      const head = document.createElement("div");
      head.className = "menu-heading";
      head.textContent = String(command.name ?? command.id);
      const choices = cleanChoices(state.choices);
      return [
        head,
        ...choices.map((ch, i) =>
          item(entry, target, {
            role: "menuitemradio",
            label: ch.label,
            value: ch.value,
            key: i === 0 ? keyLabel(command) : "",
            checked: ch.value === state.value || (ch.value != null && state.value != null && String(ch.value) === String(state.value)),
          }),
        ),
      ];
    }
    return [item(entry, target)];
  }

  function show(ev) {
    close();
    const target = ev.hit?.id ?? null;
    const ctx = { scene: api.scene(), local: api.local.get() };
    const { forObject, forScene } = menuEntries(api.collect("commands"), target != null && ctx.scene.objects?.[target] ? target : null, ctx);
    if (!forObject.length && !forScene.length) return false;
    const el = document.createElement("div");
    el.className = "context-menu";
    el.setAttribute("role", "menu");
    if (forObject.length) {
      const name = api.nameOf(target);
      if (name) {
        const title = document.createElement("div");
        title.className = "menu-title";
        title.textContent = name;
        el.append(title);
      }
      for (const e of forObject) el.append(...rows(e, target));
    }
    if (forObject.length && forScene.length) {
      const sep = document.createElement("div");
      sep.className = "menu-separator";
      sep.setAttribute("role", "separator");
      el.append(sep);
    }
    for (const e of forScene) el.append(...rows(e, null));
    overlay.append(el);
    // at the pointer, kept inside the view
    const pw = overlay.clientWidth || Infinity;
    const ph = overlay.clientHeight || Infinity;
    const w = el.offsetWidth || 0;
    const h = el.offsetHeight || 0;
    const x = Math.max(0, Math.min(ev.x ?? 0, pw - w));
    const y = Math.max(0, Math.min(ev.y ?? 0, ph - h));
    el.style.left = `${Number.isFinite(x) ? x : 0}px`;
    el.style.top = `${Number.isFinite(y) ? y : 0}px`;

    const onKey = (e) => {
      // the menu's keys are its own, never scene shortcuts
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        close({ refocus: true });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const list = items();
        list[e.key === "Home" ? 0 : list.length - 1]?.focus({
          preventScroll: true,
        });
      } else if (e.key === "Tab") {
        e.preventDefault();
        move(e.shiftKey ? -1 : 1);
      }
    };
    el.addEventListener("keydown", onKey);
    const onOutside = (e) => {
      if (!open || open.el.contains(e.target)) return;
      close();
    };
    // Escape while focus is still on the canvas (the menu opened from a press)
    const onDocKey = (e) => {
      if (e.key !== "Escape" || !open || open.el.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    open = {
      el,
      target: forObject.length ? target : null,
      offs: [api.listen(document, "pointerdown", onOutside, true), api.listen(document, "keydown", onDocKey, true), api.listen(globalThis, "blur", () => close())],
    };
    items()[0]?.focus({ preventScroll: true });
    return true;
  }

  return {
    input: {
      menu: (ev) => show(ev),
    },
    update(scene, _local, prev) {
      // what it was opened on went away
      if (open && prev?.scene !== scene && open.target != null && !scene.objects?.[open.target]) close();
    },
    dispose: () => close(),
  };
}

export default { create };
