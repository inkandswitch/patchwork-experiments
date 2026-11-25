// A study where it stands in a scene (`scene:view` "fea-scene-edit").
//
// Two verbs, both the editor's (they apply while Edit is held):
//
//   Analyse   on any object with geometry: makes a study of it (its part is
//             the object's own render, exactly what the scene shows), puts
//             the study in the scene beside it, and opens it.
//   Open      on a study in the scene (the scene's convention: the
//             inspector's button, the object's menu, a double-click or Enter
//             in Edit): puts a hand on the scene's stack, hides the study's
//             built GLB from this viewer, lays the study's panel over the
//             scene and draws the part in the object's place with the
//             scene's own three.js, so its faces can be pointed at there.
//             A click on the part is the panel's: it picks a face. Every
//             other event passes: the scene's orbit and the rest go on.
//             Escape: a focused field first (the scene's ladder), then it
//             puts the hand down.
//
// The panel is the study tool's own (../tool/study-panel.js), talking to the
// stage through the same small interface as it does to its own viewport.
// The scene's contract: patchwork-experiments/scene, STAGE.md ("Hands"),
// API.md ("View plugins") and EDITOR.md ("A command"). The shape is
// openscad's src/scene/editTool.tsx.

import css from "../tool/styles.css?inline";
import { createPartView } from "../view/part-view.js";
import { showLegend } from "../view/legend.js";
import { mountStudyPanel } from "../tool/study-panel.js";
import { linkPart, newStudy } from "../study-model.js";
import { STUDY_TYPE } from "../protocol.js";

/** The scene source whose objects this opens (index.js). */
export const SOURCE_ID = "fea-results";

