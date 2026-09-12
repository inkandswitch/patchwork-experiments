import { requestedPath, servedAt, siteRootIn, splitServed, topLevelNames, withoutHeads } from "./paths.js";

console.info("site-viewer loaded from", import.meta.url);

const STYLE_ID = "site-viewer-styles";
if (!document.getElementById(STYLE_ID)) {
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./styles.css", import.meta.url).href;
  document.head.appendChild(link);
}

// A build writes a lot of files in quick succession, and each one is a change event. Wait for
// the writing to stop before reloading, or the iframe reloads once per file.
const RELOAD_AFTER_QUIET_MS = 250;

const debounce = (ms, fn) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

export default function SiteViewerTool(handle, element) {
  const home = withoutHeads(handle.url);

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

  // Where the site lives in this document: "" for a built site, "public" for a repo that
  // contains one. Recomputed on change, since a repo has no site until it is built.
  let siteRoot = siteRootIn(handle.doc());

  /** The site's own home page, wherever the site is mounted. */
  const homePath = () => (siteRoot ? `${siteRoot}/index.html` : "index.html");

  /** Where the iframe currently is, inside the document. */
  let subpath = requestedPath(element) ?? homePath();

  const showMessage = (title, detail) => {
    message.innerHTML = "";
    const h = document.createElement("strong");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = detail;
    message.append(h, p);
    message.hidden = false;
    frame.hidden = true;
  };

  const hideMessage = () => {
    message.hidden = true;
    frame.hidden = false;
  };

  // Go to `at` inside the document. Always via the bare URL: the service worker answers with a
  // 307 to the same URL with the current heads pinned on, so starting bare is what picks up
  // the latest content — and it is why this cannot simply call frame.contentWindow.reload().
  const go = async (at) => {
    const src = servedAt(home, at);

    // The worker throws rather than 404s for a path it cannot resolve, and a failed navigation
    // still fires the iframe's load event — so ask first, where the status is legible.
    let response;
    try {
      response = await fetch(src, { method: "GET" });
    } catch (err) {
      return showMessage("Could not reach the site", String(err));
    }

    if (!response.ok) {
      const names = topLevelNames(handle.doc());
      const isHome = at === homePath();
      return showMessage(
        isHome ? "No site in this document" : `Nothing at /${at}`,
        isHome
          ? `Looked for index.html at the root and under public/. ` +
            (names.length ? `This document contains: ${names.join(", ")}` : "It has no files in it yet.")
          : `The site is at /${siteRoot || ""}.`
      );
    }

    hideMessage();
    // The iframe is sitting on the heads-pinned URL the worker redirected it to, and `src` is the
    // bare one — so this is a real navigation even when the path has not changed, which is what
    // picks up a new build. Assigning an unchanged `src` attribute is not reliably a navigation.
    try {
      frame.contentWindow.location.replace(src);
    } catch {
      frame.src = src;
    }
  };

  // The iframe navigates on its own whenever someone clicks a link, so its location is the
  // source of truth for where we are — not anything this tool set.
  const onFrameLoad = () => {
    let here = null;
    try {
      here = splitServed(frame.contentWindow.location.pathname);
    } catch {
      // A cross-origin document would throw. Nothing we serve is, but a link might lead away.
    }
    if (here) {
      subpath = here.subpath;
      watchAlong(subpath);
    }
    const shown = here?.subpath ?? "";
    pathLabel.textContent = "/" + (siteRoot && shown.startsWith(siteRoot + "/") ? shown.slice(siteRoot.length + 1) : shown);
    pathLabel.title = siteRoot ? `serving the site under ${siteRoot}/` : "";
    openLink.href = frame.src;
  };
  frame.addEventListener("load", onFrameLoad);

  // Watching the document this tool was handed is not enough on its own.
  //
  // In the patchwork-folder shape, rebuilding a page changes that page's own folder document and
  // the file document inside it — the repo root never moves. Mounted on the root, we would never
  // hear about it. So subscribe to every folder document along the path being shown as well, and
  // re-resolve each link without its heads: an artifact folder link is heads-pinned, and a pinned
  // handle is a frozen view that will never report a change.
  //
  // In vfs there is nothing to walk — every path is a key on the root — and this stops at once.
  const repo = element.repo ?? window.repo;
  let alongPath = [];

  const watchAlong = async (at) => {
    const wanted = [];
    let current = handle;
    let doc = current.doc();
    for (const segment of String(at).split("/").slice(0, -1)) {
      if (!Array.isArray(doc?.docs)) break;
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
    for (const h of alongPath) h.off("change", onChange);
    alongPath = wanted;
    for (const h of alongPath) h.on("change", onChange);
  };

  // Rebuild in another tab, or another person's edit arriving: stay on the page being looked
  // at and re-resolve it, rather than jumping back to the home page.
  const onChange = debounce(RELOAD_AFTER_QUIET_MS, () => {
    const found = siteRootIn(handle.doc());
    if (found !== siteRoot) {
      // A repo has no site until someone builds one; when that lands, open it.
      siteRoot = found;
      return go(homePath());
    }
    go(subpath);
  });
  handle.on("change", onChange);

  const onClick = (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "home") go(homePath());
    if (act === "reload") go(subpath);
  };
  root.addEventListener("click", onClick);

  // Two things a host can say through the element it already owns:
  //
  //   data-path   where to go — cakewalk-build sets it to the page you are editing
  //   data-build  that a build happened, so reload wherever we are
  //
  // The second exists because watching the document is not enough. In the patchwork-folder shape
  // a rebuilt page changes its own folder document and the file document inside it; the repo root
  // never moves, so `handle.on("change")` never fires and the preview sits on stale content while
  // navigating to the page by hand shows the new copy.
  const host = element.closest("patchwork-view") ?? element;
  let lastBuild = host.getAttribute?.("data-build") ?? null;
  const observer = new MutationObserver(() => {
    const wanted = requestedPath(element);
    const build = host.getAttribute("data-build");
    if (wanted && wanted !== subpath) return go(wanted);
    if (build !== lastBuild) {
      lastBuild = build;
      go(subpath);
    }
  });
  observer.observe(host, { attributes: true, attributeFilter: ["data-path", "data-build"] });

  go(subpath);

  return () => {
    handle.off("change", onChange);
    for (const h of alongPath) h.off("change", onChange);
    observer.disconnect();
    frame.removeEventListener("load", onFrameLoad);
    root.removeEventListener("click", onClick);
    root.remove();
  };
}
