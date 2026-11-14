// A run opened on its own: the same view the case shows for its selected run.
import css from "./styles.css?inline";
import { mountRunView } from "./run-view.js";

export default function RunTool(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "openfoam";
  root.innerHTML = `<div class="flow" style="padding:var(--studio-space-lg, 24px);max-width:900px"><input class="title" aria-label="Title"><div class="hint back"></div><div class="host"></div></div>`;
  element.append(style, root);
  const title = root.querySelector(".title");
  title.addEventListener("change", () => handle.change((d) => (d.title = title.value)));
  const view = mountRunView(root.querySelector(".host"), { repo: handle.repo ?? window.repo });
  view.show(handle);
  const render = () => {
    const d = handle.doc();
    if (document.activeElement !== title) title.value = d.title ?? "";
    const back = root.querySelector(".back");
    back.innerHTML = d.case ? `from a case: <a href="#" class="open-case">open it</a>` : "";
    back.querySelector(".open-case")?.addEventListener("click", (e) => {
      e.preventDefault();
      element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url: d.case, toolId: "openfoam-case" }, bubbles: true, composed: true }));
    });
  };
  render();
  handle.on("change", render);
  return () => {
    handle.off("change", render);
    view.dispose();
    root.remove();
    style.remove();
  };
}
