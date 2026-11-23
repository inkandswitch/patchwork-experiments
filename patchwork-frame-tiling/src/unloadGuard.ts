// Closing the browser tab by mistake (⌘W / Ctrl-W, which pages never see,
// reached for to close a panel's tab) loses what the tools hold outside their
// documents: a call, unsent text, undo, a running agent. The layout itself is
// safe (⌘⇧T reopens the tab as it was). So while the frame is mounted the
// browser asks before the page goes, unless the page itself is what sent it:
//  - a reload key (⌘R, Ctrl-R, F5, with or without Shift), or
//  - a click on a button or link (the host's "Reload" for a new build, a link
//    out of Patchwork),
// within a moment before. Typing doesn't count (⌘W may be seen as a key in
// some browsers), and nor does a click on anything else.

/** How soon after the page's own gesture an unload is taken to be its doing. */
export const DELIBERATE_UNLOAD_MS = 1000;

const isReloadKey = (event: KeyboardEvent): boolean =>
  event.key === "F5" ||
  ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "r");

const isButtonOrLink = (event: Event): boolean =>
  event.composedPath().some(
    (node) =>
      node instanceof Element &&
      (node.tagName === "BUTTON" ||
        (node.tagName === "A" && node.hasAttribute("href")) ||
        node.getAttribute("role") === "button" ||
        node.getAttribute("role") === "link"),
  );

/** Ask before the page unloads, unless the page sent it. Returns the uninstall. */
export const installUnloadGuard = (
  win: Window,
  now: () => number = () => performance.now(),
): (() => void) => {
  let deliberateAt = -Infinity;
  const onKey = (event: KeyboardEvent) => {
    if (isReloadKey(event)) deliberateAt = now();
  };
  const onClick = (event: MouseEvent) => {
    if (isButtonOrLink(event)) deliberateAt = now();
  };
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (now() - deliberateAt < DELIBERATE_UNLOAD_MS) return;
    event.preventDefault();
    // Older Chrome and Safari ask only when this is set.
    event.returnValue = "";
  };
  win.addEventListener("keydown", onKey, true);
  win.addEventListener("click", onClick, true);
  win.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    win.removeEventListener("keydown", onKey, true);
    win.removeEventListener("click", onClick, true);
    win.removeEventListener("beforeunload", onBeforeUnload);
  };
};
