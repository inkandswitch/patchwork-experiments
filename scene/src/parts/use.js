// scene.use: the use prompt ("[F] Raise the anchor"), attention's verbs
// shown where attention is (STAGE.md, "The input chain"): under the crosshair while the
// pointer is locked, else at the pointer. It shows; the key map
// (scene.keys) does. It runs in every scene, as the key map does: with
// nothing that has verbs under attention, it shows nothing.
//
// The pointer on the prompt (going for a button) holds it still where it
// is, until the viewer moves the eye (an orbit or zoom ends, a Frame, a
// body entered or left, a pointer lock taken or lost): then it goes back
// under the pointer, so a press never reaches a button left over what the
// eye moved there (a halo handle). An eye carried (a ride, a body's own
// going, a seat rolling with its table) doesn't let go: it moves every
// frame, and a button that moved off from under the pointer every frame
// could never be pressed.
//
// Attention is the selection if any, else the look (api.attention). The
// prompt is on the selection, or the first object along the look's chain
// (./keymap.js attentionPath) with any verbs for it (looking at a spoke of
// the wheel offers the helm's). Its verbs are the keyed commands that apply
// to it, unless their `show` leaves "use" out, in running order, in the
// context every surface passes (from, reach, hit), so a verb beyond the
// body's reach shows disabled, "too far". It shows the first three; past
// three, a last button, "⋯ 2 more", opens the prompt to every one of them,
// until attention moves to another target or none (or a carry takes the
// prompt down). So every verb on attention is
// on the prompt, shown or one press away, and each is its own button: on
// its key, held as long as the finger, as the first three are. Each verb's key is the resolver's (hintFor): shown
// only when pressing it does that, so a verb whose key the body reserves
// (walking, D) shows without one.
//
// Verbs are buttons, for touch and a mouse. A button whose verb has a key
// is that key: a press on it presses the key (../hold-key.js, as the touch
// pad's controls do) and lifting it lets the key up, so the verb goes the
// key order and the key map, and a held verb ("hold E": winding a capstan)
// lasts as long as the finger or the mouse button. Which key is asked as
// it is pressed (./keymap.js keyFor, the resolver hintFor asks), so a press
// presses only a key that does that verb on that target then. A verb with
// no key that does it (its key reserved: walking, D) is a click, run on its
// target; a held one can't be held without its key, so it shows disabled.
//
// While a gesture is open (a carry: its Q/E/F come first) it shows nothing.
//
// While a verb is held (scene.keys' `keymap`), attention is pinned to its
// target: the prompt shows the held verb (marked held, as it was when
// pressed, even once it no longer applies from here) and that target's
// other verbs, in their order (a held button keeps its place in the
// document, so its pointer stays captured), until its key comes up.

import css from "./use.css?inline";
import { applicable, keysOf } from "./toolbar-commands.js";
import { commandState, flatCommands } from "../stage/commands.js";
import { codeOfKey } from "../key-order.js";
import { attentionPath, hintFor, keyFor, segmentsOf } from "./keymap.js";
import { resolverState } from "./resolver.js";
import { samePath } from "../stage/paths.js";
import { looksFromEye } from "../stage/pointer.js";
import { arrange, holdKey } from "../hold-key.js";

/** How many verbs the prompt shows before its "more". */
export const MAX_VERBS = 3;

/**
 * The verbs while something is held: on the held verbs' target, whatever the
 * look is on. The target's verbs as they apply now, in their order, each
 * held one as it was when pressed (and kept where it no longer applies from
 * here, you've stepped back: after the rest), and as many others as fit
 * beside every held one. In their order, not the held first: moving a held
 * verb's button first takes it out of the document, which loses its pointer
 * capture. It can still move on the screen (a verb before it comes to
 * apply): its capture still takes the lift to it. Pure (given the collected
 * commands).
 * @param {{ id, value }[]} collected
 * @param {string} target  the held verbs' target
 * @param {{ ext, command, state }[]} held  as they were when pressed
 * @param {object} ctx  the command context now
 * @returns {{ target: string, entries: { ext, command, state }[], more: number }}
 *   `more`: how many of the target's verbs that apply now aren't shown
 */
