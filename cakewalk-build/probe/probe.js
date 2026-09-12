(async () => {
  const out = { steps: [] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    const raw = await (await fetch("/repo.json")).json();
    out.sourceFileCount = Object.keys(raw).length;

    // ---- a repo, shaped the way pushwork shapes one -----------------------------------
    // Nested folder docs ({title, docs:[{name,type,url}]}) with a document per file
    // ({name, extension, mimeType, content}). Built bottom-up so each folder can name its
    // children's URLs.
    const tree = {};
    for (const [path, f] of Object.entries(raw)) {
      const parts = path.split("/");
      let node = tree;
      for (const dir of parts.slice(0, -1)) node = node[dir] ??= {};
      node[parts.at(-1)] = f;
    }

    let docCount = 0;
    const makeFolder = async (node, title) => {
      const docs = [];
      for (const [name, child] of Object.entries(node)) {
        if (child && typeof child === "object" && "encoding" in child) {
          const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
          const content = child.encoding === "utf8" ? child.content : Uint8Array.from(atob(child.content), (c) => c.charCodeAt(0));
          const file = await window.repo.create2({ name, extension: ext, mimeType: child.mimeType, content });
          docCount++;
          docs.push({ name, type: "file", url: file.url });
        } else {
          const folder = await makeFolder(child, name);
          docs.push({ name, type: "folder", url: folder.url });
        }
      }
      docCount++;
      return window.repo.create2({ title, docs });
    };

    const repoHandle = await makeFolder(tree, "aria-sgai-notebook");
    out.sourceDocsCreated = docCount;
    out.sourceUrl = repoHandle.url;

    // ---- stand in for the host, and mount the real component ---------------------------
    // A patchwork:component is handed an element and nothing else. Everything it needs comes
    // from the host's providers, answered over a MessagePort it sends in a `patchwork:subscribe`
    // event — so answering those two selectors is the whole of the host's side of the contract.
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:1200px;height:900px;z-index:99999;background:#fff";
    document.body.appendChild(host);

    const ports = {};
    host.addEventListener("patchwork:subscribe", (event) => {
      const { selector, port } = event.detail ?? {};
      port.start();
      if (selector?.type === "patchwork:selected-doc") ports.selection = port;
      // The host creates this document lazily, on first request. Do the same.
      if (selector?.type === "patchwork:tool-storage") {
        ports.storage = port;
        out.toolStorageAskedFor = selector.toolId;
        window.repo.create2({ builds: {} }).then((storage) => {
          out.storageUrl = storage.url;
          port.postMessage({ type: "change", value: storage.url });
        });
      }
    });

    const { default: CakewalkBuildComponent } = await import("/cakewalk-build/context-tool.js");
    // No handle: the component takes only an element.
    const cleanup = CakewalkBuildComponent(host);

    out.askedForSelection = Boolean(ports.selection);
    out.askedForStorage = Boolean(ports.storage);
    if (!ports.selection) throw new Error("the component never asked what was selected");
    if (!ports.storage) throw new Error("the component never asked for its storage");

    // Before anything is selected it should say so rather than offering to build nothing.
    await wait(300);
    out.steps.push({
      step: "nothing selected",
      label: host.querySelector(".cwb__repo")?.textContent,
      buildOffered: !host.querySelector('[data-act="build"]')?.hidden,
    });

    // Select something that is not a site.
    const notARepo = await window.repo.create2({ title: "just a note", text: "hello" });
    ports.selection.postMessage({ type: "change", value: [notARepo.url] });
    await wait(400);
    out.steps.push({
      step: "a document that is not a repo",
      label: host.querySelector(".cwb__repo")?.textContent,
      buildOffered: !host.querySelector('[data-act="build"]')?.hidden,
    });

    // Now select the repo.
    ports.selection.postMessage({ type: "change", value: [repoHandle.url] });
    for (let i = 0; i < 40; i++) {
      const button = host.querySelector('[data-act="build"]');
      if (button && !button.hidden && !button.disabled) break;
      await wait(100);
    }
    out.steps.push({
      step: "the repo selected",
      label: host.querySelector(".cwb__repo")?.textContent,
      buildOffered: !host.querySelector('[data-act="build"]')?.hidden,
      buildEnabled: !host.querySelector('[data-act="build"]')?.disabled,
    });

    const storage = await window.repo.find(out.storageUrl);
    const buildEntry = () => storage.doc()?.builds?.[repoHandle.url];

    // ---- build ------------------------------------------------------------------------
    const started = performance.now();
    host.querySelector('[data-act="build"]').click();
    for (let i = 0; i < 400; i++) {
      const s = buildEntry()?.status;
      if (s === "ok" || s === "error") break;
      await wait(250);
    }
    const doc = buildEntry() ?? {};
    out.steps.push({
      step: "build",
      status: doc.status,
      wallMs: Math.round(performance.now() - started),
      log: doc.log,
      outputUrl: doc.outputUrl,
    });
    if (doc.status !== "ok") throw new Error("build did not succeed: " + (doc.log ?? []).join(" | "));

    // ---- an identical rebuild should write nothing --------------------------------------
    // This is what keeps the output document's history from gaining a full copy of the site on
    // every build, and it is only true if changesFor() compares content rather than trusting
    // that a rebuild produces new objects.
    const before = doc.outputUrl;
    host.querySelector('[data-act="build"]').click();
    await wait(500);
    for (let i = 0; i < 400; i++) {
      if (buildEntry()?.status === "ok" && buildEntry()?.lastBuiltAt !== doc.lastBuiltAt) break;
      await wait(250);
    }
    out.steps.push({
      step: "rebuild with nothing changed",
      log: buildEntry()?.log,
      sameOutputDocument: buildEntry()?.outputUrl === before,
    });

    // ---- what landed in the output document -------------------------------------------
    const output = await window.repo.find(buildEntry().outputUrl);
    const outDoc = output.doc();
    const paths = Object.keys(outDoc).filter((k) => k !== "@patchwork");
    const references = paths.filter((p) => typeof outDoc[p] === "string");
    out.steps.push({
      step: "output document",
      type: outDoc["@patchwork"]?.type,
      files: paths.length,
      storedInline: paths.length - references.length,
      // Binary files the build passed through should be a pointer at the source document,
      // not a second copy of the bytes.
      referencedFromSource: references.length,
      referenceExample: references[0] ? `${references[0]} → ${outDoc[references[0]]}` : null,
    });

    // ---- does the service worker serve it? ---------------------------------------------
    // Pick the paths out of what was actually built, rather than naming one site's pages: this
    // probe is run against more than one repo, and a missing page should read as a missing page
    // and not as a broken resolver.
    const pick = (test) => paths.find(test) ?? null;
    const probePaths = [
      "index.html",
      pick((p) => /\/index\.html$/.test(p)),
      pick((p) => p.endsWith(".css")),
      pick((p) => /\.(svg|png|jpg|jpeg|webp)$/.test(p)),
    ].filter(Boolean);
    out.steps.push({ step: "paths chosen from the build", probePaths });

    const served = {};
    for (const path of probePaths) {
      try {
        const res = await fetch(`/${encodeURIComponent(buildEntry().outputUrl)}/${path}`);
        served[path] = { status: res.status, type: res.headers.get("content-type"), bytes: (await res.arrayBuffer()).byteLength };
      } catch (err) { served[path] = { error: String(err) } }
    }
    out.steps.push({ step: "served through the service worker", ...served });

    // ---- and does it render? -----------------------------------------------------------
    const viewerHost = document.createElement("div");
    viewerHost.style.cssText = "position:fixed;left:0;top:0;width:1024px;height:768px;z-index:99998;background:#fff";
    document.body.appendChild(viewerHost);
    const { default: SiteViewerTool } = await import("/site-viewer/tool.js");
    const viewerCleanup = SiteViewerTool(output, viewerHost);

    const label = () => viewerHost.querySelector(".site-viewer__path")?.textContent;
    const settled = async (want) => {
      for (let i = 0; i < 80; i++) {
        const d = viewerHost.querySelector(".site-viewer__frame")?.contentDocument;
        if (d?.readyState === "complete" && label() === want) return d;
        await wait(250);
      }
      throw new Error(`viewer never settled on ${want} — stuck at ${label()}`);
    };

    const look = (d) => ({
      title: d?.title,
      path: label(),
      cssRules: d ? [...d.styleSheets].reduce((n, s) => { try { return n + s.cssRules.length } catch { return n } }, 0) : 0,
      fontFamily: d?.body ? getComputedStyle(d.body).fontFamily : null,
      images: [...(d?.images ?? [])].length,
      imagesLoaded: [...(d?.images ?? [])].filter((i) => i.naturalWidth > 0).length,
    });

    let page = await settled("/index.html");
    out.steps.push({ step: "viewer: home", ...look(page) });

    // A link to a page one level down — preferring one whose directory also holds an image, so
    // that "images loaded" is a real check rather than a page that happened to have none. The
    // images on such a page are the referenced-from-source ones, so loading them is also the
    // proof that the resolver follows an Automerge URL where a file should be.
    const imageDirs = new Set(
      paths.filter((p) => /\.(svg|png|jpg|jpeg|webp|gif)$/.test(p)).map((p) => p.split("/")[0])
    );
    const internal = [...page.querySelectorAll("a[href]")].filter((a) => {
      const href = a.getAttribute("href");
      return href && !/^(https?:|mailto:|#|\/)/.test(href) && href.endsWith("/index.html") && href.includes("/");
    });
    const link =
      internal.find((a) => imageDirs.has(a.getAttribute("href").split("/")[0])) ?? internal[0];
    if (!link) {
      out.steps.push({ step: "viewer: nested page", skipped: "the home page links to no nested page" });
    } else {
      const href = link.getAttribute("href");
      link.click();
      page = await settled("/" + href);
      out.steps.push({ step: "viewer: nested page", href, ...look(page) });
    }

    viewerCleanup();
    cleanup();
    host.remove();
    viewerHost.remove();
    out.ok = true;
  } catch (err) {
    out.ok = false;
    out.fatal = String((err && err.stack) || err);
  }
  return out;
})()
