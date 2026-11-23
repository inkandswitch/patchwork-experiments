// The Quick Open palette (see `quickOpenItems.ts`): a box at the top of the frame,
// a name typed into it, the matches below. ↑/↓ move, Enter opens (Shift
// keeps the tab it would replace, Alt opens beside, as clicks do), Escape or
// a click elsewhere closes. ⌘P again moves down, as in VS Code.

import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { HasPatchworkMetadata } from "@inkandswitch/patchwork-filesystem";
import {
  getRegistry,
  type DatatypeDescription,
  type DatatypeImplementation,
} from "@inkandswitch/patchwork-plugins";
import type { PluginRegistry } from "@inkandswitch/patchwork-plugins/dist/registry/registry";
import { useEffect, useMemo, useRef, useState } from "react";
import { DocIcon } from "./DocIcon";
import {
  isQuickOpenKey,
  placementFor,
  rankItems,
  walkFolders,
  type QuickItem,
  type QuickPlacement,
} from "./quickOpenItems";
import { useDatatypeIcon } from "./useDocTitle";

/** A document's title and type, the way its tab gets them. */
const loadTitle = async (
  repo: Repo,
  url: AutomergeUrl,
): Promise<{ name: string; type?: string } | null> => {
  try {
    const doc = (await repo.find<HasPatchworkMetadata>(url)).doc();
    const type = doc?.["@patchwork"]?.type;
    if (!doc || !type) return null;
    const registry = getRegistry("patchwork:datatype") as PluginRegistry<
      DatatypeDescription,
      DatatypeImplementation
    >;
    const datatype = await registry.load(type);
    return { name: datatype?.module.getTitle(doc) || "", type };
  } catch {
    return null;
  }
};

/** A name with the matched letters marked. */
const Marked = ({ name, hits }: { name: string; hits: number[] }) => {
  const set = new Set(hits);
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < name.length; i++) {
    const hit = set.has(i);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += name[i];
    else parts.push({ text: name[i], hit });
  }
  return (
    <>
      {parts.map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : part.text))}
    </>
  );
};

const Row = ({
  id,
  item,
  hits,
  selected,
  onChoose,
  onHover,
}: {
  id: string;
  item: QuickItem;
  hits: number[];
  selected: boolean;
  onChoose: (event: React.MouseEvent) => void;
  onHover: () => void;
}) => {
  const icon = useDatatypeIcon(item.type);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  return (
    <li
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected}
      className="tile-quick-open__row"
      data-url={item.url}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onChoose}
      onMouseMove={onHover}
    >
      <span className="tile-panel__tab-icon">
        <DocIcon name={icon} />
      </span>
      <span className="tile-quick-open__name">
        <Marked name={item.name} hits={hits} />
      </span>
      <span className="tile-quick-open__where">
        {item.open ? "open" : item.path}
      </span>
    </li>
  );
};

export const QuickOpen = ({
  repo,
  rootFolderUrl,
  openUrls,
  currentUrl,
  onChoose,
  onClose,
}: {
  repo: Repo;
  rootFolderUrl: AutomergeUrl | undefined;
  /** Open documents, most recent first (see `openTabUrls`). */
  openUrls: AutomergeUrl[];
  /** The document you're looking at: not the first suggestion, since it's here. */
  currentUrl: AutomergeUrl | undefined;
  onChoose: (url: AutomergeUrl, placement: QuickPlacement) => void;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [folderItems, setFolderItems] = useState<QuickItem[]>([]);
  const [titles, setTitles] = useState<Map<AutomergeUrl, { name: string; type?: string }>>(
    () => new Map(),
  );
  const rootRef = useRef<HTMLDivElement>(null);

  // The folder tree, filling in as it loads.
  useEffect(() => {
    if (!rootFolderUrl) return;
    const abort = new AbortController();
    void walkFolders(repo, rootFolderUrl, setFolderItems, abort.signal);
    return () => abort.abort();
  }, [repo, rootFolderUrl]);

  // Titles for open documents the folder tree doesn't name.
  useEffect(() => {
    let cancelled = false;
    for (const url of openUrls) {
      void loadTitle(repo, url).then((title) => {
        if (cancelled || !title) return;
        setTitles((prev) => (prev.has(url) ? prev : new Map(prev).set(url, title)));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [repo, openUrls]);

  const items = useMemo(() => {
    const inFolders = new Map(folderItems.map((item) => [item.url, item]));
    const open: QuickItem[] = openUrls.map((url) => {
      const known = titles.get(url) ?? inFolders.get(url);
      return {
        url,
        name: known?.name || url.replace(/^automerge:/, "").slice(0, 8),
        type: known?.type,
        open: true,
        path: "",
      };
    });
    const openSet = new Set(openUrls);
    return [...open, ...folderItems.filter((item) => !openSet.has(item.url))];
  }, [openUrls, folderItems, titles]);

  const ranked = useMemo(() => rankItems(query, items), [query, items]);

  // With nothing typed, start on the first document that isn't the one in
  // front of you: ⌘P, Enter goes back to the last one.
  useEffect(() => {
    const first = query ? 0 : ranked.findIndex((r) => r.item.url !== currentUrl);
    setCursor(Math.max(0, first));
    // Only when the query changes; the list filling in mustn't move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  const move = (step: number) =>
    setCursor((c) => (ranked.length ? (c + step + ranked.length) % ranked.length : 0));

  const choose = (index: number, mods: { shiftKey: boolean; altKey: boolean }) => {
    const row = ranked[index];
    if (row) onChoose(row.item.url, placementFor(mods));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || isQuickOpenKey(event.nativeEvent)) {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(cursor, event);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="tile-quick-open" ref={rootRef} role="dialog" aria-label="Open a document">
      <input
        className="tile-quick-open__input"
        autoFocus
        placeholder="Open a document by name"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded
        aria-controls="tile-quick-open-list"
        aria-activedescendant={ranked[cursor] ? `tile-quick-open-${cursor}` : undefined}
      />
      <ul className="tile-quick-open__list" id="tile-quick-open-list" role="listbox">
        {ranked.map(({ item, match }, i) => (
          <Row
            key={item.url}
            id={`tile-quick-open-${i}`}
            item={item}
            hits={match.hits}
            selected={i === cursor}
            onChoose={(event) => choose(i, event)}
            onHover={() => setCursor(i)}
          />
        ))}
        {ranked.length === 0 && (
          <li className="tile-quick-open__none">{query ? "Nothing by that name" : "Nothing open"}</li>
        )}
      </ul>
    </div>
  );
};
