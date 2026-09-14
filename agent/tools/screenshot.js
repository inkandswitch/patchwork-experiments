/**
 * Seeing what it is working on.
 *
 * The agent can read a document's data and read the DOM, and neither tells it
 * whether the thing *looks* right. A cube rendered at the wrong scale, text
 * overflowing its box, a canvas that is drawing nothing — all of those are
 * invisible in a DOM dump and obvious in a picture.
 *
 * Two capture paths, because they fail differently:
 *
 *   - a `<canvas>` is read directly with `toDataURL`, which is exact. WebGL
 *     canvases only keep their buffer when asked to, so a blank result gets an
 *     explanation rather than a blank image.
 *   - anything else is rasterized through SVG `foreignObject`, implemented here
 *     rather than pulled from a CDN: the obvious library produced a blank
 *     rectangle in headless Chrome while a minimal foreignObject rasterized the
 *     same content correctly. It cannot see cross-origin images, and it renders
 *     text with the page's own fonts.
 *
 * Images are downscaled and re-encoded as JPEG before they go anywhere: this
 * ends up in a document that syncs, and in a prompt on every subsequent turn,
 * so a full-resolution PNG would be expensive twice over.
 */

import { bytes } from "./format.js"

const DEFAULT_MAX_WIDTH = 800
const DEFAULT_QUALITY = 0.7

const XHTML = "http://www.w3.org/1999/xhtml"
const SVG_NS = "http://www.w3.org/2000/svg"

/**
 * Copy an element's *computed* styles onto a clone, recursively.
 *
 * A clone inherits nothing: it is detached from the document, so no stylesheet
 * applies to it and it would rasterize as unstyled text. Every screenshot
 * library does some version of this; doing it here keeps a third party out of
 * the path and lets the canvas handling below be correct.
 */
function inlineComputedStyles(source, clone, view) {
  const computed = view.getComputedStyle(source)
  let css = ""
  for (const property of computed) {
    css += `${property}:${computed.getPropertyValue(property)};`
  }
  clone.setAttribute("style", css)

  const sourceChildren = source.children
  const cloneChildren = clone.children
  for (let i = 0; i < sourceChildren.length && i < cloneChildren.length; i++) {
    inlineComputedStyles(sourceChildren[i], cloneChildren[i], view)
  }
}

/**
 * Rasterize an element by way of an SVG foreignObject.
 *
 * Measured working in headless Chrome, which matters: `modern-screenshot` from
 * a CDN produced a byte-identical blank rectangle every time, while a minimal
 * foreignObject rasterized the same content correctly. Rather than debug
 * somebody else's build, this does the small thing directly.
 *
 * Canvases get special handling the libraries generally get wrong: `cloneNode`
 * copies a canvas element but not its pixels, so each one is swapped for an
 * `<img>` of its current contents. That makes a mixed view — a chart beside its
 * controls — come out whole.
 */
