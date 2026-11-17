/**
 * What every part of a capture does to bytes: name them by their SHA-256,
 * refer to stored bytes by that name (an `ni:` URI), and write them into a
 * data: URL. All of it runs the same in a tab, a worker and node, without
 * Buffer or btoa, so the output never depends on where it was made.
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

/** Hex as bytes; anything that is not an even run of hex digits gives null. */
function fromHex(hex) {
  if (typeof hex !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(hex)) return null
  return Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16))
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")

/**
 * The address a frozen page uses for bytes the snapshot stores: an RFC 6920
 * Named Information URI, `ni:///sha-256;<base64url of the hash>?ct=<type>`.
 *
 * It names the bytes by their hash and says what they are, so a stored page
 * says exactly which of the snapshot's blobs each load position shows, and
 * nothing else is needed to show it. And it names no place: no browser
 * fetches an `ni:` URI, so stored HTML opened by anything at all reaches
 * nothing through one.
 */
export function niUrl(sha256, mimeType) {
  const bytes = fromHex(sha256)
  if (!bytes) throw new Error(`Not a SHA-256: ${sha256}`)
  const hash = base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return `ni:///sha-256;${hash}?ct=${encodeURIComponent(mimeType || "application/octet-stream")}`
}

/** The hash (hex) and media type an `ni:` URI of ours names, or null for anything else. */
export function parseNi(url) {
  const match = String(url ?? "").match(/^ni:\/\/\/sha-256;([A-Za-z0-9_-]{43})\?ct=([^&#]*)$/i)
  if (!match) return null
  const decoded = fromDataUrl(`data:x;base64,${match[1].replace(/-/g, "+").replace(/_/g, "/")}=`)
  let mimeType
  try {
    mimeType = decodeURIComponent(match[2])
  } catch {
    return null
  }
  // A bare type/subtype and nothing else: it is written into a data: URL,
  // where a comma or a parameter would let whoever wrote the URI write the
  // data instead of the blob.
  if (!/^[a-z0-9][\w.+-]*\/[\w.+-]+$/i.test(mimeType)) return null
  return decoded?.bytes.length === 32 ? { sha256: toHex(decoded.bytes), mimeType } : null
}
