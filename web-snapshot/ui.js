/**
 * What the view needs from the page: its stylesheet, linked once, and a
 * terse way to make an element. Plain DOM, so the view runs under happy-dom in
 * tests exactly as it does in Patchwork.
 */

const STYLE_MARK = "data-web-snapshot-styles"

/** Link styles.css once per page, however many views are open. */
export function ensureStyles() {
  if (typeof document === "undefined") return
  try {
    const href = new URL("./styles.css", import.meta.url).href
    if ([...document.querySelectorAll(`link[${STYLE_MARK}]`)].some((link) => link.href === href)) return
    const link = document.createElement("link")
    link.setAttribute(STYLE_MARK, "")
    link.rel = "stylesheet"
    link.href = href
    document.head.appendChild(link)
  } catch {
    /* tests: no external stylesheets */
  }
}

/** An element with a class and text, either of which may be left out. */
export function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/** A time a person reads, in UTC so every reader of a shared snapshot sees the same one. */
export const when = (at) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`
