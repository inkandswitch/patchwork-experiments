/**
 * The config picker as a BARE inline element (no popover, no header/footer) — for
 * a tool to embed and own. Returned synchronously, Suspense-style: it shows a
 * spinner and fills in once config resolves (no defaults-flash).
 *
 *   const panel = llm.dom({source, tools})
 *   box.append(panel)
 *
 * Scope which config it edits with `{source:{read,write,url?}}` (url shows in the
 * status bar). Pass `{tools:[{name,description}]}` to surface the host's built-in
 * tools in the Tools section. The element carries `.result` (resolves on
 * `.destroy()`), `.destroy()` (flush + remove), `.revert()` (revert + remove).
 *
 * @param {Object} [opts]
 * @returns {HTMLElement}
 */
export function dom(opts?: Object): HTMLElement;
/**
 * The config picker wrapped in an outer popover frame (title + ×, Cancel/Done).
 * Returned synchronously; mount it and show it:
 *
 *   const el = llm.popup(); root.append(el); el.showPopover()
 *   const cfg = await el.result   // resolves on close (null if cancelled)
 *
 * Same options as `dom()`. Changes autosave live; Done keeps them, Cancel reverts
 * to the open-time snapshot, light-dismiss keeps them.
 *
 * @param {Object} [opts]
 * @returns {HTMLElement}
 */
export function popup(opts?: Object): HTMLElement;
export { describeConfig };
import { describeConfig } from "./config.js";