export function create(api) {
  const overlay = api.overlay();
  api.style?.(css);
  let session = null;
  const notify = (text, kind) => api.use("notices")?.notify?.(text, kind);

  function start(stage, id) {
    session?.stop();
    const object = stage.scene().objects[id];
    if (!object?.sourceUrl) return;
    const { THREE } = stage;
    const layer = stage.world();
    layer.userData.noPick = true;
    // the part is drawn in the object's own frame: where the scene draws the study's GLB
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    layer.add(root);
    const view = createPartView(THREE, root);
    const show = stage.display(id, { hidden: true });
    const moved = () => {
      const m = stage.worldOf(id);
      root.visible = !!m;
      if (m) root.matrix.fromArray(m);
      root.matrixWorldNeedsUpdate = true;
      stage.invalidate();
    };

    const el = document.createElement("div");
    el.className = "fea hosted";
    el.style.cssText = "position: absolute; top: 8px; left: 8px; bottom: 8px; width: min(46%, 340px); pointer-events: auto; display: flex; flex-direction: column;";
    const legendHost = document.createElement("div");
    legendHost.className = "fea hosted";
    legendHost.style.cssText = "position: absolute; right: 0; bottom: 0; width: min(50%, 300px); height: 96px; pointer-events: none;";
    const legendEl = document.createElement("div");
    legendEl.className = "legend";
    legendEl.hidden = true;
    legendHost.append(legendEl);
    const hintEl = document.createElement("div");
    hintEl.className = "view-hint";
    hintEl.hidden = true;
    const hintHost = document.createElement("div");
    hintHost.className = "fea hosted";
    hintHost.style.cssText = "position: absolute; left: calc(min(46%, 340px) + 16px); top: 0; right: 0; height: 40px; pointer-events: none;";
    hintHost.append(hintEl);
    overlay.append(el, legendHost, hintHost);

    // ---- what the panel asks of a 3D view
    let onPick = null, onHover = null, stopLoop = null, lastHover = undefined;
    const raycaster = new THREE.Raycaster();
    const hitAt = (ray) => {
      if (!ray || !root.visible) return null;
      root.updateMatrixWorld(true);
      raycaster.set(new THREE.Vector3().fromArray(ray.origin), new THREE.Vector3().fromArray(ray.dir).normalize());
      return view.faceAt(raycaster);
    };
    const face = {
      view,
      onPick: (fn) => (onPick = fn),
      onHover: (fn) => (onHover = fn),
      // the camera is the scene's, and the person's: nothing here moves it
      frame() {},
      invalidate: () => stage.invalidate(),
      setLegend: (legend, note) => showLegend(legendEl, legend, note),
      setHint(text) {
        hintEl.hidden = !text;
        hintEl.textContent = text ?? "";
      },
      animate(fn) {
        stopLoop?.();
        stopLoop = null;
        if (!fn) return;
        let t = 0;
        stopLoop = stage.loop((dt) => {
          t += dt;
          fn(t);
        });
      },
    };

    let panel = null, stopped = false, putDown = () => {};
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (session?.id === id) session = null;
      putDown();
      stopLoop?.();
      panel?.dispose();
      el.remove();
      legendHost.remove();
      hintHost.remove();
      view.dispose();
      layer.removeFromParent();
      show();
      stage.invalidate();
    };
    stage.repo.find(object.sourceUrl).then(
      (handle) => {
        if (stopped) return;
        if (handle.doc()?.["@patchwork"]?.type !== STUDY_TYPE) {
          notify("This shows one run. Its study is where the setup is: open the study to change it.");
          return stop();
        }
        panel = mountStudyPanel(el, { repo: stage.repo, handle, stage: face, element: el });
        moved();
      },
      () => stop(),
    );
    putDown = api.hand({
      kind: "fea",
      name: `Setting up ${object.name ?? "study"}`,
      pointer: true,
      input: {
        // a click on the part is the panel's (a face picked, or put on the support or load being picked for)
        click(ev) {
          const hit = hitAt(ev.ray);
          if (!hit) return false;
          onPick?.(hit, ev);
          return true;
        },
        cursor(ev) {
          const hit = hitAt(ev.ray);
          const now = hit?.face ?? null;
          if (now !== lastHover) {
            lastHover = now;
            onHover?.(hit);
          }
          return hit ? "pointer" : null;
        },
      },
      // nothing of its own to step out of (a focused field is the ladder's own rung): Escape leaves
      escape: () => false,
      put: () => stop(),
    });
    // the focus leaving takes the layer and the display with it
    stage.signal.addEventListener("abort", stop, { once: true });
    session = { id, moved, stop, panel: () => panel, view, face };
    moved();
  }

  const objectOf = (target) => (typeof target === "string" ? api.focus()?.scene().objects[target] : null);
  const isStudy = (target) => objectOf(target)?.providerId === SOURCE_ID;
  /** Something with geometry of its own that isn't a study: what a study can be made of. */
  const isPart = (target) => {
    const o = objectOf(target);
    return !!o && o.kind !== "group" && o.providerId !== SOURCE_ID && !!(o.renderUrl || o.sourceUrl);
  };

  /** Make a study of an object, put it in the scene beside the object, and open it. */
  async function analyse(target) {
    const stage = api.focus();
    const o = objectOf(target);
    if (!stage || !o) return;
    const name = o.name ?? "part";
    const study = await stage.repo.create2(newStudy(`${name} · FEA`));
    // the object's render where it has one (what the scene shows, built with the scene's params); else its document
    const linked = await linkPart({ repo: stage.repo, handle: study }, o.renderUrl ?? o.sourceUrl);
    if (!linked.ok) return notify(`“${name}” can't be analysed: ${linked.error}.`, "warning");
    // beside it: the object's own placement, moved its width along x (in its parent's frame)
    const box = stage.box(target);
    const width = box ? (box.max[0] - box.min[0]) * 1.15 : 0;
    const t = o.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
    const add = await stage.addObject(study.url, {
      providerId: SOURCE_ID,
      name: `${name} · FEA`,
      parent: o.parent ?? null,
      group: o.group ?? undefined,
      transform: { position: [t.position[0] + width, t.position[1], t.position[2]], rotation: [...t.rotation], scale: t.scale },
    });
    stage.change(add);
    if (!linked.part.solid) notify(`“${name}” was read, but it isn't a closed solid: ${linked.part.problems.join("; ")}.`, "warning");
    start(stage, add.id);
  }

  return {
    commands: [
      {
        id: "fea-analyse",
        name: "Analyse (FEA)",
        hand: "edit",
        show: ["menu"],
        state: (target) => (isPart(target) ? { title: "Make a stress study of this object, beside it" } : null),
        run(target) {
          if (isPart(target)) analyse(target).catch((err) => notify(`The study couldn't be made: ${err?.message ?? err}`, "warning"));
        },
      },
      {
        // the study's Open (scene EDITOR.md, "A command"): its panel over the scene, the part in place
        id: "fea-open",
        name: "Open",
        open: true,
        key: "Enter",
        hand: "edit",
        show: ["menu"],
        state: (target) => (isStudy(target) ? { label: session?.id === target ? "Close" : "Open", title: session?.id === target ? "Close the study's setup" : "Set the study up here: pick faces on the part in place", checked: session?.id === target } : null),
        run(target) {
          const stage = api.focus();
          if (!stage || !isStudy(target)) return;
          if (session && session.id === target) session.stop();
          else start(stage, target);
        },
      },
    ],
    update() {
      session?.moved();
    },
    dispose() {
      session?.stop();
    },
    /** For probes: what is open, and what its panel and part view are showing. */
    inspect: () => ({ open: session?.id ?? null, panel: session?.panel()?.state() ?? null, showing: session?.view.showing() ?? null }),
    /** For probes: where a face of the open study's part is in the stage's frame (its centroid through the object's matrix). */
    debug: { session: () => session },
  };
}

export default { create };
