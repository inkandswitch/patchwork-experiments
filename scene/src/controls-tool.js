// patchwork:tool "scene-render-controls" — the generic control surface for a
// scene-render doc. It finds the provider by id, draws a form from its
// ParamSpecs, and writes params / pinned back to the render doc. It shows the
// object's content state (content/state.js) and can rebuild on demand. It
// opens nothing: the source is the inspector's Source section beside it
// (EDITOR.md, "The interface").
//
// Inside a scene the state is the scene's: the controls ask the stage around
// them with a bubbling `scene:render-context` event (the stage fills in
// `detail.state` and the object's fixed version, `detail.at`, and calls the
// `detail.tell` they pass whenever either changes, until `detail.stop()`);
// "Rebuild now" asks it with a cancelable `scene:rebuild`. Alone, with no stage answering, the
// tool has a render manager of its own (content/render-manager.js) that
// builds only when asked, and its state is that one's. `element.time` (a
// stage time, stage/time.js) is the clock that manager runs on; the page's
// by default.

import css from "./styles.css?inline";
import { createParamForm } from "./shared/param-form.js";
import { createRenderManager } from "./content/render-manager.js";
import { realTime } from "./stage/time.js";
import { handleReadOnly } from "./stage/readonly.js";
import { CONTEXT_EVENT, REBUILD_EVENT } from "./shared/embed.js";

/** The controls' root's class (their styles in styles.css). */
const CONTROLS_CLASS = "scene-render-controls";

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

/** The pill for a content state: [its data-state, its label]. */
function pillOf(st) {
  switch (st?.state) {
    case "building":
      return ["building", "Building…"];
    case "failed":
      return ["error", "Error"];
    case "fresh":
      return ["idle", "Up to date"];
    case "stale":
      return ["stale", st.reason === "never-built" ? "Not built yet" : st.hold === "pinned" ? "Stale (pinned)" : "Stale"];
    case "waiting":
      return ["idle", "Waiting for a linked document"];
    case "no-provider":
      return ["idle", "No provider"];
    default:
      return ["idle", "Loading…"];
  }
}

export default function SceneRenderControls(handle, element) {
  const repo = element.repo ?? globalThis.repo;
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = CONTROLS_CLASS;
  root.innerHTML = `
    <div class="head">
      <span class="provider"></span>
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
  let form = null;
  let dead = false;
  let state = null; // the object's content state: the stage's, else its own manager's
  let fixed = false; // the scene object is fixed at a version
  let own = null; // alone: { manager, parent } keeping this render
  let stop = null; // in a scene: stop being told
  const offs = [];
  const tell = (st, at) => {
    state = st;
    fixed = !!at;
    render();
  };

  /** Ask an enclosing stage for the object's state (and to be told it as it changes); alone, keep the render here. */
  function refresh() {
    if (dead) return;
    if (!stop) {
      const detail = { renderUrl: handle.url, at: null, state: undefined, tell };
      root.dispatchEvent(new CustomEvent(CONTEXT_EVENT, { detail, bubbles: true, composed: true }));
      root.toggleAttribute("data-standalone", detail.state === undefined);
      if (detail.state !== undefined) {
        own?.manager.dispose();
        own = null;
        stop = detail.stop ?? (() => {});
        state = detail.state;
        fixed = !!detail.at;
      } else if (root.isConnected) keepHere();
    }
    render();
  }

  /** Alone: a render manager of its own for this render, following the render doc's source. */
  function keepHere() {
    const parent = handle.doc()?.parent ?? null;
    if (!registry || !parent || own?.parent === parent) return;
    own?.manager.dispose();
    const manager = createRenderManager({
      repo,
      time: element.time ?? realTime(),
      readOnly: handleReadOnly(handle),
      auto: false, // (it doesn't know the object's fixed version, nor keeps the render: a scene does)
      loadProvider: async (id) => {
        if (!registry.has(id)) return null;
        const p = await registry.load(id);
        return p?.module ? { id, name: p.name ?? id, params: p.params ?? [], cost: p.cost, version: p.version, module: p.module } : null;
      },
      onState: (_id, said) => {
        state = said.state;
        render();
      },
      onGLB: () => {},
    });
    own = { manager, parent };
    manager.track("render", { sourceUrl: parent, renderUrl: handle.url });
  }

  function render() {
    if (dead) return;
    const doc = handle.doc();
    if (!doc) return;
    $(".provider").textContent = providerMeta?.name ?? doc.providerId ?? "No provider";
    const [pillState, label] = pillOf(state);
    const pill = $(".status");
    pill.dataset.state = pillState;
    pill.textContent = label;
    $(".built").textContent = `built ${relativeTime(doc.builtAt)}${fixed ? " · fixed version" : ""}`;

    const err = $(".error");
    err.hidden = state?.state !== "failed" || !state.error;
    err.textContent = state?.state === "failed" ? (state.error ?? "") : "";

    const notice = $(".notice");
    const missing = doc.providerId && registry && !providerMeta;
    notice.hidden = !missing;
    notice.textContent = missing ? `The “${doc.providerId}” provider isn't installed, so these params can't be edited here.` : "";

    const specs = providerMeta?.params ?? [];
    const key = JSON.stringify(specs);
    if (!form || form.key !== key) {
      form?.dispose();
      form = createParamForm($(".params"), specs, (k, v) =>
        handle.change((d) => {
          if (!d.params) d.params = {};
          d.params[k] = v;
        }),
      );
      form.key = key;
    }
    form.update(doc.params ?? {});
    if (!specs.length && !missing) $(".params").dataset.empty = "";
    else delete $(".params").dataset.empty;

    $(".pinned").checked = !!doc.pinned;
    $(".rebuild").disabled = state?.state === "building" || !doc.providerId;
  }

  $(".pinned").addEventListener("change", (e) =>
    handle.change((d) => {
      d.pinned = !!e.target.checked;
    }),
  );

  $(".rebuild").addEventListener("click", () => {
    const ev = new CustomEvent(REBUILD_EVENT, { detail: { renderUrl: handle.url }, bubbles: true, composed: true, cancelable: true });
    root.dispatchEvent(ev);
    if (!ev.defaultPrevented) own?.manager.rebuild("render"); // (else a stage took it)
  });

  const onChange = () => {
    const id = handle.doc()?.providerId;
    providerMeta = id && registry?.has(id) ? registry.get(id) : null;
    refresh();
  };
  handle.on("change", onChange);
  const tick = setInterval(render, 30_000);
  // (mounted before it's in the document, it asks again once it is)
  const later = setTimeout(refresh, 0);

  import("@inkandswitch/patchwork-plugins")
    .then(({ getRegistry }) => {
      if (dead) return;
      registry = getRegistry("scene:source");
      const off = registry.on?.("changed", () => {
        onChange();
        own?.manager.providersChanged();
      });
      if (typeof off === "function") offs.push(off);
      onChange();
    })
    .catch((err) => console.warn("[scene-render-controls] no plugin registry", err));
  render();

  return () => {
    dead = true;
    handle.off("change", onChange);
    clearInterval(tick);
    clearTimeout(later);
    own?.manager.dispose();
    stop?.();
    for (const off of offs) off();
    form?.dispose();
    root.remove();
    style.remove();
  };
}