export async function rasterize(element, { width, height, doc }) {
  const view = doc.defaultView ?? globalThis
  const clone = element.cloneNode(true)
  inlineComputedStyles(element, clone, view)

  // The root must not carry its own off-screen offset into the SVG.
  clone.style.position = "static"
  clone.style.left = "0"
  clone.style.top = "0"
  clone.style.margin = "0"

  // Canvas pixels do not survive cloneNode; substitute an image of each.
  const sourceCanvases = [...element.querySelectorAll("canvas")]
  const clonedCanvases = [...clone.querySelectorAll("canvas")]
  for (let i = 0; i < sourceCanvases.length && i < clonedCanvases.length; i++) {
    try {
      const snapshot = doc.createElement("img")
      snapshot.src = sourceCanvases[i].toDataURL("image/png")
      snapshot.setAttribute("style", clonedCanvases[i].getAttribute("style") ?? "")
      clonedCanvases[i].replaceWith(snapshot)
    } catch {
      // A tainted canvas cannot be read; leave the blank one rather than fail.
    }
  }

  const wrapper = doc.createElementNS(XHTML, "div")
  wrapper.setAttribute("xmlns", XHTML)
  wrapper.append(clone)

  const serialized = new view.XMLSerializer().serializeToString(wrapper)
  const svg =
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`

  const image = new (view.Image ?? globalThis.Image)()
  const loaded = await new Promise((resolve) => {
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
  if (!loaded) throw new Error("The view could not be rasterized (the serialized markup did not load as an image).")

  const canvas = doc.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0)
  return canvas.toDataURL("image/png")
}

/**
 * Downscale and re-encode, so an image costs a sensible amount of context.
 *
 * This ends up in a document that syncs AND in the prompt on every subsequent
 * turn, so a full-resolution PNG would be expensive twice over.
 */
export async function shrink(dataUrl, { maxWidth = DEFAULT_MAX_WIDTH, quality = DEFAULT_QUALITY, doc } = {}) {
  const ownerDocument = doc ?? globalThis.document
  if (!ownerDocument || !dataUrl?.startsWith("data:")) return dataUrl

  const view = ownerDocument.defaultView ?? globalThis
  const image = new (view.Image ?? globalThis.Image)()
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = () => reject(new Error("could not decode the captured image"))
    image.src = dataUrl
  })

  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) return dataUrl

  const scale = Math.min(1, maxWidth / width)
  const canvas = ownerDocument.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))

  const context = canvas.getContext("2d")
  // A white ground: JPEG has no alpha, and transparent pixels would otherwise
  // come out black and look like a rendering bug.
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  return canvas.toDataURL("image/jpeg", quality)
}

/** Is this element, or its only meaningful child, a canvas? */
export function canvasWithin(element) {
  if (!element) return null
  if (element.tagName === "CANVAS") return element
  const canvases = element.querySelectorAll?.("canvas") ?? []
  return canvases.length === 1 ? canvases[0] : null
}

export const viewScreenshot = {
  id: "view_screenshot",
  name: "Look at what it renders",
  description: [
    "Capture a picture of what a view is actually drawing, and look at it.",
    "",
    "Use it when the question is visual: does this look right, is anything overlapping, is the canvas drawing at all, did my change land where I meant it to. Reading the DOM and reading the document tell you what is *there*; only this tells you what it *looks like*.",
    "",
    "Pass a mountId from view_mount to capture that view, or a selector to capture part of the live page. The image comes back attached to the result, so you can see it directly.",
  ].join("\n"),
  where: "host",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      mountId: { type: "string", description: "A mount from view_mount. Omit to capture the live page." },
      selector: { type: "string", description: "CSS selector within the target. Defaults to the whole thing." },
      maxWidth: { type: "number", description: "Downscale to this width. Default 800." },
    },
  },

  async execute(input, ctx) {
    const ownerDocument = ctx.element?.ownerDocument ?? globalThis.document
    if (!ownerDocument) throw new Error("view_screenshot needs a page.")

    // Resolve what to photograph: a mounted view, or the live one.
    let root
    if (input.mountId) {
      const mount = ctx.getMount?.(input.mountId)
      if (!mount) {
        throw new Error(`No mount '${input.mountId}'. Open one with view_mount, or omit mountId to capture the page.`)
      }
      root = mount.container
    } else {
      root = ownerDocument.querySelector("patchwork-view") ?? ownerDocument.body
    }

    const target = input.selector ? root.querySelector(input.selector) : root
    if (!target) throw new Error(`Nothing matches '${input.selector}' in the target.`)

    const width = target.clientWidth || target.offsetWidth || 0
    const height = target.clientHeight || target.offsetHeight || 0
    if (!width || !height) {
      throw new Error(
        `That element has no size (${width}×${height}), so there is nothing to capture. It may not be laid out yet.`
      )
    }

    let raw
    let method
    const canvas = canvasWithin(target)

    if (canvas) {
      method = "canvas"
      try {
        raw = canvas.toDataURL("image/png")
      } catch (err) {
        throw new Error(`Could not read the canvas: ${err?.message ?? err}. A cross-origin texture taints it.`)
      }
      // A WebGL context clears its drawing buffer after compositing unless it
      // was created with preserveDrawingBuffer, so this legitimately comes back
      // blank sometimes. Say so rather than returning an empty picture.
      if (!raw || raw.length < 200) {
        throw new Error(
          "The canvas read back empty. A WebGL canvas only keeps its pixels when created with { preserveDrawingBuffer: true }; capture right after a draw, or screenshot the surrounding element instead."
        )
      }
    } else {
      method = "dom"
      raw = await rasterize(target, { width, height, doc: ownerDocument })
    }

    const image = await shrink(raw, { maxWidth: input.maxWidth ?? DEFAULT_MAX_WIDTH, doc: ownerDocument })

    return {
      image,
      text: [
        `Captured ${width}×${height} via ${method}${input.selector ? ` (${input.selector})` : ""}.`,
        `Image attached, ${bytes(image.length)} as sent.`,
        method === "dom"
          ? "Rasterized from the DOM: cross-origin images will be missing."
          : "Read straight off the canvas, so this is exactly what was drawn.",
      ].join("\n"),
    }
  },

  summarize(input, output) {
    const size = String(output ?? "").match(/Captured (\d+×\d+)/)
    return `screenshot${size ? ` ${size[1]}` : ""}`
  },
}

export default [viewScreenshot]
