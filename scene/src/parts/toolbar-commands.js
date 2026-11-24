// What the surfaces do with commands (EDITOR.md, "A command"): the bar of
// tools, the key map and the menu. Whether a command applies, and the one
// walk every surface takes over them (`applicable`), are the kernel's
// (../stage/commands.js). Pure: no DOM, no api.

import { applicable, flatCommands, inHand } from "../stage/public.js";

/**
 * Is this command meant for this surface? An explicit `show` list decides;
 * without one, every surface it applies to (unless `strict`: then only an
 * explicit mention counts, as for the menu's scene commands).
 */
export function shownOn(command, surface, { strict = false } = {}) {
  const show = command?.show;
  if (Array.isArray(show)) return show.includes(surface);
  if (typeof show === "string") return show === surface;
  return !strict;
}

/** A command's keys, as a list. */
export const keysOf = (command) => {
  const k = command?.key;
  if (typeof k === "string" && k) return [k];
  if (Array.isArray(k)) return k.filter((x) => typeof x === "string" && x);
  return [];
};

/** Does a KeyboardEvent.key match one of this command's keys? (letters regardless of case) */
export function keyMatches(command, key) {
  if (typeof key !== "string" || !key) return false;
  for (const k of keysOf(command)) {
    if (k === key) return true;
    if (k.length === 1 && key.length === 1 && k.toLowerCase() === key.toLowerCase()) return true;
  }
  return false;
}

const KEY_NAMES = {
  Escape: "Esc",
  Delete: "Del",
  Backspace: "⌫",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  " ": "Space",
};

/** A command's first key, as a person reads it ("M", "Esc", "F2"), or "". */
export function keyLabel(command) {
  const k = keysOf(command)[0];
  if (!k) return "";
  if (KEY_NAMES[k]) return KEY_NAMES[k];
  return k.length === 1 ? k.toUpperCase() : k;
}

/** A tooltip: the state's title (else the name), with the key (the resolver's hint, where a surface has one: ./keymap.js hintFor). */
export function tooltip(command, state, key = keyLabel(command)) {
  const base = String(state?.title ?? command?.name ?? command?.id ?? "");
  return key ? `${base} (${key})` : base;
}

/** What kind of control a state calls for: "choices", "toggle" or "button". */
export function controlKind(state) {
  if (Array.isArray(state?.choices)) return "choices";
  if (typeof state?.checked === "boolean") return "toggle";
  return "button";
}

/** The choices as [{ value, label }] (a bare value is its own label). */
export function cleanChoices(choices) {
  return (Array.isArray(choices) ? choices : []).map((c) =>
    c && typeof c === "object" && "value" in c ? { value: c.value, label: String(c.label ?? c.value ?? "") } : { value: c, label: String(c ?? "") },
  );
}

/**
 * Is this a world command, the bar's in every body? Only an explicit
 * mention counts (show names "world"), as for the menu's scene commands:
 * a command that says nothing about its surfaces is no game's call to make.
 */
export const isWorld = (command) => shownOn(command, "world", { strict: true });

/**
 * Is this command meant for the bar of tools (EDITOR.md, "The interface")?
 * A world command is, in every body; a toolbar command (show names
 * "toolbar", or says nothing) is the editor's cluster's, so only while
 * that is there (`cluster`: the bar makes it while the Edit hand is held).
 * Whether it applies (its hand, its state) is commandState's, as on every
 * surface.
 */
export const onBar = (command, cluster) => isWorld(command) || (!!cluster && shownOn(command, "toolbar"));

/**
 * The bar of tools for a view: the focus path's scene commands (the null
 * target) that are on the bar and apply, each worked out in its own stage's
 * context, in two clusters, each in path order (the focus first), then
 * running order, then command order, one entry per stage/extension/id (the
 * first copy that applies): `editor` (the toolbar commands: Edit only) and
 * `world` (the world commands: every body; a command saying both is a world
 * command). And `shown`, the bar's presence, by one rule for both clusters:
 * is some command on the path the bar's in this body (onBar, and in its
 * body), whether or not it applies now? So the bar's height depends on
 * which extensions run, never on a command's state, and the canvas under it
 * doesn't move as Play or Lift all comes and goes.
 * @param {{ stage?: number, collected: any, ctx: object }[]} segs  the focus path's stages, focus first
 * @param {{ hands?: object[] } | null | undefined} view
 * @param {boolean} cluster  is the editor's cluster there (onBar)?
 * @returns {{ editor: { ext, command, state, stage? }[], world: { ext, command, state, stage? }[], shown: boolean }}
 */
export function barEntries(segs, view, cluster) {
  const editor = [];
  const world = [];
  let shown = false;
  const seen = new Set();
  for (const seg of segs ?? []) {
    const on = ({ command }) => onBar(command, cluster);
    if (flatCommands(seg.collected).some((e) => on(e) && inHand(e.command, view))) shown = true;
    for (const { ext, command, state } of applicable(seg.collected, null, seg.ctx, on)) {
      const k = `${seg.stage ?? ""}\u0000${ext}\u0000${command.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      (isWorld(command) ? world : editor).push(seg.stage === undefined ? { ext, command, state } : { ext, command, state, stage: seg.stage });
    }
  }
  return { editor, world, shown };
}

/** Everything a rendered control shows, as one string (to tell whether it changed). */
export function controlKey({ ext, command, state, key }) {
  const choices = Array.isArray(state.choices) ? cleanChoices(state.choices) : null;
  return JSON.stringify([ext, command.id, command.name ?? "", controlKind(state), tooltip(command, state, key), state.checked ?? null, state.value ?? null, choices, !!state.disabled, state.label ?? null]);
}
