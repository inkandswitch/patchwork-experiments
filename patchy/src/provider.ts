import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";

import { providePatchLayers } from "./layers/index.js";

import {
  FOLDER_SELECTOR,
  HIGHLIGHTS_SELECTOR,
  patchFolder,
  type PatchFolder,
  type PatchHighlights,
} from "./folder.js";
import { colourOf } from "./util.js";

/**
 * Lays this browser's patch folder over every document resolved beneath it,
 * tells the panel which folder that is, and tells editors whether (and how)
 * to highlight what the patches change.
 */
export const PatchLayersProvider = (element: HTMLElement) => {
  const repo = "repo" in window ? (window.repo as Repo) : undefined;
  if (!repo) {
    console.warn("[patches] window.repo is not set; patch layers disabled");
    return () => {};
  }
  // The realm's own repo, not the one this view is handed: patch docs and
  // their folder must never be remapped (a draft would clone them).
  const folder = patchFolder(repo);
  const stopLayers = providePatchLayers(element, { repo, folder });

  const onSubscribe = (event: SubscribeEvent) => {
    const { type } = event.detail.selector;
    if (type === FOLDER_SELECTOR) {
      accept<string>(event, (respond) => {
        void folder.then(respond);
      });
    } else if (type === HIGHLIGHTS_SELECTOR) {
      // Editors ask whether to highlight what patches change, and how each
      // laid patch looks. The switch is the panel's, kept on the folder.
      accept<PatchHighlights>(event, (respond) => {
        let handle: DocHandle<PatchFolder> | undefined;
        let stopped = false;
        const send = () => {
          const f = handle?.doc();
          const patches: PatchHighlights["patches"] = {};
          for (const link of f?.docs ?? []) {
            if (link?.type !== "patch" || link.off) continue;
            const { fill, wash } = colourOf(link.url);
            patches[link.url] = { fill, wash, name: link.name };
          }
          respond({ on: !!f?.highlight, patches });
        };
        void folder
          .then((url) => repo.find<PatchFolder>(url))
          .then((h) => {
            if (stopped) return;
            handle = h;
            h.on("change", send);
            send();
          });
        return () => {
          stopped = true;
          handle?.off("change", send);
        };
      });
    }
  };
  element.addEventListener("patchwork:subscribe", onSubscribe);

  return () => {
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    stopLayers();
  };
};
