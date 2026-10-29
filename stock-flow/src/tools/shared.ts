import type { AutomergeUrl as RepoUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { element } from "../charts/svg.ts";
import { styles } from "../views/styles.ts";
import type { AutomergeUrl, StockFlowModelDoc } from "../types.ts";

/**
 * A tool for a document that points at a model: re-renders `view(model, doc)` whenever either changes, with a footer
 * that opens the model. The chart, tests, sensitivity and attribution tools are all this shape.
 */
export function modelBoundTool<Doc extends { model: AutomergeUrl }>(className: string, view: (model: StockFlowModelDoc, doc: Doc) => HTMLElement): ToolRender<Doc> {
  return (handle, toolElement) => {
    const { root, unmount } = mount(toolElement, className);
    let doc: Doc | undefined;
    let model: StockFlowModelDoc | undefined;
    let problem: string | undefined;

    const render = () => {
      if (problem) return root.replaceChildren(element("p", { class: "sf-error" }, problem));
      if (!doc || !model) return root.replaceChildren(element("p", { class: "sf-muted" }, "Loading the model…"));
      let body: HTMLElement;
      try {
        body = view(model, doc);
      } catch (error) {
        body = element("p", { class: "sf-error" }, errorMessage(error));
      }
      const open = element("button", { title: "Open the model this runs on" }, model.title);
      open.addEventListener("click", () => openDocument(root, doc!.model));
      const footer = element("footer");
      footer.append("Model:", open);
      root.replaceChildren(body, footer);
    };

    const follow = watchModel(
      toolElement.repo,
      () => doc?.model,
      (next, error) => {
        model = next;
        problem = error;
        render();
      },
    );
    const stop = watch(handle, (next) => {
      doc = next;
      follow.refresh();
      render();
    });
    const stopResize = onResize(root, render);
    return () => {
      stop();
      follow.stop();
      stopResize();
      unmount();
    };
  };
}

/** A root element with the shared styles, removed again by the returned cleanup. */
export function mount(element: HTMLElement, className: string): { root: HTMLDivElement; unmount: () => void } {
  const style = document.createElement("style");
  style.textContent = styles;
  const root = document.createElement("div");
  root.className = `sf ${className}`;
  element.append(style, root);
  return {
    root,
    unmount: () => {
      root.remove();
      style.remove();
    },
  };
}

/** Calls back with the document now and after every change. */
export function watch<T>(handle: DocHandle<T>, onChange: (doc: T) => void): () => void {
  const listener = () => {
    const doc = handle.doc();
    if (doc) onChange(doc);
  };
  handle.on("change", listener);
  listener();
  return () => handle.off("change", listener);
}

/** Follows the model a chart or scenario document points at, switching when the pointer changes. */
export function watchModel(
  repo: Repo,
  url: () => AutomergeUrl | undefined,
  onChange: (model: StockFlowModelDoc | undefined, error?: string) => void,
): { refresh: () => void; stop: () => void } {
  let current: AutomergeUrl | undefined;
  let stopWatching = () => {};
  let stopped = false;
  const refresh = () => {
    const next = url();
    if (next === current) return;
    current = next;
    stopWatching();
    stopWatching = () => {};
    if (!next) return onChange(undefined, "This document doesn't name a model.");
    repo
      .find<StockFlowModelDoc>(next as RepoUrl)
      .then((handle) => {
        if (stopped || current !== next) return;
        stopWatching = watch(handle, (model) => onChange(model));
      })
      .catch((error: unknown) => onChange(undefined, `Can't load the model: ${error instanceof Error ? error.message : String(error)}`));
  };
  refresh();
  return {
    refresh,
    stop: () => {
      stopped = true;
      stopWatching();
    },
  };
}

export function openDocument(from: Element, url: string): void {
  from.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url }, bubbles: true, composed: true }));
}

/** Calls back when the element's width changes. */
export function onResize(element: HTMLElement, callback: () => void): () => void {
  let width = element.clientWidth;
  const observer = new ResizeObserver(() => {
    if (element.clientWidth === width) return;
    width = element.clientWidth;
    callback();
  });
  observer.observe(element);
  return () => observer.disconnect();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
