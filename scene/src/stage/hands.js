// The hand stack (STAGE.md, "Hands"): what the viewer holds, one stack per
// view, top last. Every hand is offered every event, top first (H12); one
// put on top puts none down; any one may leave from wherever it is, and a
// tool held for a kind of hand (a command's `hand`) leaves with the last hand
// of that kind (H14). A hand's kind says what it is: "tool" (a held tool),
// "popover", or a plugin's own.
//
// Pure: the router keeps the stack and does what a change says, in its one
// order (router.js `restack`): the stack is kept first, then the keys of what
// left are let go, then each is told `put()`.

import { KERNEL_KINDS } from "./bodies.js";

/**
 * A hand as the stack keeps it (router.js RouterHand, with its owner, the
 * kind of hand a tool is held for, and its serial).
 * @typedef {{ owner: string | null, kind: string, name: string, command: string | null, handKind: string | null, input: object, keys: { code: string, label?: string }[], pointer: boolean, escape?: () => boolean, escaping?: () => string | null, put?: () => void, serial: number }} Hand
 * @typedef {{ hands: Hand[], off: Hand[], tell: { owner: string | null, to: object, what: string }[] }} HandChange
 */

/** A hand from its holder's spec, `handKind` the kind of hand a tool is held for. @returns {Hand} */
export function handOf(owner, spec, serial, handKind = null) {
  return {
    owner,
    kind: spec.kind,
    name: String(spec.name ?? spec.command ?? spec.kind),
    command: spec.command ?? null,
    handKind,
    input: spec.input ?? {},
    keys: Array.isArray(spec.keys) ? spec.keys : [],
    pointer: !!spec.pointer,
    escape: spec.escape,
    escaping: spec.escaping,
    put: spec.put,
    serial,
  };
}

/** A held tool's spec: a hand of kind "tool", its input told `put()` as it goes down. */
export const toolSpec = (t) => ({
  kind: "tool",
  command: t.command ?? null,
  name: t.name,
  input: t.input,
  keys: t.keys,
  pointer: t.pointer,
  put: () => void (typeof t.input?.put === "function" && t.input.put()),
});

/** A popover's input: modal, it consumes every event the canvas gets while it is open. */
export const MODAL = Object.freeze({ press: () => ({}), click: () => true, menu: () => true, wheel: () => true });

/** An open menu or dialog's spec: a hand that wants the pointer and consumes everything; Escape closes it (close(), then it is put down). */
export const popoverSpec = (close) => ({ kind: "popover", name: "menu", pointer: true, input: MODAL, escape: () => (close(), false) });

/** The held tools: the hands of kind "tool", bottom first. */
export const tools = (hands) => hands.filter((h) => h.kind === "tool");

/** The held tool picked up through `command` of `owner`, or null. */
export const toolOf = (hands, owner, command) => (command == null ? null : (tools(hands).find((h) => h.owner === owner && h.command === command) ?? null));

/** The held tool `which` names: the one whose `serial` that is, else the one picked up through `command` of `owner`; with none, the topmost. */
export const whichTool = (hands, which) =>
  !which ? (tools(hands).at(-1) ?? null) : which.serial != null ? (tools(hands).find((h) => h.serial === which.serial) ?? null) : toolOf(hands, which.owner, which.command);

/** Is a tool held for a kind of hand refused: a kind not held, or one of the kernel's own (KERNEL_KINDS)? */
export const refuses = (hands, handKind) => handKind != null && (KERNEL_KINDS.includes(handKind) || !hands.some((h) => h.kind === handKind));

/** Does a hand want the pointer free (the hands' part of H5's `wanted`)? */
export const wantsPointer = (hands) => hands.some((h) => h.pointer);

/** `hand` put on top: it puts none down. @returns {HandChange} */
export const withHand = (hands, hand) => ({ hands: [...hands, hand], off: [], tell: [] });

/**
 * `hand` leaving, from wherever it is, and with it every tool held for a kind
 * of hand no longer held, as far as that goes. `off` is what leaves, `hand`
 * first; `tell` is each one's `put()`, a tool that left because a hand went
 * told before that hand. @returns {HandChange | null} null when it isn't held
 */
export function withoutHand(hands, hand) {
  if (!hands.includes(hand)) return null;
  const off = [];
  const tell = [];
  const leave = (rest, h) => {
    off.push(h);
    let left = rest.filter((x) => x !== h);
    for (const t of left.filter((x) => x.handKind != null && !left.some((y) => y.kind === x.handKind))) if (left.includes(t)) left = leave(left, t);
    tell.push({ owner: h.owner, to: h, what: "put" });
    return left;
  };
  return { hands: leave(hands, hand), off, tell };
}
