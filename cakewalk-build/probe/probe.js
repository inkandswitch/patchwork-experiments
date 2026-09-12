(async () => {
  const out = { steps: [] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    const raw = await (await fetch("/repo.json")).json();
    out.sourceFileCount = Object.keys(raw).length;

    // ---- the repo, in BOTH of pushwork's shapes ----------------------------------------
    // The file documents are the expensive part and both shapes share them, so making two roots
    // over one set of files tests both for almost the cost of one. vfs is what `pushwork init`
    // writes by default; patchwork-folder is what it writes with --shape.
    const fileUrls = {};
    let docCount = 0;
    for (const [path, f] of Object.entries(raw)) {
      const name = path.split("/").pop();
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
      const content = f.encoding === "utf8" ? f.content : Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0));
      const doc = await window.repo.create2({ "@patchwork": { type: "file" }, name, extension: ext, mimeType: f.mimeType, content });
      fileUrls[path] = doc.url;
      docCount++;
    }

    // vfs: one root document, keys are whole paths, values are the file documents.
    const vfsRoot = await window.repo.create2({
      "@patchwork": { type: "directory", title: "aria-sgai-notebook (vfs)" },
      lastSyncAt: 1,
      ...fileUrls,
    });

    // patchwork-folder: a document per directory, nested.
    const tree = {};
    for (const [path, url] of Object.entries(fileUrls)) {
      const parts = path.split("/");
      let node = tree;
      for (const dir of parts.slice(0, -1)) node = node[dir] ??= {};
      node[parts.at(-1)] = url;
    }
    const makeFolder = async (node, title) => {
      const docs = [];
      for (const [name, child] of Object.entries(node)) {
        if (typeof child === "string") docs.push({ name, type: "file", url: child });
        else docs.push({ name, type: "folder", url: (await makeFolder(child, name)).url });
      }
      docCount++;
      return window.repo.create2({ "@patchwork": { type: "folder" }, title, docs });
    };
    const folderRoot = await makeFolder(tree, "aria-sgai-notebook (folder)");

    out.sourceDocsCreated = docCount;
    out.shapes = { vfs: vfsRoot.url, folder: folderRoot.url };
    const repoHandle = vfsRoot; // the default shape is the one to prove

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

    // ---- the other shape builds too -----------------------------------------------------
    ports.selection.postMessage({ type: "change", value: [folderRoot.url] });
    // Wait for the label to name the folder repo, not merely for the button to be enabled: it
    // was already enabled from the previous selection, so that check passed instantly and the
    // click rebuilt the wrong repo. A wait for a condition that is already true is not a wait.
    for (let i = 0; i < 60; i++) {
      if (host.querySelector(".cwb__repo")?.textContent?.includes("(folder)")) break;
      await wait(100);
    }
    out.folderRepoSelected = host.querySelector(".cwb__repo")?.textContent;
    host.querySelector('[data-act="build"]').click();
    const folderEntry = () => storage.doc()?.builds?.[folderRoot.url];
    for (let i = 0; i < 400; i++) {
      if (folderEntry()?.status === "ok" || folderEntry()?.status === "error") break;
      await wait(250);
    }
    out.steps.push({ step: "patchwork-folder shape builds too", status: folderEntry()?.status, log: folderEntry()?.log });

    // Back to the vfs repo for the rest.
    ports.selection.postMessage({ type: "change", value: [repoHandle.url] });
    await wait(600);

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
      // Nothing changed, so no new document: the previous one is kept and the URL holds still.
      sameOutputDocument: buildEntry()?.outputUrl === before,
    });

    // ---- editing a page produces a NEW output document -----------------------------------
    // Built output gets no history: each build that changes anything is a fresh document made
    // from its finished state, and the one it replaces is deleted.
    const essaySourcePath = "content/alifib/index.md";
    const essayDocUrl = fileUrls[essaySourcePath];
    const essayHandle = await window.repo.find(essayDocUrl);
    essayHandle.change((d) => { d.content = String(d.content) + "\n\nA paragraph added by the probe.\n" });

    const beforeEdit = buildEntry().outputUrl;
    const beforeBuiltAt = buildEntry().lastBuiltAt;
    host.querySelector('[data-act="build"]').click();
    for (let i = 0; i < 400; i++) {
      if (buildEntry()?.status === "ok" && buildEntry()?.lastBuiltAt !== beforeBuiltAt) break;
      await wait(250);
    }
    const afterEdit = buildEntry().outputUrl;
    const doc2 = await window.repo.find(afterEdit);
    const someContent = doc2.doc()["index.html"]?.content;
    out.steps.push({
      step: "editing a page writes only what moved",
      // The document is updated in place now, so its URL holds still and the preview does not
      // have to re-resolve a new one on every keystroke.
      sameDocument: afterEdit === beforeEdit,
      // Generated text is an ImmutableString, not a plain string — no text CRDT for output.
      contentType: someContent?.constructor?.name ?? typeof someContent,
      editedPageContainsTheEdit: String(doc2.doc()["alifib/index.html"]?.content ?? "").includes("added by the probe"),
      log: buildEntry()?.log,
    });

    // ---- selecting a page keeps the site pinned and moves the preview ---------------------
    ports.selection.postMessage({ type: "change", value: [essayDocUrl] });
    await wait(800);
    const view = host.querySelector("patchwork-view");
    out.steps.push({
      step: "selecting a content file",
      label: host.querySelector(".cwb__repo")?.textContent,
      stillPinned: !host.querySelector('[data-act="build"]')?.hidden,
      previewPath: view?.getAttribute("data-path"),
    });

    // Selecting something unrelated must not unpin either.
    ports.selection.postMessage({ type: "change", value: [notARepo.url] });
    await wait(500);
    out.steps.push({
      step: "selecting something unrelated",
      label: host.querySelector(".cwb__repo")?.textContent,
      stillPinned: !host.querySelector('[data-act="build"]')?.hidden,
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
