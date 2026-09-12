import { parseAutomergeUrl, stringifyAutomergeUrl } from "@automerge/automerge-repo";
import { findSite, requestedPath, servedAt, splitServed, topLevelNames, withoutHeads } from "./paths.js";

console.info("site-viewer loaded from", import.meta.url);

const STYLE_ID = "site-viewer-styles";
if (!document.getElementById(STYLE_ID)) {
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./styles.css", import.meta.url).href;
  document.head.appendChild(link);
}

// A build writes several files in quick succession, and each one is a change event. Wait for the
// writing to stop before reloading.
const RELOAD_AFTER_QUIET_MS = 250;

const debounce = (ms, fn) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

/**
 * The document's URL with its current heads pinned on.
 *
 * Navigation goes to a pinned URL rather than a bare one, and this is the whole reason the
 * preview updates at all. A bare URL is answered with a redirect to the pinned one, and the
 * service worker caches by request URL — so a bare URL is a stable key for content that moves,
 * and what it cached is what you keep getting. Pinning makes the URL change exactly when the
 * content does, which is what a cache wants.
 */
const pinnedUrl = (handle) =>
  stringifyAutomergeUrl({
    documentId: parseAutomergeUrl(withoutHeads(handle.url)).documentId,
    heads: handle.heads(),
  });

