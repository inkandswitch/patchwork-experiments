/**
 * The package's stylesheet, linked once per version of this code.
 *
 * Keyed by URL, not by a fixed id: a module URL carries its version, and two
 * versions of this package can be loaded in one page (an older install beside
 * a newer one). With a fixed id, whichever loaded first would keep its
 * stylesheet and the other version's rules would never arrive.
 */

const STYLE_MARK = "data-patchwork-agent-styles"

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
    // A test's DOM refuses external stylesheets; styling is not what tests
    // assert on, so failing to load it must not fail a mount.
  }
}
