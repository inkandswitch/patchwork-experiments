import { isValidAutomergeUrl } from "@automerge/automerge-repo";
import type { BulletsDoc } from "./datatype.ts";

// --- Tag helpers ---

export const TAG_RE = /#[a-zA-Z0-9_-]+/g;

export function hasTag(text: string): boolean {
  TAG_RE.lastIndex = 0;
  return TAG_RE.test(text);
}

export function extractTags(text: string): string[] {
  const re = /#[a-zA-Z0-9_-]+/g;
  const tags: string[] = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    tags.push(match[0].slice(1).toLowerCase());
  }
  return tags;
}

export function isAutomergeUrl(content: string): boolean {
  return isValidAutomergeUrl(content.trim());
}

export function isYouTubeUrl(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return /^https?:\/\/(www\.)?(youtube\.com\/(watch\?[^\s]*v=|embed\/|shorts\/)|youtu\.be\/)[^\s]*$/.test(trimmed);
}

export function extractYouTubeVideoId(content: string): string | null {
  const trimmed = content.trim();
  let match;
  match = trimmed.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  match = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  match = trimmed.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  match = trimmed.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return null;
}

export function isImageDataUrl(content: string): boolean {
  return content.trim().startsWith("data:image/");
}

export function imageTypeLabel(content: string): string {
  const match = content.match(/^data:image\/([^;,]+)/);
  if (!match) return "Image";
  const type = match[1].toUpperCase();
  if (type === "JPEG" || type === "JPG") return "JPEG Image";
  if (type === "SVG+XML") return "SVG Image";
  return `${type} Image`;
}

export function isImageBullet(content: string, contentType?: string): boolean {
  return contentType === "image" || isImageDataUrl(content);
}

export function imageLabelFromMimeType(mimeType: string): string {
  const match = mimeType.match(/^image\/(.+)$/);
  if (!match) return "Image";
  const type = match[1].toUpperCase();
  if (type === "JPEG" || type === "JPG") return "JPEG Image";
  if (type === "SVG+XML") return "SVG Image";
  return `${type} Image`;
}

/** Find which node's children array contains the given id */
export function findParentId(
  doc: BulletsDoc,
  id: string
): string | null {
  if (!doc.nodes) return null;
  for (const nodeId of Object.keys(doc.nodes)) {
    const node = doc.nodes[nodeId];
    if (node?.children?.includes(id)) return nodeId;
  }
  return null;
}

/**
 * Find the previous visible bullet in document order.
 * contextRootId defines the scope (what's currently displayed as root).
 * parentId disambiguates when the same node appears multiple times (mirrors).
 * Returns both the target id and its parentId so the caller can focus the correct instance.
 */
export function findPreviousVisibleId(
  doc: BulletsDoc,
  contextRootId: string,
  id: string,
  parentId?: string,
  isCollapsed?: (id: string) => boolean
): { id: string; parentId: string } | null {
  const flat = flattenVisibleWithParent(doc, contextRootId, isCollapsed);
  const idx = parentId
    ? flat.findIndex((e) => e.id === id && e.parentId === parentId)
    : flat.findIndex((e) => e.id === id);
  if (idx <= 0) return null;
  return flat[idx - 1];
}

/**
 * Find the next visible bullet in document order.
 * parentId disambiguates when the same node appears multiple times (mirrors).
 * Returns both the target id and its parentId so the caller can focus the correct instance.
 */
export function findNextVisibleId(
  doc: BulletsDoc,
  contextRootId: string,
  id: string,
  parentId?: string,
  isCollapsed?: (id: string) => boolean
): { id: string; parentId: string } | null {
  const flat = flattenVisibleWithParent(doc, contextRootId, isCollapsed);
  const idx = parentId
    ? flat.findIndex((e) => e.id === id && e.parentId === parentId)
    : flat.findIndex((e) => e.id === id);
  if (idx === -1 || idx >= flat.length - 1) return null;
  return flat[idx + 1];
}

/** Flatten visible bullets with their parent ID, for mirror-aware navigation. */
export function flattenVisibleWithParent(
  doc: BulletsDoc,
  rootId: string,
  isCollapsed?: (id: string) => boolean
): { id: string; parentId: string }[] {
  const result: { id: string; parentId: string }[] = [];
  const root = doc.nodes[rootId];
  if (!root) return result;
  const visited = new Set<string>([rootId]);
  for (const childId of root.children) {
    if (visited.has(childId)) continue;
    visited.add(childId);
    result.push({ id: childId, parentId: rootId });
    const child = doc.nodes[childId];
    const collapsed = isCollapsed ? isCollapsed(childId) : child?.collapsed;
    if (child && !collapsed) {
      flattenVisibleWithParentInner(doc, childId, result, visited, isCollapsed);
    }
  }
  return result;
}