export function heldEntries(collected, target, held, ctx, max = MAX_VERBS) {
  const live = ctx.scene?.objects?.[target] ? verbsOf(collected, target, ctx) : [];
  const same = (a, b) => a.ext === b.ext && a.command.id === b.command.id;
  const heldAs = (e) => held.find((h) => same(h, e));
  let room = max - held.length;
  const shown = live.map((e) => heldAs(e) ?? e).filter((e) => held.includes(e) || room-- > 0);
  const away = held.filter((h) => !live.some((e) => same(h, e)));
  return { target, entries: [...shown, ...away], more: live.length - shown.length };
}

/**
 * The prompt's verbs for attention: the first target along its path with
 * keyed commands shown on "use", the first `max` of them, and how many more
 * there are. Pure (given the collected commands).
 * @param {{ id, value }[]} collected
 * @param {{ selected?, hit? }} attention
 * @param {object} ctx  the command context
 * @returns {{ target: string, entries: { ext, command, state }[], more: number } | null}
 */
export function promptEntries(collected, attention, ctx, max = MAX_VERBS) {
  for (const target of attentionPath(attention, ctx?.scene?.parents)) {
    if (attention?.selected == null && !ctx?.scene?.objects?.[target]) continue;
    const all = verbsOf(collected, target, ctx);
    if (all.length) return { target, entries: all.slice(0, max), more: Math.max(0, all.length - max) };
  }
  return null;
}

function verbsOf(collected, target, ctx) {
  const flat = flatCommands(collected).filter(({ command }) => keysOf(command).length);
  return applicable(flat, target, ctx, "use");
}

const verbName = ({ command, state }) => String(state.label ?? command.name ?? command.id);

