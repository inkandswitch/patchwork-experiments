import { DBSCAN } from 'density-clustering';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { Point2D } from './projection';
import type { LeafDoc } from './tool';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Cluster = {
  id: number; // -1 for noise
  memberIndices: number[];
  centroid2D: Point2D;
  centroid384: number[];
  label: string;
  color: [number, number, number]; // RGB 0-255 for deck.gl
};

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

const CLUSTER_COLORS: [number, number, number][] = [
  [99, 102, 241],   // indigo
  [245, 158, 11],   // amber
  [16, 185, 129],   // emerald
  [239, 68, 68],    // red
  [139, 92, 246],   // violet
  [6, 182, 212],    // cyan
  [249, 115, 22],   // orange
  [236, 72, 153],   // pink
  [20, 184, 166],   // teal
  [132, 204, 22],   // lime
];

const NOISE_COLOR: [number, number, number] = [120, 120, 120];

// ---------------------------------------------------------------------------
// Adaptive epsilon via k-nearest-neighbor distances
// ---------------------------------------------------------------------------

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function adaptiveEpsilon(points: number[][], k: number): number {
  const knnDists: number[] = [];

  for (let i = 0; i < points.length; i++) {
    const dists: number[] = [];
    for (let j = 0; j < points.length; j++) {
      if (i !== j) dists.push(euclidean(points[i], points[j]));
    }
    dists.sort((a, b) => a - b);
    knnDists.push(dists[Math.min(k - 1, dists.length - 1)]);
  }

  knnDists.sort((a, b) => a - b);
  // Use median k-NN distance as epsilon
  return knnDists[Math.floor(knnDists.length * 0.5)];
}

// ---------------------------------------------------------------------------
// Centroid computation
// ---------------------------------------------------------------------------

function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let d = 0; d < dim; d++) sum[d] += v[d];
  }
  return sum.map((s) => s / vectors.length);
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Candidate phrase extraction
// ---------------------------------------------------------------------------

function extractCandidatePhrases(leaves: LeafDoc[]): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const leaf of leaves) {
    const name = leaf.doc.name;

    // Full title (without extension)
    const dotIdx = name.lastIndexOf('.');
    const baseName = dotIdx > 0 ? name.slice(0, dotIdx) : name;
    addCandidate(baseName, seen, candidates);

    // Individual words from the title (skip very short ones)
    const words = baseName
      .split(/[\s_\-./]+/)
      .filter((w) => w.length > 2);
    for (const w of words) {
      addCandidate(w, seen, candidates);
    }

    // Bigrams from title words
    for (let i = 0; i < words.length - 1; i++) {
      addCandidate(`${words[i]} ${words[i + 1]}`, seen, candidates);
    }

    // Path segments
    for (const seg of leaf.path) {
      addCandidate(seg, seen, candidates);
    }

    // Doc type
    addCandidate(leaf.doc.type, seen, candidates);
  }

  return candidates;
}

function addCandidate(
  phrase: string,
  seen: Set<string>,
  out: string[],
): void {
  const key = phrase.toLowerCase().trim();
  if (key.length < 2 || seen.has(key)) return;
  seen.add(key);
  out.push(phrase.trim());
}

// ---------------------------------------------------------------------------
// Public: cluster and label
// ---------------------------------------------------------------------------

export async function clusterAndLabel(
  leaves: LeafDoc[],
  positions: Map<AutomergeUrl, Point2D>,
  vectors: Map<AutomergeUrl, number[]>,
  embedFn: (text: string) => Promise<number[]>,
): Promise<Cluster[]> {
  const urls = leaves.map((l) => l.doc.url);
  const points2D = urls.map((u) => positions.get(u)!);
  const vecs384 = urls.map((u) => vectors.get(u)!);

  // Adaptive DBSCAN parameters
  const k = Math.max(3, Math.min(10, Math.floor(leaves.length * 0.05)));
  const eps = adaptiveEpsilon(points2D, k);
  const minPts = Math.max(2, Math.floor(leaves.length * 0.02));

  // Run DBSCAN via density-clustering
  const scanner = new DBSCAN();
  const clusterArrays = scanner.run(points2D, eps, minPts);
  const noiseIndices = scanner.noise;

  // Build Cluster objects from the library output
  const clusters: Cluster[] = [];
  let colorIdx = 0;

  for (let cIdx = 0; cIdx < clusterArrays.length; cIdx++) {
    const memberIndices = clusterArrays[cIdx];
    const memberPoints = memberIndices.map((i) => points2D[i]);
    const memberVecs = memberIndices.map((i) => vecs384[i]);
    const centroid2D = computeCentroid(memberPoints) as Point2D;
    const centroid384 = computeCentroid(memberVecs);

    // Semantic labeling
    const clusterLeaves = memberIndices.map((i) => leaves[i]);
    const candidates = extractCandidatePhrases(clusterLeaves);
    let label = `Cluster ${cIdx}`;

    if (candidates.length > 0) {
      const scored: { phrase: string; score: number }[] = [];
      for (const phrase of candidates) {
        try {
          const vec = await embedFn(phrase);
          const score = cosineSimilarity(vec, centroid384);
          scored.push({ phrase, score });
        } catch {
          // skip failed embeddings
        }
      }
      scored.sort((a, b) => b.score - a.score);

      // Take top 2-3 unique, non-redundant phrases
      const topPhrases: string[] = [];
      const usedLower = new Set<string>();
      for (const { phrase } of scored) {
        const lower = phrase.toLowerCase();
        const redundant = topPhrases.some(
          (p) => p.toLowerCase().includes(lower) || lower.includes(p.toLowerCase()),
        );
        if (!redundant && !usedLower.has(lower)) {
          topPhrases.push(phrase);
          usedLower.add(lower);
          if (topPhrases.length >= 3) break;
        }
      }
      if (topPhrases.length > 0) label = topPhrases.join(', ');
    }

    const color = CLUSTER_COLORS[colorIdx++ % CLUSTER_COLORS.length];
    clusters.push({ id: cIdx, memberIndices, centroid2D, centroid384, label, color });
  }

  // Noise cluster
  if (noiseIndices.length > 0) {
    const memberPoints = noiseIndices.map((i) => points2D[i]);
    const memberVecs = noiseIndices.map((i) => vecs384[i]);
    clusters.push({
      id: -1,
      memberIndices: noiseIndices,
      centroid2D: computeCentroid(memberPoints) as Point2D,
      centroid384: computeCentroid(memberVecs),
      label: 'noise',
      color: NOISE_COLOR,
    });
  }

  return clusters;
}