function flattenVisibleWithParentInner(
  doc: BulletsDoc,
  nodeId: string,
  result: { id: string; parentId: string }[],
  visited: Set<string>,
  isCollapsed?: (id: string) => boolean
): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  for (const childId of node.children) {
    if (visited.has(childId)) continue;
    visited.add(childId);
    result.push({ id: childId, parentId: nodeId });
    const child = doc.nodes[childId];
    const collapsed = isCollapsed ? isCollapsed(childId) : child?.collapsed;
    if (child && !collapsed) {
      flattenVisibleWithParentInner(doc, childId, result, visited, isCollapsed);
    }
  }
}

/** Flatten visible bullet IDs in document order (excludes the context root itself). */
export function flattenVisibleIds(
  doc: BulletsDoc,
  rootId: string,
  isCollapsed?: (id: string) => boolean
): string[] {
  const result: string[] = [];
  const root = doc.nodes[rootId];
  if (!root) return result;
  const visited = new Set<string>([rootId]);
  for (const childId of root.children) {
    if (visited.has(childId)) continue;
    visited.add(childId);
    result.push(childId);
    const child = doc.nodes[childId];
    const collapsed = isCollapsed ? isCollapsed(childId) : child?.collapsed;
    if (child && !collapsed) {
      flattenVisibleInner(doc, childId, result, visited, isCollapsed);
    }
  }
  return result;
}

function flattenVisibleInner(
  doc: BulletsDoc,
  nodeId: string,
  result: string[],
  visited: Set<string>,
  isCollapsed?: (id: string) => boolean
): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  for (const childId of node.children) {
    if (visited.has(childId)) continue;
    visited.add(childId);
    result.push(childId);
    const child = doc.nodes[childId];
    const collapsed = isCollapsed ? isCollapsed(childId) : child?.collapsed;
    if (child && !collapsed) {
      flattenVisibleInner(doc, childId, result, visited, isCollapsed);
    }
  }
}

/** Build the breadcrumb path of IDs from root to a given node id */
export function getPathToNode(
  doc: BulletsDoc,
  rootId: string,
  targetId: string
): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  function walk(nodeId: string): boolean {
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    if (nodeId === targetId) {
      path.push(nodeId);
      return true;
    }
    const node = doc.nodes[nodeId];
    if (!node) return false;
    for (const childId of node.children) {
      if (walk(childId)) {
        path.unshift(nodeId);
        return true;
      }
    }
    return false;
  }
  walk(rootId);
  return path;
}

/** Flatten visible bullet IDs with their depth, in document order */
export type FlatEntry = { id: string; depth: number };

export function flattenVisibleWithDepth(
  doc: BulletsDoc,
  rootId: string,
  isCollapsed?: (id: string) => boolean
): FlatEntry[] {
  const result: FlatEntry[] = [];
  const root = doc.nodes[rootId];
  if (!root) return result;
  const visited = new Set<string>([rootId]);
  for (const childId of root.children) {
    if (visited.has(childId)) continue;
    visited.add(childId);
    result.push({ id: childId, depth: 0 });
    const child = doc.nodes[childId];
    const collapsed = isCollapsed ? isCollapsed(childId) : child?.collapsed;
    if (child && !collapsed) {
      flattenWithDepthInner(doc, childId, 1, result, visited, isCollapsed);
    }
  }
  return result;
}

function flattenWithDepthInner(
  doc: BulletsDoc,
  nodeId: string,
  depth: number,
  result: FlatEntry[],
  visited: Set<string>,
  isCollapsed?: (id: string) => boolean
): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  for (const childId of node.children) {
    if (visited.has(childId)) continue;
    visited.add(childId);
    result.push({ id: childId, depth });
    const child = doc.nodes[childId];
    const collapsed = isCollapsed ? isCollapsed(childId) : child?.collapsed;
    if (child && !collapsed) {
      flattenWithDepthInner(doc, childId, depth + 1, result, visited, isCollapsed);
    }
  }
}

/** Check if nodeId is a descendant of ancestorId */
export function isDescendantOf(
  doc: BulletsDoc,
  nodeId: string,
  ancestorId: string,
  visited?: Set<string>
): boolean {
  if (!visited) visited = new Set<string>();
  if (visited.has(ancestorId)) return false;
  visited.add(ancestorId);
  const ancestor = doc.nodes[ancestorId];
  if (!ancestor) return false;
  for (const childId of ancestor.children) {
    if (childId === nodeId) return true;
    if (isDescendantOf(doc, nodeId, childId, visited)) return true;
  }
  return false;
}

// --- Structural repair ---

export type Edge = { parentId: string; childId: string; index: number };

