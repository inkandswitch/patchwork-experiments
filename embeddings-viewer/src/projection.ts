import { UMAP } from 'umap-js';
import type { AutomergeUrl } from '@automerge/automerge-repo';

export type Point3D = [number, number, number];

/**
 * Run UMAP to reduce high-dimensional embedding vectors to 3D coordinates.
 * Returns a map from doc URL to [x, y, z] position, normalized to [-5, 5].
 */
export async function projectToUMAP3D(
  vectors: Map<AutomergeUrl, number[]>,
  onEpoch?: (epoch: number, totalEpochs: number) => void,
): Promise<Map<AutomergeUrl, Point3D>> {
  const urls = Array.from(vectors.keys());
  const data = urls.map((url) => vectors.get(url)!);

  // UMAP needs at least 2 points
  if (data.length < 2) {
    const result = new Map<AutomergeUrl, Point3D>();
    if (data.length === 1) {
      result.set(urls[0], [0, 0, 0]);
    }
    return result;
  }

  const nNeighbors = Math.min(15, data.length - 1);

  const umap = new UMAP({
    nComponents: 3,
    nNeighbors,
    minDist: 0.1,
    spread: 1.0,
  });

  const totalEpochs = umap.initializeFit(data);

  const embedding = await umap.fitAsync(data, (epoch) => {
    if (onEpoch) {
      onEpoch(epoch, totalEpochs);
    }
    return true;
  });

  // Normalize coordinates to [-5, 5] range
  const normalized = normalize(embedding, 5);

  const result = new Map<AutomergeUrl, Point3D>();
  for (let i = 0; i < urls.length; i++) {
    const row = normalized[i];
    result.set(urls[i], [row[0], row[1], row[2]]);
  }
  return result;
}

/**
 * Normalize an array of 3D points so each axis spans [-scale, scale].
 */
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
