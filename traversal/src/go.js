// Going to another document: the one place traversal leaves the scene.
//
// Patchwork opens a document when a `patchwork:open-document` event reaches
// it, bubbling and composed out of a tool's element (what openDocument in
// @inkandswitch/patchwork-elements dispatches, and what the scene's inspector
// sends to open a GLB or an About). The visitor goes as a viewer opening a
// link goes: the destination opens as itself, where it starts and in the
// activity it starts in; nothing crosses.
//
// scene/COMPOSITION.md §9 plans this as the view's: `api.go(url)`, which will
// also put the eye at a named frame. When the stage has it, this function is
// the one to replace with that call.

export const OPEN_EVENT = "patchwork:open-document";

/**
 * Open `url` in Patchwork, from the stage's element.
 * @param {{ root?: EventTarget }} api  the extension's api (its `root`)
 * @param {string} url
 * @returns {boolean} whether an event went out
 */
export function go(api, url) {
  const from = api?.root;
  if (!from || typeof from.dispatchEvent !== "function" || typeof url !== "string" || !url) return false;
  from.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { url }, bubbles: true, composed: true }));
  return true;
}
