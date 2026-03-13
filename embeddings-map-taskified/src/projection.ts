import { UMAP } from 'umap-js';
import { PCA } from 'ml-pca';
import type { AutomergeUrl } from '@automerge/automerge-repo';

export type Point2D = [number, number];

export type Projector = {
  transformPoint: (vector: number[]) => Point2D;
};

export type ProjectResult = {
  positions: Map<AutomergeUrl, Point2D>;
  projector: Projector;
};

/**
 * Run PCA pre-reduction + UMAP to reduce high-dimensional embedding vectors to 2D.
 * Returns positions AND a Projector that can transform new vectors into the same 2D space.
 */
export async function projectToUMAP(
  vectors: Map<AutomergeUrl, number[]>,
  options?: {
    nComponents?: number;
    pcaDims?: number;
    scale?: number;
    onEpoch?: (epoch: number, totalEpochs: number) => void;
  },
): Promise<ProjectResult> {
  const nComponents = options?.nComponents ?? 2;
  const scale = options?.scale ?? 500;

  const urls = Array.from(vectors.keys());
  let data = urls.map((url) => vectors.get(url)!);

  if (data.length < 2) {
    const positions = new Map<AutomergeUrl, Point2D>();
    if (data.length === 1) positions.set(urls[0], [0, 0]);
    const projector: Projector = { transformPoint: () => [0, 0] };
    return { positions, projector };
  }

  // PCA pre-reduction
  const pcaTarget = options?.pcaDims ?? 50;
  const pcaDims = Math.min(pcaTarget, data.length - 1, data[0].length);
  let pcaModel: PCA | null = null;
  const needPca = data[0].length > pcaDims;
  if (needPca) {
    pcaModel = new PCA(data, { scale: false, center: true });
    data = pcaModel.predict(data, { nComponents: pcaDims }).to2DArray();
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

  // Compute and save normalization params
  const { mins, maxs, normalized } = normalizeWithParams(embedding, scale);

  const positions = new Map<AutomergeUrl, Point2D>();
  for (let i = 0; i < urls.length; i++) {
    const row = normalized[i];
    positions.set(urls[i], [row[0], row[1]]);
  }

  // Build a projector that reuses the fitted PCA/UMAP/normalization
  const projector: Projector = {
    transformPoint(vector: number[]): Point2D {
      let reduced = vector;
      if (needPca && pcaModel) {
        reduced = pcaModel.predict([vector], { nComponents: pcaDims }).to2DArray()[0];
      }
      const [raw] = umap.transform([reduced]);
      const x = applyNorm(raw[0], 0, mins, maxs, scale);
      const y = applyNorm(raw[1], 1, mins, maxs, scale);
      return [x, y];
    },
  };

  return { positions, projector };
}

function normalizeWithParams(
  points: number[][],
  scale: number,
): { mins: number[]; maxs: number[]; normalized: number[][] } {
  if (points.length === 0) return { mins: [], maxs: [], normalized: points };

  const dims = points[0].length;
  const mins = new Array(dims).fill(Infinity);
  const maxs = new Array(dims).fill(-Infinity);

  for (const p of points) {
    for (let d = 0; d < dims; d++) {
      if (p[d] < mins[d]) mins[d] = p[d];
      if (p[d] > maxs[d]) maxs[d] = p[d];
    }
  }

  const normalized = points.map((p) =>
    p.map((v, d) => applyNorm(v, d, mins, maxs, scale)),
  );

  return { mins, maxs, normalized };
}

function applyNorm(
  value: number,
  dim: number,
  mins: number[],
  maxs: number[],
  scale: number,
): number {
  const range = maxs[dim] - mins[dim];
  if (range === 0) return 0;
  return ((value - mins[dim]) / range) * 2 * scale - scale;
}
