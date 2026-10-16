// patchwork:tool "scene-render-controls" — the generic control surface for a
// scene-render doc. It finds the provider by id, draws a form from its
// ParamSpecs, and writes params / pinned back to the render doc. It also shows
// build status and can rebuild on demand.
//
// "Rebuild now" first asks an enclosing scene (a cancelable, bubbling
// `scene:rebuild` DOM event) so the scene's own build loop does it; standalone,
// it runs the build itself.

import css from "./styles.css?inline";
import { createParamForm } from "./param-form.js";
import { dependenciesOf, dependencyKeyOf, errorMessage, fingerprintOf, runBuild } from "./build.js";
import { createDependencyWatcher } from "./deps.js";
import { staleReason } from "./staleness.js";

export const REBUILD_EVENT = "scene:rebuild";

function relativeTime(ts, now = Date.now()) {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function SceneRenderControls(handle, element) {
  const repo = element.repo ?? globalThis.repo;
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "scene-render-controls";
  root.innerHTML = `
    <div class="head">
      <span class="provider"></span>
      <button type="button" class="link open-source">Open source</button>
    </div>
    <div class="status-row">
      <span class="pill status"></span>
      <span class="built"></span>
    </div>
    <div class="error" hidden></div>
    <div class="notice" hidden></div>
    <div class="params"></div>
    <div class="actions">
      <label class="pin"><input type="checkbox" class="pinned"> Pinned <span class="hint">(no auto-rebuild)</span></label>
      <button type="button" class="button rebuild">Rebuild now</button>
    </div>`;
  element.append(style, root);
  const $ = (sel) => root.querySelector(sel);

  let registry = null;
  let providerMeta = null;
  let provider = null; // loaded: { id, name, params, module }
  let sourceHandle = null;
  let form = null;
  let localBuilding = false;
  let dead = false;
  const offs = [];
  // the other docs the provider says it reads, so staleness (and a standalone build) sees them
  const deps = createDependencyWatcher({
    repo,
    onChange: () => render(),
    keyOf: (url, h) => dependencyKeyOf(provider?.module, url, h.doc?.()),
  });

  function specs() {
    return providerMeta?.params ?? [];
  }

  async function resolveProvider() {
    const doc = handle.doc();
    const id = doc?.providerId;
    providerMeta = id && registry?.has(id) ? registry.get(id) : null;
    render();
    if (!providerMeta) return;
    try {
      const loaded = await registry.load(id);
      if (dead) return;
      provider = loaded?.module ? { id, name: loaded.name, params: loaded.params ?? [], cost: loaded.cost, version: loaded.version, module: loaded.module } : null;
    } catch (err) {
      console.warn("[scene-render-controls] provider failed to load", err);
      provider = null;
    }
    render();
  }

  async function resolveSource() {
    const parent = handle.doc()?.parent;
    if (!parent || sourceHandle?.url === parent) return;
    try {
      const h = await repo.find(parent);
      if (dead) return;
      sourceHandle?.off("change", render);
      sourceHandle = h;
      h.on("change", render);
      render();
    } catch {
      // source unavailable; status shows what we know
    }
  }

  function render() {
    if (dead) return;
    const doc = handle.doc();
    if (!doc) return;
    root.toggleAttribute("data-standalone", !root.closest(".scene-tool"));

    $(".provider").textContent = providerMeta?.name ?? doc.providerId ?? "No provider";
    $(".open-source").hidden = !doc.parent;

    if (provider && sourceHandle) deps.set(dependenciesOf(provider.module, sourceHandle.doc(), sourceHandle.url));
    // undefined = can't tell yet (provider, source or a dependency not loaded)
    let reason =
      doc.builtFrom && provider && sourceHandle
        ? staleReason(doc, {
            heads: sourceHandle.heads?.() ?? [],
            fingerprint: fingerprintOf(provider.module, sourceHandle.doc()),
            deps: deps.snapshot(),
            providerVersion: provider.version,
          })
        : undefined;
    if (reason === "deps" && deps.pendingSince() != null) reason = undefined;
    let state = doc.status || "idle";
    // A failed build whose inputs have since gone back to what the current GLB
    // was built from: what's shown matches the source, so it isn't an error.
    if (state === "error" && reason === null) state = "idle";
    let label = state === "building" ? "Building…" : state === "error" ? "Error" : "Up to date";
    if (localBuilding) (state = "building"), (label = "Building…");
    if (state === "idle") {
      if (!doc.builtFrom) (state = "stale"), (label = "Not built yet");
      else if (reason) (state = "stale"), (label = doc.pinned ? "Stale (pinned)" : "Stale");
    }
    const pill = $(".status");
    pill.dataset.state = state;
    pill.textContent = label;
    $(".built").textContent = `built ${relativeTime(doc.builtAt)}`;

    const err = $(".error");
    err.hidden = !(state === "error" && doc.error);
    err.textContent = doc.error ?? "";

    const notice = $(".notice");
    const missing = doc.providerId && registry && !providerMeta;
    notice.hidden = !missing;
    notice.textContent = missing ? `The “${doc.providerId}” provider isn't installed, so these params can't be edited here.` : "";

    const nextSpecs = specs();
    const key = JSON.stringify(nextSpecs);
    if (!form || form.key !== key) {
      form?.dispose();
      form = createParamForm($(".params"), nextSpecs, (k, v) =>
        handle.change((d) => {
          if (!d.params) d.params = {};
          d.params[k] = v;
        }),
      );
      form.key = key;
    }
    form.update(doc.params ?? {});
    if (!nextSpecs.length && !missing) {
      $(".params").dataset.empty = "";
    } else {
      delete $(".params").dataset.empty;
    }

    $(".pinned").checked = !!doc.pinned;
    const btn = $(".rebuild");
    btn.disabled = localBuilding || !doc.providerId;
  }

  $(".pinned").addEventListener("change", (e) =>
    handle.change((d) => {
      d.pinned = !!e.target.checked;
    }),
  );

  $(".open-source").addEventListener("click", () => {
    const url = handle.doc()?.parent;
    if (url) {
      root.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url }, bubbles: true, composed: true }));
    }
  });

  $(".rebuild").addEventListener("click", async () => {
    const ev = new CustomEvent(REBUILD_EVENT, {
      detail: { renderUrl: handle.url },
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    root.dispatchEvent(ev);
    if (ev.defaultPrevented) return; // a scene took it
    if (!provider || !sourceHandle) {
      handle.change((d) => {
        d.status = "error";
        d.error = !provider ? "Provider is not installed" : "Source document is not available";
      });
      return;
    }
    localBuilding = true;
    render();
    try {
      deps.set(dependenciesOf(provider.module, sourceHandle.doc(), sourceHandle.url));
      await runBuild({ repo, renderHandle: handle, sourceHandle, provider, deps: deps.snapshot() });
    } catch (err) {
      console.warn(errorMessage(err));
    } finally {
      localBuilding = false;
      render();
    }
  });

  const onChange = () => {
    const doc = handle.doc();
    if (doc?.providerId !== (providerMeta?.id ?? provider?.id)) resolveProvider();
    if (doc?.parent !== sourceHandle?.url) resolveSource();
    render();
  };
  handle.on("change", onChange);
  const tick = setInterval(render, 30_000);

  import("@inkandswitch/patchwork-plugins")
    .then(({ getRegistry }) => {
      if (dead) return;
      registry = getRegistry("scene:source");
      const off = registry.on?.("changed", () => resolveProvider());
      if (typeof off === "function") offs.push(off);
      resolveProvider();
    })
    .catch((err) => console.warn("[scene-render-controls] no plugin registry", err));
  resolveSource();
  render();

  return () => {
    dead = true;
    handle.off("change", onChange);
    sourceHandle?.off("change", render);
    clearInterval(tick);
    deps.dispose();
    for (const off of offs) off();
    form?.dispose();
    root.remove();
    style.remove();
  };
}
