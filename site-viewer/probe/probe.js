(async () => {
  const out = { steps: [] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    // ---- aria's real built site, as one directory doc ---------------------------------
    const raw = await (await fetch("/site.json")).json();
    const handle = window.repo.create2 ? await window.repo.create2() : window.repo.create();
    handle.change((d) => {
      d["@patchwork"] = { type: "directory" };
      for (const [path, f] of Object.entries(raw)) {
        d[path] = {
          content: f.encoding === "utf8" ? f.content : Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0)),
          mimeType: f.mimeType,
        };
      }
    });
    out.docUrl = handle.url;
    out.fileCount = Object.keys(raw).length;

    // ---- mount the real tool, through its real render contract ------------------------
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:1024px;height:768px;z-index:99999;background:#fff";
    document.body.appendChild(host);

    const { default: SiteViewerTool } = await import("/site-viewer/tool.js");
    const cleanup = SiteViewerTool(handle, host);
    out.cleanupIsFunction = typeof cleanup === "function";

    const frame = () => host.querySelector(".site-viewer__frame");
    const pathLabel = () => host.querySelector(".site-viewer__path")?.textContent;
    const message = () => (host.querySelector(".site-viewer__message")?.hidden === false
      ? host.querySelector(".site-viewer__message").textContent : null);

    // The tool fetches before it navigates, so settle on the iframe's document rather than on
    // a single load event. Match the tool's own path label exactly: a substring test lets
    // "/alifib/index.html" satisfy a wait for "/index.html", which silently measures the page
    // you were already on.
    const settled = async (wantPath, tries = 80) => {
      for (let i = 0; i < tries; i++) {
        const doc = frame()?.contentDocument;
        if (doc?.readyState === "complete" && pathLabel() === wantPath) return doc;
        await wait(250);
      }
      throw new Error(`never settled on ${wantPath} — stuck at ${pathLabel()}`);
    };

    const look = (doc) => {
      const body = doc?.body;
      const styles = body ? getComputedStyle(body) : null;
      const images = [...(doc?.images ?? [])];
      return {
        title: doc?.title,
        path: pathLabel(),
        // base.css sets body { font-family: var(--text-family-serif) } → "PT Serif".
        // If the stylesheet did not resolve, this is the browser default instead.
        fontFamily: styles?.fontFamily,
        stylesheets: doc ? doc.styleSheets.length : 0,
        // A stylesheet that 404s still appears in styleSheets with no rules, so count rules.
        cssRules: doc ? [...doc.styleSheets].reduce((n, s) => { try { return n + s.cssRules.length } catch { return n } }, 0) : 0,
        images: images.length,
        imagesLoaded: images.filter((i) => i.naturalWidth > 0).length,
        links: doc ? doc.querySelectorAll("a[href]").length : 0,
      };
    };

    // ---- 1. the home page -------------------------------------------------------------
    let doc = await settled("/index.html");
    out.steps.push({ step: "home", message: message(), ...look(doc) });

    // ---- 2. click through to an essay one level down ----------------------------------
    const essay = doc.querySelector('a[href="alifib/index.html"]') ?? doc.querySelector('a[href$="/index.html"]');
    out.clickedHref = essay?.getAttribute("href");
    essay.click();
    doc = await settled("/alifib/index.html");
    out.steps.push({ step: "essay (depth 1)", message: message(), ...look(doc) });

    // ---- 3. the styleguide, which has same-directory images and its own stylesheet ------
    host.querySelector('[data-act="home"]').click();
    doc = await settled("/index.html");
    out.steps.push({ step: "home button from depth 1", message: message(), ...look(doc) });
    // /styleguide/ is not linked from the home page, so put a link there and follow it. The
    // point is the navigation, not who wrote the anchor: it exercises exactly what a click on
    // a relative link does, and the styleguide is the page with same-directory images and a
    // stylesheet of its own.
    const guide = doc.createElement("a");
    guide.href = "styleguide/index.html";
    guide.textContent = "styleguide";
    doc.body.appendChild(guide);
    guide.click();
    doc = await settled("/styleguide/index.html");
    out.steps.push({ step: "styleguide (images + own css)", message: message(), ...look(doc) });

    // ---- 4. home button gets back ------------------------------------------------------
    host.querySelector('[data-act="reload"]').click();
    doc = await settled("/styleguide/index.html");
    out.steps.push({ step: "reload stays put", message: message(), ...look(doc) });

    // ---- 5. cleanup really cleans up ---------------------------------------------------
    cleanup();
    out.cleanedUp = host.querySelector(".site-viewer") === null;
    host.remove();
    out.ok = true;
  } catch (err) {
    out.ok = false;
    out.fatal = String((err && err.stack) || err);
  }
  return out;
})()
