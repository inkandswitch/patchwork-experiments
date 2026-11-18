// An asset on the web (an image or an OBJ a game names by its http(s) URL,
// GAME-FORMAT.md §4): fetched, tried at every URL it may have moved to (a
// Steam host retired, http for https: tts/cache.js urlVariants), and read for
// what it is from its bytes (tts/sniff.js), since TTS's URLs rarely say.
// Many hosts refuse a page's cross-origin fetch: that is a failure like any
// other, and whatever uses the asset is drawn without it.

import { urlVariants } from "../tts/cache.js";
import { sniff } from "../tts/sniff.js";

/** Is this a web URL (an asset fetched, then cached in a file doc), rather than a file doc's? */
export const isWeb = (url) => typeof url === "string" && /^https?:\/\//i.test(url);

/** The bytes at a URL, from the first of its variants that answers: { bytes, via }. Throws the last failure. */
export async function fetchBytes(fetchFn, url, timeoutMs = 20000) {
  let lastError = null;
  for (const u of urlVariants(url)) {
    if (!isWeb(u)) continue;
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await fetchFn(u, ctl ? { signal: ctl.signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), via: u };
    } catch (err) {
      lastError = err?.name === "AbortError" ? new Error("timed out") : err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("not an http(s) URL");
}

/**
 * A web asset as a file doc's fields: { name, extension, mimeType, content,
 * origin: { urls: [url] } } (an OBJ's content as text, as the importer
 * stores it). Throws when it can't be had, or isn't an image or an OBJ (a
 * dead link's web page).
 */
export async function fetchAsset(fetchFn, url) {
  if (typeof fetchFn !== "function") throw new Error("nothing here fetches");
  const { bytes } = await fetchBytes(fetchFn, url);
  const t = sniff(bytes);
  if (!t.image && t.extension !== "obj") throw new Error(`expected an image or an OBJ, got ${t.mimeType}${t.extension === "html" ? " (a web page: the link is probably dead)" : ""}`);
  const stem = String(url).split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "asset";
  const name = `${stem.replace(/\.[^.]*$/, "").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60) || "asset"}.${t.extension}`;
  return { name, extension: t.extension, mimeType: t.mimeType, content: t.extension === "obj" ? new TextDecoder().decode(bytes) : bytes, origin: { urls: [url] } };
}
