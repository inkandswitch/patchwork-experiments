import type { PetriNet } from './net';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NodeLayout = {
  id: string;
  kind: 'place' | 'transition';
  x: number;
  y: number;
};

export type NetLayout = Map<string, NodeLayout>;

// ─── Constants ────────────────────────────────────────────────────────────────

const RANK_SPACING = 200;
const NODE_SPACING = 130;
const ORIGIN_X = 120;
const ORIGIN_Y = 200;

// ─── Layout algorithm ─────────────────────────────────────────────────────────
// Sugiyama-inspired: BFS rank assignment → per-rank ordering → grid positions.

export function computeLayout(net: PetriNet): NetLayout {
  const layout = new Map<string, NodeLayout>();

  if (net.places.length === 0 && net.transitions.length === 0) {
    return layout;
  }

  const nodeKind = new Map<string, 'place' | 'transition'>();
  for (const p of net.places) nodeKind.set(p.id, 'place');
  for (const t of net.transitions) nodeKind.set(t.id, 'transition');

  const allIds = [...nodeKind.keys()];

  // Build outgoing adjacency list from arcs.
  // Arc in(P, T) means edge P → T; arc out(T, P) means edge T → P.
  const adjOut = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const id of allIds) {
    adjOut.set(id, []);
    inDegree.set(id, 0);
  }

  for (const arc of net.arcs) {
    adjOut.get(arc.from)?.push(arc.to);
    inDegree.set(arc.to, (inDegree.get(arc.to) ?? 0) + 1);
  }

  // BFS rank assignment — each node is enqueued at most once to handle cycles.
  const ranks = new Map<string, number>();
  const queue: string[] = [];
  const queued = new Set<string>();

  for (const id of allIds) {
    if ((inDegree.get(id) ?? 0) === 0) {
      queue.push(id);
      queued.add(id);
      ranks.set(id, 0);
    }
  }

  // If no source nodes (fully cyclic net), seed all nodes at rank 0
  if (queue.length === 0) {
    for (const id of allIds) {
      queue.push(id);
      queued.add(id);
      ranks.set(id, 0);
    }
  }

  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    const rank = ranks.get(id) ?? 0;
    for (const neighbor of adjOut.get(id) ?? []) {
      const cur = ranks.get(neighbor);
      // Always take the maximum rank seen for a node
      if (cur === undefined || rank + 1 > cur) {
        ranks.set(neighbor, rank + 1);
      }
      // Enqueue each node at most once — prevents infinite loops in cyclic nets
      if (!queued.has(neighbor)) {
        queued.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // Assign rank 0 to any nodes that weren't reached
  for (const id of allIds) {
    if (!ranks.has(id)) ranks.set(id, 0);
  }

  // Group by rank
  const byRank = new Map<number, string[]>();
  for (const [id, rank] of ranks) {
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank)!.push(id);
  }

  // Sort nodes within each rank alphabetically for stability
  for (const [, nodes] of byRank) {
    nodes.sort((a, b) => a.localeCompare(b));
  }

  // Assign (x, y) coordinates
  for (const [rank, nodes] of byRank) {
    const totalHeight = (nodes.length - 1) * NODE_SPACING;
    nodes.forEach((id, i) => {
      layout.set(id, {
        id,
        kind: nodeKind.get(id) ?? 'place',
        x: ORIGIN_X + rank * RANK_SPACING,
        y: ORIGIN_Y + i * NODE_SPACING - totalHeight / 2,
      });
    });
  }

  return layout;
}
