import { getHeads } from "@automerge/automerge";
import { type AutomergeUrl, encodeHeads, parseAutomergeUrl, stringifyAutomergeUrl } from "@automerge/automerge-repo";
import { useDocument, useDocuments } from "@automerge/automerge-repo-react-hooks";
import { useEffect, useRef } from "react";
import type { ToolSketchDoc } from "../datatype.ts";

/**
 * Watch `moduleFolders` on the TLDrawDoc and load each folder as a module
 * via `patchwork-view`'s moduleWatcher whenever its heads change.
 */
export function useModuleFolders(docUrl: AutomergeUrl) {
  const [doc] = useDocument<ToolSketchDoc>(docUrl);
  const folderUrls = doc?.moduleFolders ?? [];

  const loadedUrlsRef = useRef(new Set<string>());

  useEffect(() => {
    // Find all folderUrls that haven't been loaded yet
    const newUrls = folderUrls.filter((url) => !loadedUrlsRef.current.has(url));
    if (newUrls.length === 0) return;

    newUrls.forEach((url) => {
      loadedUrlsRef.current.add(url);
      console.log(`[useModuleFolders] Loading module folder: ${url}`);
    });

    try {
      // hack to get acces to the moduleWatcher
      const el = document.createElement("patchwork-view") as any;
      el.moduleWatcher.loadModules(newUrls);
    } catch (err) {
      console.error(`[useModuleFolders] Failed to load module folders ${newUrls.join(", ")}:`, err);
    }
  }, [folderUrls]);
}