/**
 * Detect duplicate references (unintended mirrors), cycles, and orphaned
 * cycle components in the tree.
 *
 * Returns:
 * - duplicates / cycles: edges reachable from root that should be removed
 * - orphanedEntries: node IDs from orphaned cycles to re-attach to root
 * - orphanedCycles: back-edges in orphaned subgraphs to break
 *
 * Intentional mirrors (in doc.mirroredIds) are preserved.
 */
export function detectTreeIssues(
  doc: BulletsDoc
): {
  duplicates: Edge[];
  cycles: Edge[];
  orphanedEntries: string[];
  orphanedCycles: Edge[];
} {
  const duplicates: Edge[] = [];
  const cycles: Edge[] = [];
  const claimed = new Set<string>(); // nodes already seen in some parent
  const stack = new Set<string>();   // current DFS ancestor path
  // DISABLED: mirroring feature temporarily disabled, will be re-enabled later
  // const mirrorSet = new Set<string>(doc.mirroredIds ?? []);
  const mirrorSet = new Set<string>();

  function dfs(nodeId: string) {
    stack.add(nodeId);
    const node = doc.nodes[nodeId];
    if (!node) { stack.delete(nodeId); return; }

    for (let i = 0; i < node.children.length; i++) {
      const childId = node.children[i];

      if (stack.has(childId)) {
        // Cycle: child is an ancestor of current node
        cycles.push({ parentId: nodeId, childId, index: i });
        continue;
      }

      if (claimed.has(childId)) {
        if (!mirrorSet.has(childId)) {
          // Unintended duplicate. First DFS occurrence was kept
          duplicates.push({ parentId: nodeId, childId, index: i });
        }
        // Intentional mirror or already-recorded duplicate: skip recursion
        continue;
      }

      claimed.add(childId);
      dfs(childId);
    }

    stack.delete(nodeId);
  }

  claimed.add(doc.rootId);
  dfs(doc.rootId);

  // --- Orphaned cycle detection ---
  // Find nodes in the map that are unreachable from root but form cycles
  // among themselves (e.g. concurrent cross-moves: a↔b both removed from root).
  // These need to be re-attached to root so the user's data isn't silently lost.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const orphanColor = new Map<string, number>();
  for (const nodeId of Object.keys(doc.nodes ?? {})) {
    if (!claimed.has(nodeId) && nodeId !== doc.rootId) {
      orphanColor.set(nodeId, WHITE);
    }
  }

  const orphanedEntrySet = new Set<string>();
  const orphanedCycles: Edge[] = [];

  function orphanDfs(nodeId: string) {
    orphanColor.set(nodeId, GRAY);
    const node = doc.nodes[nodeId];
    if (node) {
      for (let i = 0; i < node.children.length; i++) {
        const childId = node.children[i];
        const c = orphanColor.get(childId);
        if (c === undefined) continue; // not an unreached node
        if (c === GRAY) {
          // Back-edge in orphaned subgraph → cycle
          orphanedEntrySet.add(childId);
          orphanedCycles.push({ parentId: nodeId, childId, index: i });
          continue;
        }
        if (c === WHITE) {
          orphanDfs(childId);
        }
      }
    }
    orphanColor.set(nodeId, BLACK);
  }

  // Sort orphan keys so both peers deterministically pick the same DFS
  // starting node after a concurrent cross-move merge.  Without this,
  // Object.keys order can differ between Automerge actors, causing each
  // peer to identify a different cycle entry node.  Their independent
  // repairs then merge into siblings instead of a parent-child chain.
  const sortedOrphanKeys = [...orphanColor.keys()].sort();
  for (const startId of sortedOrphanKeys) {
    if (orphanColor.get(startId) === WHITE) {
      orphanDfs(startId);
    }
  }

  return {
    duplicates,
    cycles,
    orphanedEntries: [...orphanedEntrySet],
    orphanedCycles,
  };
}

/** Get all node IDs reachable from rootId via DFS (cycle-safe). */
export function getReachableIds(doc: BulletsDoc): Set<string> {
  const reachable = new Set<string>();
  if (!doc.nodes || !doc.rootId) return reachable;
  function dfs(nodeId: string) {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    const node = doc.nodes[nodeId];
    if (!node) return;
    for (const childId of node.children) {
      dfs(childId);
    }
  }
  dfs(doc.rootId);
  return reachable;
}

/** Collect a node and all its descendant IDs */
export function collectDescendantIds(
  doc: BulletsDoc,
  nodeId: string,
  visited?: Set<string>
): string[] {
  if (!visited) visited = new Set<string>();
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);
  const ids: string[] = [nodeId];
  const node = doc.nodes[nodeId];
  if (!node) return ids;
  for (const childId of node.children) {
    ids.push(...collectDescendantIds(doc, childId, visited));
  }
  return ids;
}
