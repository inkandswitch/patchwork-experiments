import { createSignal, createMemo, type Accessor } from "solid-js";
import type { BulletsDoc } from "../datatype.ts";
import { searchBullets } from "../search.ts";
import { MAX_SEARCH_RESULTS } from "../constants.ts";

export function useSearch(deps: {
  doc: BulletsDoc;
  reachableIds: Accessor<Set<string>>;
  goToContext: (id: string) => void;
  getDisplayText: (id: string, content: string) => string;
  closeFavorites: () => void;
  getSearchInputRef: () => HTMLInputElement | undefined;
}) {
  const [showSearch, setShowSearch] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchSelectedIdx, setSearchSelectedIdx] = createSignal(-1);

  const searchResults = createMemo(() => {
    const results = searchBullets(deps.doc, searchQuery(), deps.getDisplayText, MAX_SEARCH_RESULTS, deps.reachableIds());
    setSearchSelectedIdx(-1);
    return results;
  });

  function navigateToResult(result: { id: string }) {
    deps.goToContext(result.id);
    closeSearch();
  }

  function openSearch() {
    setShowSearch(true);
    deps.closeFavorites();
    setSearchSelectedIdx(-1);
    requestAnimationFrame(() => deps.getSearchInputRef()?.focus());
  }

  function closeSearch() {
    setShowSearch(false);
    setSearchQuery("");
    setSearchSelectedIdx(-1);
  }

  function handleSearchKey(e: KeyboardEvent, containerRef: HTMLElement | undefined) {
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      const active = document.activeElement;
      if (!active || !containerRef?.contains(active)) return;
      if (active.closest(".automerge-embed-container")) return;
      e.preventDefault();
      if (showSearch()) {
        deps.getSearchInputRef()?.focus();
      } else {
        openSearch();
      }
    }
    if (e.key === "Escape" && showSearch()) {
      closeSearch();
    }
  }

  return {
    showSearch,
    searchQuery,
    setSearchQuery,
    searchSelectedIdx,
    setSearchSelectedIdx,
    searchResults,
    navigateToResult,
    openSearch,
    closeSearch,
    handleSearchKey,
  };
}
