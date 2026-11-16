/**
 * Two things every part of a capture does to bytes: name them by their
 * SHA-256, and write them into a data: URL. Both run the same in a tab, a
 * worker and node, without Buffer or btoa, so the output never depends on
 * where it was made.
 */

/** Hex SHA-256 of some bytes, for telling one kept response from another. */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** Standard base64 with padding, of a Uint8Array. */
export function base64(bytes) {
  const parts = []
  let line = ""
  const n = bytes.length
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i]
    const b = i + 1 < n ? bytes[i + 1] : 0
    const c = i + 2 < n ? bytes[i + 2] : 0
    const triple = (a << 16) | (b << 8) | c
    line +=
      ALPHABET[(triple >> 18) & 63] +
      ALPHABET[(triple >> 12) & 63] +
      (i + 1 < n ? ALPHABET[(triple >> 6) & 63] : "=") +
      (i + 2 < n ? ALPHABET[triple & 63] : "=")
    // Joined in pieces: one string grown a character at a time to tens of
    // megabytes is slow in every engine.
    if (line.length >= 8192) {
      parts.push(line)
      line = ""
    }
  }
  parts.push(line)
  return parts.join("")
}

/** Bytes as a data: URL of `mimeType`. */
export function dataUrl(mimeType, bytes) {
  return `data:${mimeType || "application/octet-stream"};base64,${base64(bytes)}`
}

/**
 * The bytes of a base64 data: URL, and its type with any parameters
 * ("text/css;charset=utf-8"); null for anything else. For tests and for
 * reading an export back.
 */
export function fromDataUrl(url) {
  const match = String(url).match(/^data:([^,]*?);base64,([A-Za-z0-9+/=]*)$/)
  if (!match) return null
  const text = match[2].replace(/=+$/, "")
  const out = new Uint8Array(Math.floor((text.length * 3) / 4))
  let bits = 0
  let value = 0
  let k = 0
  for (const ch of text) {
    value = ((value << 6) | ALPHABET.indexOf(ch)) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[k++] = (value >> bits) & 0xff
    }
  }
  return { mimeType: match[1], bytes: out.subarray(0, k) }
}
