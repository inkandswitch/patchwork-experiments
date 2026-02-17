import { UMAP } from 'umap-js';
import type { AutomergeUrl } from '@automerge/automerge-repo';

export type Point2D = [number, number];

/**
 * Run UMAP to reduce high-dimensional embedding vectors to 2D coordinates.
 * Returns a map from doc URL to [x, y] position, normalized to [-scale, scale].
 */
export async function projectToUMAP(
  vectors: Map<AutomergeUrl, number[]>,
  options?: {
    nComponents?: number;
    scale?: number;
    onEpoch?: (epoch: number, totalEpochs: number) => void;
  },
): Promise<Map<AutomergeUrl, Point2D>> {
  const nComponents = options?.nComponents ?? 2;
  const scale = options?.scale ?? 500;

  const urls = Array.from(vectors.keys());
  const data = urls.map((url) => vectors.get(url)!);

  if (data.length < 2) {
    const result = new Map<AutomergeUrl, Point2D>();
    if (data.length === 1) {
      result.set(urls[0], [0, 0]);
    }
    return result;
  }

  const nNeighbors = Math.min(15, data.length - 1);

  const umap = new UMAP({
    nComponents,
    nNeighbors,
    minDist: 0.1,
    spread: 1.0,
  });

  const totalEpochs = umap.initializeFit(data);

  const embedding = await umap.fitAsync(data, (epoch) => {
    options?.onEpoch?.(epoch, totalEpochs);
    return true;
  });

  const normalized = normalize(embedding, scale);

  const result = new Map<AutomergeUrl, Point2D>();
  for (let i = 0; i < urls.length; i++) {
    const row = normalized[i];
    result.set(urls[i], [row[0], row[1]]);
  }
  return result;
}

function normalize(points: number[][], scale: number): number[][] {
  if (points.length === 0) return points;

  const dims = points[0].length;
  const mins = new Array(dims).fill(Infinity);
  const maxs = new Array(dims).fill(-Infinity);

  for (const p of points) {
    for (let d = 0; d < dims; d++) {
      if (p[d] < mins[d]) mins[d] = p[d];
      if (p[d] > maxs[d]) maxs[d] = p[d];
    }
  }

  return points.map((p) =>
    p.map((v, d) => {
      const range = maxs[d] - mins[d];
      if (range === 0) return 0;
      return ((v - mins[d]) / range) * 2 * scale - scale;
    }),
  );
}
