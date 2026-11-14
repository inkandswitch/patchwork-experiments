// scene.use: the use prompt ("[F] Raise the anchor"), attention's verbs
// shown where attention is (TOOLS.md §3, §5): under the crosshair while the
// pointer is locked, else at the pointer. It shows; the key map
// (scene.keys) does. It runs in every scene, as the key map does: with
// nothing that has verbs under attention, it shows nothing.
//
// Attention is the selection if any, else the look (api.attention). The
// prompt is on the selection, or the first object along the look's chain
// (../keymap.js attentionPath) with any verbs for it (looking at a spoke of
// the wheel offers the helm's). Its verbs are the keyed commands that apply
// to it, unless their `show` leaves "use" out, at most three, in the context every
// surface passes (from, reach, hit), so a verb beyond the body's reach shows
// disabled, "too far". Each verb's key is the resolver's (hintFor): shown
// only when pressing it does that, so a verb whose key the body reserves
// (walking, D) shows without one. Verbs are buttons, for touch; a held verb
// ("hold F") is the keyboard's.
//
// While a gesture is open (a carry: its Q/E/F come first) it shows nothing.
//
// While a verb is held (scene.keys' `keymap`), attention is pinned to its
// target: the prompt shows the held verb (marked held, as it was when
// pressed, even once it no longer applies from here) and that target's
// other verbs, until its key comes up.

import css from "./use.css?inline";
import { applicable, commandState, flatCommands, keysOf } from "./toolbar-commands.js";
import { attentionPath, hintFor, segmentsOf } from "../keymap.js";
import { resolverState } from "./resolver.js";

/** How many verbs the prompt shows. */
export const MAX_VERBS = 3;

/**
 * The verbs while something is held: on the held verbs' target, whatever the
 * look is on. The held ones first, as they were when pressed (each kept
 * where it no longer applies from here: you've stepped back), then the
 * target's other verbs as they apply now. Pure (given the collected commands).
 * @param {{ id, value }[]} collected
 * @param {string} target  the held verbs' target
 * @param {{ ext, command, state }[]} heldEntries  as they were when pressed
 * @param {object} ctx  the command context now
 * @returns {{ target: string, entries: { ext, command, state }[] }}
 */
export function heldEntries(collected, target, heldEntries, ctx, max = MAX_VERBS) {
  const live = ctx.scene?.objects?.[target] ? verbsOf(collected, target, ctx, Infinity) : [];
  const same = (a, b) => a.ext === b.ext && a.command.id === b.command.id;
  const rest = live.filter((e) => !heldEntries.some((h) => same(h, e)));
  return { target, entries: [...heldEntries, ...rest].slice(0, max) };
}

/**
 * The prompt's verbs for attention: the first target along its path with
 * keyed commands shown on "use", and up to `max` of them. Pure (given the collected commands).
 * @param {{ id, value }[]} collected
 * @param {{ selected?, hit? }} attention
 * @param {object} ctx  the command context
 * @returns {{ target: string, entries: { ext, command, state }[] } | null}
 */
export function promptEntries(collected, attention, ctx, max = MAX_VERBS) {
  for (const target of attentionPath(attention, ctx?.scene?.parents)) {
    if (attention?.selected == null && !ctx?.scene?.objects?.[target]) continue;
    const entries = verbsOf(collected, target, ctx, max);
    if (entries.length) return { target, entries };
  }
  return null;
}

function verbsOf(collected, target, ctx, max) {
  const flat = flatCommands(collected).filter(({ command }) => keysOf(command).length);
  return applicable(flat, target, ctx, "use").slice(0, max);
}

const verbName = ({ command, state }) => String(state.label ?? command.name ?? command.id);