function create(api) {
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("use-layer");
  const prompt = document.createElement("div");
  prompt.className = "use-prompt";
  // the pointer on it keeps the look on what it offers verbs for (router.js), so its buttons can be clicked
  prompt.dataset.keepsLook = "";
  prompt.setAttribute("role", "status");
  prompt.hidden = true;
  overlay.append(prompt);
  // a long press on a verb is its key held, not the browser's menu
  api.listen(prompt, "contextmenu", (e) => e.preventDefault());

  let current = null; // { target, entries: [{ ext, command, state, key }], hit }
  let shownKey = "";
  let pointer = null; // port-local { x, y }: where the pointer is over the view (over the world or the prompt)
  let placed = null; // port-local { x, y } the prompt was last put under, or null: the view's middle
  // The prompt holding still under a pointer that went onto it: { at, body }, where it was (`placed` then) and
  // whose eye (the body's id). Null while it follows the pointer.
  let held = null;
  let offLoop = null;
  let offWatch = null;
  // The target whose every verb shows (its "more" pressed): JSON [stage, target], or null. Attention on any
  // other target, or none, closes it, as does the prompt going while a gesture is open (`found` is null then).
  let opened = null;
  const whereOf = (stage, target) => JSON.stringify([stage ?? null, target]);

  const keymap = () => api.collect("keymap").map((r) => r.value).find((v) => v && typeof v.pinned === "function") ?? null;
  // the look is the eye's (the crosshair's): under lock, or a lock body under touch
  const fromEye = () => looksFromEye(api.view.get().pointer);

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
    const entriesIn = (s, max) => (pinned !== undefined ? heldEntries(s.collected, pinned.at(-1), km.entries(pinned), s.ctx, max) : promptEntries(s.collected, s.attention, s.ctx, max));
    if (!gesture)
      for (const s of segmentsOf(keys)) {
        // (a held verb's target is in its own stage: the one whose path its path goes on from)
        if (pinned !== undefined && Array.isArray(s.reader?.path) && !samePath(s.reader.path, pinned.slice(0, -1))) continue;
        found = entriesIn(s, MAX_VERBS);
        if (found?.entries.length) {
          seg = s;
          // opened: the same target, every verb (which target doesn't hang on how many show)
          if (whereOf(s.stage, found.target) === opened) found = entriesIn(s, Infinity);
          break;
        }
        found = null;
      }
    if (!found || whereOf(seg.stage, found.target) !== opened) opened = null;
    if (found) {
      current = { target: found.target, hit: seg.ctx.hit, stage: seg.stage, reader: seg.reader ?? null, more: found.more, entries: found.entries.map((e) => ({ ...e, key: hintFor({ ext: e.ext, command: e.command, target: found.target, stage: seg.stage }, keys) })) };
    } else current = null;
    render();
  }

  // A verb's button, by identity (its extension's command): kept across
  // renders, in place, so a finger on it keeps its pointer captured and its
  // key held while the prompt changes round it (the key going down marks it
  // held; a pinned target's other verbs come and go).
  const idOf = (e) => JSON.stringify([e.ext, e.command.id]);
  const shown = new Map(); // id → { el, hold, entry }

  /** A button going: its fingers let go (its key up), and it's gone. */
  function drop(id) {
    const b = shown.get(id);
    b.hold.letGo();
    shown.delete(id);
    b.el.remove();
  }

  function render() {
    const km = keymap();
    const entries = current?.entries ?? [];
    const more = current?.more ?? 0;
    const key = JSON.stringify([more, entries.map((e) => [e.ext, e.command.id, verbName(e), e.key, !!e.command.hold, !!e.state.disabled, e.state.title ?? null, !!km?.holding(e.ext, e.command.id)])]);
    if (key !== shownKey) {
      shownKey = key;
      const ids = new Set(entries.map(idOf));
      for (const id of [...shown.keys()]) if (!ids.has(id)) drop(id);
      for (const e of entries) {
        if (!shown.has(idOf(e))) shown.set(idOf(e), make());
        fill(shown.get(idOf(e)), e, km);
      }
      moreEl.textContent = `⋯ ${more} more`;
      arrange(prompt, [...entries.map((e) => shown.get(idOf(e)).el), ...(more ? [moreEl] : [])]);
      prompt.hidden = !entries.length;
    }
    place();
  }

  /** The code of the key that does this verb on the prompt's target now, or null. */
  function codeNow(entry) {
    if (!current) return null;
    const k = keyFor({ ext: entry.ext, command: entry.command, target: current.target, stage: current.stage }, resolverState(api));
    return k == null ? null : codeOfKey(k);
  }

  // The press a click can be of: the button that had the latest press on
  // the view, and whether that press was its key. A pointer's click runs a
  // verb only on the button that had its press, and only when that press
  // wasn't the key (the key did it). A browser clicks the element under the
  // lift when the one pressed has gone, so a verb that runs on the press and
  // puts another button in its place (the next verb, or the next target's)
  // would otherwise have the lift's click run that one too. Every press on
  // the view clears it (capture, before the button hears its own), so a
  // press elsewhere is never taken for this button's.
  let pressed = null; // { el, keyed }
  api.listen(api.root, "pointerdown", () => (pressed = null), { capture: true });

  // One verb's button: a press on it is its key while it has one (holdKey
  // asks codeNow as each press comes), else its click runs the verb.
  function make() {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "use-verb";
    el.tabIndex = -1;
    const b = { el, entry: null, hold: null };
    b.hold = holdKey(el, api.root, () => codeNow(b.entry), (down) => {
      // keys come to this view after (a press elsewhere on the page had them); focus moving in cancels nothing
      if (down) api.root.focus?.({ preventScroll: true });
    });
    // (after holdKey's: a second finger on a held button is the key's too; a right or middle press is nobody's)
    el.addEventListener("pointerdown", (e) => {
      if (!(e.button > 0)) pressed = { el, keyed: b.hold.holds(e.pointerId) };
    });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      // a pointer's click (a keyboard's on the button has no press: detail 0) is of the press this button had
      if (e.detail > 0) {
        const p = pressed;
        pressed = null;
        if (p?.el !== el || p.keyed) return;
      }
      const { ext, command } = b.entry;
      // a held verb lasts as long as its key: with none that does it, there's nothing to hold
      if (command.hold) return;
      const target = current?.target ?? null;
      // (applies still: the stage's run asks again)
      const reader = current?.reader ?? api;
      if (commandState(command, target, reader.context(current?.hit ?? null))) api.run({ ...(current?.stage !== undefined ? { stage: current.stage } : {}), ext, command: command.id, target, hit: current?.hit ?? null });
      api.root.focus?.({ preventScroll: true });
    });
    return b;
  }

  // The last button past three verbs: a click (of a press it had, as a verb's) opens the prompt to them all.
  const moreEl = document.createElement("button");
  moreEl.type = "button";
  moreEl.className = "use-more";
  moreEl.tabIndex = -1;
  moreEl.addEventListener("pointerdown", (e) => {
    if (!(e.button > 0)) pressed = { el: moreEl, keyed: false };
  });
  moreEl.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.detail > 0) {
      const p = pressed;
      pressed = null;
      if (p?.el !== moreEl) return;
    }
    if (current) opened = whereOf(current.stage, current.target);
    refresh();
    api.root.focus?.({ preventScroll: true });
  });

  // What a verb's button shows: the key in a keycap (after "hold" for a
  // held one), then its name.
  function fill(b, entry, km) {
    b.entry = entry;
    const { el } = b;
    const { ext, command, state, key } = entry;
    const holding = !!km?.holding(ext, command.id);
    el.dataset.ext = ext;
    el.dataset.command = command.id;
    toggle(el, "disabled", !!state.disabled);
    toggle(el, "held", holding);
    // (a held button is never disabled: its finger's lift has to reach it)
    el.disabled = !holding && (!!state.disabled || (!!command.hold && !key));
    if (state.title) el.title = String(state.title);
    else el.removeAttribute("title");
    const parts = [];
    if (command.hold) {
      const h = document.createElement("span");
      h.className = "use-hold";
      h.textContent = "hold";
      parts.push(h);
    }
    if (key) {
      const k = document.createElement("kbd");
      k.className = "use-key";
      k.textContent = key;
      parts.push(k);
    }
    const name = document.createElement("span");
    name.className = "use-name";
    name.textContent = verbName(entry);
    parts.push(name);
    el.replaceChildren(...parts);
  }
  const toggle = (el, flag, on) => (on ? (el.dataset[flag] = "") : delete el.dataset[flag]);

  const bodyId = () => api.view.get().body?.id ?? null;
  // held where it is, whatever put it there (a pointer coming back into the view straight onto it, too)
  function hold() {
    if (!held) held = { at: placed, body: bodyId() };
  }
  // the viewer moved the eye: back under the pointer (36 px below it, use.css), so a press there reaches what
  // is under it now, not a button the prompt left there
  function letGo() {
    held = null;
  }

  // Under the crosshair when the look is the eye's; under the pointer otherwise, or held where it is.
  function place() {
    if (prompt.hidden) return;
    const a = held ? held.at : pointer;
    placed = fromEye() || !a ? null : a;
    prompt.style.setProperty("--use-x", placed ? `${placed.x}px` : "50%");
    prompt.style.setProperty("--use-y", placed ? `${placed.y}px` : "50%");
  }

  // A loop runs only while the eye moves on its own: a body over the
  // stage's Look (walking, at a station: what's in reach changes
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

  // it follows a pointer over the world, not over anything put over it: over the prompt itself (going for one of
  // its buttons) it holds still, or it would move off from under the pointer, until the viewer moves the eye; a
  // finger on the touch pad, the body chip, any part's overlay isn't where anyone looks. A press is where the
  // pointer is too: a finger has no moves before it, and what it taps is where the prompt shows.
  const follow = (e) => {
    const over = e.target instanceof Element ? e.target.closest(".stage-overlay") : null;
    if (over && !prompt.contains(e.target)) return;
    const r = api.port.getBoundingClientRect();
    if (over) hold();
    else letGo();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    place();
  };
  api.listen(api.port, "pointermove", follow);
  api.listen(api.port, "pointerdown", follow, { capture: true }); // (before a press claimed on the world stops it)
  // (a finger leaves as it lifts: where it tapped stays, as its look does: router.js)
  api.listen(api.port, "pointerleave", (e) => {
    if (e.pointerType === "touch") return;
    pointer = null;
    letGo();
  });
  // an orbit, a zoom or a Frame moves the eye, and so what's in reach; a lock
  // taken or lost moves the look between the pointer and the crosshair (and,
  // locked, the eye with the mouse)
  api.camera.onEnd(() => {
    letGo();
    refresh();
  });
  api.listen(document, "pointerlockchange", () => {
    letGo();
    refresh();
  });

  return {
    update() {
      // a body entered or left (a seat, Look from a walk) puts the eye somewhere else
      if (held && held.body !== bodyId()) letGo();
      wantLoop();
      refresh();
    },
    dispose() {
      for (const id of [...shown.keys()]) drop(id);
      offLoop?.();
      offLoop = null;
      offWatch?.();
      offWatch = null;
    },
  };
}

export default { create };
