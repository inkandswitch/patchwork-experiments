import { servedAt, splitServed, topLevelNames, withoutHeads } from "./paths.js";

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

  /** Where the iframe currently is, inside the document. "" before it has loaded anything. */
  let subpath = "index.html";

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
      return showMessage(
        at === "index.html" ? "No index.html in this document" : `Nothing at /${at}`,
        names.length ? `This document contains: ${names.join(", ")}` : "This document has no files in it yet."
      );
    }

    hideMessage();
    frame.src = src;
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
    if (here) subpath = here.subpath;
    pathLabel.textContent = "/" + (here?.subpath ?? "");
    openLink.href = frame.src;
  };
  frame.addEventListener("load", onFrameLoad);

  // Rebuild in another tab, or another person's edit arriving: stay on the page being looked
  // at and re-resolve it, rather than jumping back to the home page.
  const onChange = debounce(RELOAD_AFTER_QUIET_MS, () => go(subpath));
  handle.on("change", onChange);

  const onClick = (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "home") go("index.html");
    if (act === "reload") go(subpath);
  };
  root.addEventListener("click", onClick);

  go("index.html");

  return () => {
    handle.off("change", onChange);
    frame.removeEventListener("load", onFrameLoad);
    root.removeEventListener("click", onClick);
    root.remove();
  };
}
