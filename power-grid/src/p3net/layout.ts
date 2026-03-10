// Sugiyama-inspired BFS layout — moved from petrinet/layout.ts

export type NodeLayout = {
  id: string;
  kind: 'place' | 'transition';
  x: number;
  y: number;
};

export type NetLayout = Map<string, NodeLayout>;

type LayoutNet = {
  places: { id: string }[];
  transitions: { id: string }[];
  arcs: { from: string; to: string; kind: 'in' | 'out' }[];
};

const RANK_SPACING = 200;
const NODE_SPACING = 130;
const ORIGIN_X = 120;
const ORIGIN_Y = 200;

export function computeLayout(net: LayoutNet): NetLayout {
  const layout = new Map<string, NodeLayout>();

  if (net.places.length === 0 && net.transitions.length === 0) {
    return layout;
  }

  const nodeKind = new Map<string, 'place' | 'transition'>();
  for (const p of net.places) nodeKind.set(p.id, 'place');
  for (const t of net.transitions) nodeKind.set(t.id, 'transition');

  const allIds = [...nodeKind.keys()];

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
      if (cur === undefined || rank + 1 > cur) {
        ranks.set(neighbor, rank + 1);
      }
      if (!queued.has(neighbor)) {
        queued.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  for (const id of allIds) {
    if (!ranks.has(id)) ranks.set(id, 0);
  }

  const byRank = new Map<number, string[]>();
  for (const [id, rank] of ranks) {
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank)!.push(id);
  }

  for (const [, nodes] of byRank) {
    nodes.sort((a, b) => a.localeCompare(b));
  }

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
