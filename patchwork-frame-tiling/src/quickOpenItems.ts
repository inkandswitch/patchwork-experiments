// Quick Open (⌘P, Ctrl-P elsewhere): find a document by name and open it.
// What it lists: every tab open in the frame, the most recently focused
// panel's first, then every document in your folder tree. It matches names
// loosely, as editors do: the letters in order, anywhere, ranked so a run of
// them, the start of the name, or the starts of words count for most.

import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import { leafTabs } from "./layout";
import type { LayoutNode, LeafNode } from "./types";

/** One thing Quick Open can open. */
export type QuickItem = {
  url: AutomergeUrl;
  /** Its name: a folder entry's, or the document's own title. */
  name: string;
  /** Its datatype id, for the icon. */
  type?: string;
  /** Open in a panel, or only in the folder tree. */
  open: boolean;
  /** The folders it's in, from your root ("" for the root itself). */
  path: string;
};

/** Where a chosen item goes, from the modifiers held (see `OpenPlacement`). */
export type QuickPlacement = "stack" | "horizontal" | "vertical" | undefined;

export const placementFor = (mods: { shiftKey: boolean; altKey: boolean }): QuickPlacement =>
  mods.altKey ? (mods.shiftKey ? "vertical" : "horizontal") : mods.shiftKey ? "stack" : undefined;

const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** ⌘P on a Mac (where Ctrl-P is a line up in text), Ctrl-P elsewhere. */
export const isQuickOpenKey = (event: KeyboardEvent, mac = isMac()): boolean =>
  event.key.toLowerCase() === "p" &&
  !event.altKey &&
  !event.shiftKey &&
  (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

const allLeaves = (node: LayoutNode | null): LeafNode[] =>
  !node
    ? []
    : node.kind === "leaf"
      ? [node]
      : [...allLeaves(node.children[0]), ...allLeaves(node.children[1])];

/**
 * Every open document, once: panels most recently focused first (then the
 * rest in layout order), and in each, the showing tab first, then the strip
 * left to right.
 */
export const openTabUrls = (
  layout: LayoutNode | null,
  focusOrder: readonly string[],
): AutomergeUrl[] => {
  const leaves = allLeaves(layout).filter((leaf) => leaf.view.role !== "root-folder");
  const rank = (leaf: LeafNode) => {
    const i = focusOrder.lastIndexOf(leaf.id);
    return i < 0 ? -1 : i;
  };
  const ordered = leaves
    .map((leaf, i) => ({ leaf, i }))
    .sort((a, b) => rank(b.leaf) - rank(a.leaf) || a.i - b.i)
    .map(({ leaf }) => leaf);
  const urls: AutomergeUrl[] = [];
  for (const leaf of ordered) {
    const { tabs, active } = leafTabs(leaf);
    for (const tab of [tabs[active], ...tabs.filter((_, i) => i !== active)]) {
      if (tab?.url && !urls.includes(tab.url)) urls.push(tab.url);
    }
  }
  return urls;
};

/** Most documents the folder walk collects, so a huge tree stays quick. */
export const FOLDER_WALK_LIMIT = 5000;

/**
 * Every document in the folder tree under `rootUrl`, breadth first (so the
 * nearest come first), each folder once however often it's linked. Calls
 * `onItems` with everything found so far after each level, so the list fills
 * in while deep folders load; a folder that won't load is skipped.
 */
export const walkFolders = async (
  repo: Repo,
  rootUrl: AutomergeUrl,
  onItems: (items: QuickItem[]) => void,
  signal?: AbortSignal,
  limit = FOLDER_WALK_LIMIT,
): Promise<QuickItem[]> => {
  const items: QuickItem[] = [];
  const seen = new Set<string>([rootUrl]);
  let level: { url: AutomergeUrl; path: string }[] = [{ url: rootUrl, path: "" }];
  while (level.length && items.length < limit && !signal?.aborted) {
    const loaded = await Promise.allSettled(
      level.map(async ({ url, path }) => ({
        doc: (await repo.find<FolderDoc>(url)).doc(),
        path,
      })),
    );
    const next: typeof level = [];
    for (const result of loaded) {
      if (result.status !== "fulfilled") continue;
      const { doc, path } = result.value;
      for (const link of doc?.docs ?? []) {
        if (!link?.url || seen.has(link.url) || items.length >= limit) continue;
        seen.add(link.url);
        items.push({ url: link.url, name: link.name, type: link.type, open: false, path });
        if (link.type === "folder") {
          next.push({ url: link.url, path: path ? `${path} › ${link.name}` : link.name });
        }
      }
    }
    if (signal?.aborted) break;
    onItems([...items]);
    level = next;
  }
  return items;
};

/** How a name matches a query: its score, and which characters matched. */
export type Match = { score: number; hits: number[] };

const isWordStart = (name: string, i: number): boolean => {
  if (i === 0) return true;
  const prev = name[i - 1];
  const here = name[i];
  if (!/[\p{L}\p{N}]/u.test(prev)) return true;
  return /\p{Ll}/u.test(prev) && /\p{Lu}/u.test(here);
};

/**
 * Whether `name` holds the query's letters in order (case and spaces
 * ignored), and how well, best first:
 *  1. a run of them starting the name ("rig" in "Rigging");
 *  2. a run starting a word ("Main rig");
 *  3. initials: every letter starting a word ("sp" in "Sail plan");
 *  4. a run inside a word ("Frigate");
 *  5. scattered, more for word starts and letters side by side.
 * Within each, a shorter name first. Null when it doesn't match. An empty
 * query matches everything equally.
 */
export const matchName = (query: string, name: string): Match | null => {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, hits: [] };
  const at = name.toLowerCase().indexOf(q);
  if (at >= 0 && (at === 0 || isWordStart(name, at))) {
    const hits = Array.from({ length: q.length }, (_, k) => at + k);
    return { score: (at === 0 ? 5000 : 4000) - name.length, hits };
  }
  const spread = scattered(q, name);
  if (spread && spread.hits.every((i) => isWordStart(name, i))) {
    return { score: 3000 - name.length, hits: spread.hits };
  }
  if (at >= 0) {
    const hits = Array.from({ length: q.length }, (_, k) => at + k);
    return { score: 2000 - name.length, hits };
  }
  return spread;
};

