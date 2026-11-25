/**
 * Images as the model sees them.
 *
 * An image file in Patchwork is a document holding the image's bytes. Read as
 * data it is a summary of a byte array, which tells the model nothing, so it
 * went the long way round: mounted the file in a view and took a screenshot of
 * it. This turns an image document's bytes into an image the model can look
 * at — fitted within the sizes providers accept, as a screenshot is — for
 * doc_read, source_read and anything a person attaches to a message.
 */

import { fitWithin, MAX_IMAGE_SIDE } from "../tools/screenshot.js"

/** The widest an image is sent at, as for screenshots. */
export const IMAGE_MAX_WIDTH = 1600

/** Above this, an image that cannot be resized here is not sent at all. */
export const MAX_RAW_BYTES = 4 * 1024 * 1024

const EXTENSIONS = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp" }

/** What image format these bytes are, from their first bytes, or null. */
export function sniffImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null
  const b = bytes
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png"
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp"
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp"
  return null
}

/**
 * The image type of a document, or null: its bytes say so, or its mimeType
 * or extension does and it holds bytes.
 */
export function imageTypeOf(doc) {
  const content = doc?.content
  if (!(content instanceof Uint8Array)) return null
  const sniffed = sniffImage(content)
  if (sniffed) return sniffed
  const declared = String(doc.mimeType ?? "").toLowerCase()
  if (declared.startsWith("image/") && declared !== "image/svg+xml") return declared
  const extension = String(doc.extension ?? doc.name?.split(".").pop() ?? "").toLowerCase()
  const byName = EXTENSIONS[extension]
  return byName && byName !== "image/svg+xml" ? byName : null
}

function base64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64")
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/**
 * The image as a data URL fitted for a model: no wider than IMAGE_MAX_WIDTH,
 * no side over MAX_IMAGE_SIDE. Where the platform can decode and draw images
 * (a page, a worker), it is redrawn at that size; elsewhere it is passed as it
 * is when small enough, and otherwise null — it is not sent.
 *
 *   { url, width, height } | null
 */
export async function imageForModel(bytes, type, { maxWidth = IMAGE_MAX_WIDTH, maxSide = MAX_IMAGE_SIDE } = {}) {
  if (!(bytes instanceof Uint8Array) || !type) return null
  if (typeof createImageBitmap === "function" && typeof OffscreenCanvas === "function") {
    try {
      const bitmap = await createImageBitmap(new Blob([bytes], { type }))
      const size = fitWithin(bitmap.width, bitmap.height, { maxWidth, maxSide })
      const canvas = new OffscreenCanvas(size.width, size.height)
      const context = canvas.getContext("2d")
      // A white ground, as screenshots have: JPEG has no transparency.
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, size.width, size.height)
      context.drawImage(bitmap, 0, 0, size.width, size.height)
      bitmap.close?.()
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 })
      const out = new Uint8Array(await blob.arrayBuffer())
      return { url: `data:image/jpeg;base64,${base64(out)}`, width: size.width, height: size.height }
    } catch {
      /* fall through: undecodable here, perhaps fine as it is */
    }
  }
  if (bytes.byteLength > MAX_RAW_BYTES) return null
  return { url: `data:${type};base64,${base64(bytes)}`, width: null, height: null }
}