export default function SiteViewerTool(handle, element) {
  const repo = element.repo ?? window.repo;

  const root = document.createElement("div");
  root.className = "site-viewer";
  root.innerHTML = `
    <div class="site-viewer__bar">
      <button class="site-viewer__button" data-act="home" title="Back to the home page">Home</button>
      <button class="site-viewer__button" data-act="reload" title="Reload">Reload</button>
      <code class="site-viewer__path"></code>
      <a class="site-viewer__button site-viewer__open" target="_blank" rel="noopener" title="Open in a new tab">Open ↗</a>
    </div>
    <div class="site-viewer__stage">
      <iframe class="site-viewer__frame" title="Site preview"></iframe>
      <div class="site-viewer__message" hidden></div>
    </div>`;
  element.append(root);

  const frame = root.querySelector(".site-viewer__frame");
  const pathLabel = root.querySelector(".site-viewer__path");
  const openLink = root.querySelector(".site-viewer__open");
  const message = root.querySelector(".site-viewer__message");

  // ── where the site is ──────────────────────────────────────────────────────────────────────
  // `site` is the document the site lives in, which is not always the document we were handed:
  // a repo keeps its site in a `public/` folder document of its own. `prefix` is any path inside
  // that document. See findSite().
  let site = null;
  let prefix = "";
  /** Where the iframe is, relative to the site's root. */
  let subpath = requestedPath(element) ?? "index.html";
  let watched = [];

  const homePath = () => "index.html";

  const showMessage = (title, detail) => {
    message.replaceChildren(
      Object.assign(document.createElement("strong"), { textContent: title }),
      Object.assign(document.createElement("p"), { textContent: detail })
    );
    message.hidden = false;
    frame.hidden = true;
  };

  const hideMessage = () => {
    message.hidden = true;
    frame.hidden = false;
  };

  /** Subscribe to the site document and every folder document along the path being shown. */
  const watchAll = async (at) => {
    const wanted = site ? [site] : [];
    let current = site;
    let doc = current?.doc();
    for (const segment of [prefix, ...String(at).split("/")].filter(Boolean).slice(0, -1)) {
      if (!Array.isArray(doc?.docs)) break; // vfs keeps every path on one document
      const link = doc.docs.find((l) => l?.name === segment);
      if (!link?.url) break;
      try {
        current = await repo.find(withoutHeads(link.url));
      } catch {
        break;
      }
      doc = current.doc();
      wanted.push(current);
    }
    for (const h of watched) h.off("change", onChange);
    watched = wanted;
    for (const h of watched) h.on("change", onChange);
  };

  /** Go to `at` inside the site. */
  const go = async (at) => {
    if (!site) return showMessageForNoSite();
    subpath = at;
    const src = servedAt(pinnedUrl(site), [prefix, at].filter(Boolean).join("/"));

    // The resolver throws rather than 404s for a path it cannot reach, and a failed navigation
    // still fires the iframe's load event — so ask first, where the status is legible.
    let response;
    try {
      response = await fetch(src);
    } catch (err) {
      return showMessage("Could not reach the site", String(err));
    }
    if (!response.ok) {
      return showMessage(`Nothing at /${at}`, `The site is document ${withoutHeads(site.url)}.`);
    }

    hideMessage();
    // The iframe is on the previous pinned URL; this one differs whenever the site has changed,
    // so it is a real navigation rather than a no-op assignment.
    try {
      frame.contentWindow.location.replace(src);
    } catch {
      frame.src = src;
    }
  };

  const showMessageForNoSite = () => {
    const names = topLevelNames(handle.doc());
    showMessage(
      "No site in this document",
      `Looked for index.html at the root and under public/. ` +
        (names.length ? `This document contains: ${names.join(", ")}` : "It has no files in it yet.")
    );
  };

  /** Re-read where the site is; open it when it appears. */
  const locate = async ({ navigate }) => {
    const found = findSite(handle.doc(), withoutHeads(handle.url));
    const sameSite = found && site && withoutHeads(site.url) === found.url && prefix === found.prefix;
    if (!found) {
      site = null;
      await watchAll("");
      return showMessageForNoSite();
    }
    if (!sameSite) {
      site = await repo.find(found.url);
      prefix = found.prefix;
      subpath = requestedPath(element) ?? homePath();
    }
    await watchAll(subpath);
    if (navigate || !sameSite) await go(subpath);
  };

  const onChange = debounce(RELOAD_AFTER_QUIET_MS, () => locate({ navigate: true }));

  const onFrameLoad = () => {
    let here = null;
    try {
      here = splitServed(frame.contentWindow.location.pathname);
    } catch {
      // A link that led off-origin. Nothing to report.
    }
    const shown = here?.subpath ?? "";
    const inSite = prefix && shown.startsWith(prefix + "/") ? shown.slice(prefix.length + 1) : shown;
    if (here) {
      subpath = inSite || homePath();
      watchAll(subpath);
    }
    // Say where we ended up. The iframe is the only thing that knows a link was followed, and a
    // host embedding this view — the site editor keeps a file list beside it — has no other way
    // to stay in step with it. Requested navigations report too: a host that hears its own
    // request back learns nothing new, and one that drives from the event needs no special case.
    if (here) {
      root.dispatchEvent(
        new CustomEvent("site-viewer:navigate", { detail: { path: subpath }, bubbles: true, composed: true })
      );
    }

    pathLabel.textContent = "/" + inSite;
    pathLabel.title = site ? `serving ${withoutHeads(site.url)}${prefix ? "/" + prefix : ""}` : "";
    openLink.href = frame.contentWindow?.location?.href ?? "";
  };
  frame.addEventListener("load", onFrameLoad);

  handle.on("change", onChange);

  // A host can say where to start, and move the preview by changing it.
  const host = element.closest("patchwork-view") ?? element;
  const observer = new MutationObserver(() => {
    const wanted = requestedPath(element);
    if (wanted && wanted !== subpath) go(wanted);
  });
  observer.observe(host, { attributes: true, attributeFilter: ["data-path"] });

  const onClick = (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "home") go(homePath());
    if (act === "reload") locate({ navigate: true });
  };
  root.addEventListener("click", onClick);

  locate({ navigate: true });

  return () => {
    handle.off("change", onChange);
    for (const h of watched) h.off("change", onChange);
    observer.disconnect();
    frame.removeEventListener("load", onFrameLoad);
    root.removeEventListener("click", onClick);
    root.remove();
  };
}