/**
 * The query's letters spread through the name: each at the next word start
 * that has it, else the next place at all. Scored for word starts and for
 * letters side by side.
 */
const scattered = (q: string, name: string): Match | null => {
  const lower = name.toLowerCase();
  const hits: number[] = [];
  let from = 0;
  for (const ch of q) {
    let found = -1;
    for (let i = from; i < lower.length; i++) {
      if (lower[i] === ch && isWordStart(name, i)) {
        found = i;
        break;
      }
    }
    if (found < 0) found = lower.indexOf(ch, from);
    if (found < 0) return null;
    hits.push(found);
    from = found + 1;
  }
  let score = 0;
  hits.forEach((i, k) => {
    if (isWordStart(name, i)) score += 10;
    if (k > 0 && hits[k - 1] === i - 1) score += 5;
  });
  return { score: score - name.length, hits };
};

/** Most rows the list shows; type more to narrow it. */
export const QUICK_OPEN_ROWS = 50;

/**
 * The items matching `query`, best first; equal scores keep the given order
 * (open tabs by recency, then the folder tree nearest first).
 */
export const rankItems = (
  query: string,
  items: readonly QuickItem[],
  rows = QUICK_OPEN_ROWS,
): { item: QuickItem; match: Match }[] =>
  items
    .map((item, i) => ({ item, match: matchName(query, item.name), i }))
    .filter((r): r is { item: QuickItem; match: Match; i: number } => r.match !== null)
    .sort((a, b) => b.match.score - a.match.score || a.i - b.i)
    .slice(0, rows)
    .map(({ item, match }) => ({ item, match }));