function create(api) {
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("use-layer");
  const prompt = document.createElement("div");
  prompt.className = "use-prompt";
  prompt.setAttribute("role", "status");
  prompt.hidden = true;
  overlay.append(prompt);

  let current = null; // { target, entries: [{ ext, command, state, key }], hit }
  let shownKey = "";
  let pointer = null; // port-local { x, y }, the last place the pointer was over the view
  let offLoop = null;
  let offWatch = null;

  const keymap = () => api.collect("keymap").map((r) => r.value).find((v) => v && typeof v.pinned === "function") ?? null;
  const locked = () => !!api.view.get().pointer?.locked;

  function refresh() {
    const km = keymap();
    if (km && !offWatch) offWatch = km.watch(() => refresh());
    const pinned = km?.pinned();
    const keys = resolverState(api);
    // while a gesture is open (a carry), its keys come first and nothing under the pointer is what they do: no prompt
    const gesture = api.view.get().gesture != null;
    // the verbs of the nearest thing that has any: attention's path, a stage at a time, innermost first
    let found = null;
    let seg = null;
    if (!gesture)
      for (const s of segmentsOf(keys)) {
        found = pinned !== undefined ? heldEntries(s.collected, pinned, km.entries(pinned), s.ctx) : promptEntries(s.collected, s.attention, s.ctx);
        if (found?.entries.length) {
          seg = s;
          break;
        }
        found = null;
      }
    if (found) {
      current = { target: found.target, hit: seg.ctx.hit, stage: seg.stage, reader: seg.reader ?? null, entries: found.entries.map((e) => ({ ...e, key: hintFor({ ext: e.ext, command: e.command, target: found.target, stage: seg.stage }, keys) })) };
    } else current = null;
    render();
  }

  function render() {
    const km = keymap();
    const entries = current?.entries ?? [];
    const key = JSON.stringify(entries.map((e) => [e.ext, e.command.id, verbName(e), e.key, !!e.command.hold, !!e.state.disabled, e.state.title ?? null, !!km?.holding(e.ext, e.command.id)]));
    if (key !== shownKey) {
      shownKey = key;
      prompt.replaceChildren(...entries.map((e) => row(e, km)));
      prompt.hidden = !entries.length;
    }
    place();
  }

  // One verb: the key in a keycap (after "hold" for a held one), then its
  // name; a button, so a touch can run it (a held verb is the keyboard's).
  function row(entry, km) {
    const { ext, command, state, key } = entry;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "use-verb";
    el.dataset.ext = ext;
    el.dataset.command = command.id;
    el.tabIndex = -1;
    if (state.disabled) el.dataset.disabled = "";
    el.disabled = !!state.disabled || !!command.hold;
    if (km?.holding(ext, command.id)) el.dataset.held = "";
    if (state.title) el.title = String(state.title);
    if (command.hold) {
      const h = document.createElement("span");
      h.className = "use-hold";
      h.textContent = "hold";
      el.append(h);
    }
    if (key) {
      const k = document.createElement("kbd");
      k.className = "use-key";
      k.textContent = key;
      el.append(k);
    }
    const name = document.createElement("span");
    name.className = "use-name";
    name.textContent = verbName(entry);
    el.append(name);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = current?.target ?? null;
      // (applies still: the stage's run asks again)
      const reader = current?.reader ?? api;
      if (commandState(command, target, reader.context(current?.hit ?? null))) api.run({ ...(current?.stage !== undefined ? { stage: current.stage } : {}), ext, command: command.id, target, hit: current?.hit ?? null });
      api.root.focus?.({ preventScroll: true });
    });
    return el;
  }

  // Under the crosshair when locked; under the pointer otherwise.
  function place() {
    if (prompt.hidden) return;
    const at = locked() || !pointer ? null : pointer;
    prompt.style.setProperty("--use-x", at ? `${at.x}px` : "50%");
    prompt.style.setProperty("--use-y", at ? `${at.y}px` : "50%");
  }

  // A loop runs only while the eye moves on its own: a body over the
  // stage's Look or Edit (walking, at a station: what's in reach changes
  // every frame).
  const moving = () => (api.view.get().body?.depth ?? 0) > 0;
  function wantLoop() {
    const need = moving();
    if (need && !offLoop) offLoop = api.loop(() => refresh());
    else if (!need && offLoop) {
      offLoop();
      offLoop = null;
    }
  }

  api.listen(api.port, "pointermove", (e) => {
    const r = api.port.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    place();
  });
  api.listen(api.port, "pointerleave", () => {
    pointer = null;
  });
  // an orbit or zoom moves the eye, and so what's in reach; a lock taken or
  // lost moves the look between the pointer and the crosshair
  api.camera.onEnd(() => refresh());
  api.listen(document, "pointerlockchange", () => refresh());

  return {
    update() {
      wantLoop();
      refresh();
    },
    dispose() {
      offLoop?.();
      offLoop = null;
      offWatch?.();
      offWatch = null;
    },
  };
}

export default { create };
