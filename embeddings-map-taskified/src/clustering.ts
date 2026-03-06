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
  centroidHD: number[];
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
// Stopwords (compact English list)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'up', 'about', 'into', 'over', 'after',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could',
  'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very',
  'just', 'also', 'now', 'here', 'there', 'when', 'where', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'only', 'own', 'same', 'that', 'this', 'these',
  'those', 'what', 'which', 'who', 'whom', 'why',
  'its', 'it', 'he', 'she', 'they', 'we', 'you', 'me', 'him', 'her',
  'us', 'them', 'my', 'your', 'his', 'our', 'their',
  'i', 'as', 'any', 'while', 'because', 'through', 'during', 'before',
  'between', 'under', 'again', 'further', 'once', 'out', 'down',
  'name', 'path', 'type', 'null', 'true', 'false', 'undefined',
  'clustering', 'string', 'number', 'object', 'array', 'value',
]);

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
// Tokenization
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function extractBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

// ---------------------------------------------------------------------------
// c-TF-IDF labeling
// ---------------------------------------------------------------------------

type TermFreqs = Map<string, number>;

function buildTermFreqs(tokens: string[]): TermFreqs {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

function cTfIdfCandidates(
  clusterTexts: string[][],
  clusterIdx: number,
  topN: number,
): string[] {
  const totalClusters = clusterTexts.length;

  // Build term freqs for this cluster
  const allTokens: string[] = [];
  for (const text of clusterTexts[clusterIdx]) {
    const tokens = tokenize(text);
    allTokens.push(...tokens);
    allTokens.push(...extractBigrams(tokens));
  }
  const tf = buildTermFreqs(allTokens);

  // IDF: how many clusters contain each term
  const clusterContainsTerm = new Map<string, number>();
  for (let c = 0; c < totalClusters; c++) {
    const termsInCluster = new Set<string>();
    for (const text of clusterTexts[c]) {
      const tokens = tokenize(text);
      for (const t of tokens) termsInCluster.add(t);
      for (const b of extractBigrams(tokens)) termsInCluster.add(b);
    }
    for (const term of termsInCluster) {
      clusterContainsTerm.set(term, (clusterContainsTerm.get(term) ?? 0) + 1);
    }
  }

  // Score = TF * IDF
  const scores: { term: string; score: number }[] = [];
  for (const [term, freq] of tf) {
    const containCount = clusterContainsTerm.get(term) ?? 1;
    const idf = Math.log(totalClusters / containCount);
    scores.push({ term, score: freq * idf });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topN).map((s) => s.term);
}

// ---------------------------------------------------------------------------
// Public: cluster and label
// ---------------------------------------------------------------------------

export async function clusterAndLabel(
  leaves: LeafDoc[],
  positions: Map<AutomergeUrl, Point2D>,
  vectors: Map<AutomergeUrl, number[]>,
  docTexts: Map<AutomergeUrl, string>,
  embedFn: (text: string) => Promise<number[]>,
): Promise<Cluster[]> {
  const urls = leaves.map((l) => l.doc.url);
  const points2D = urls.map((u) => positions.get(u)!);
  const vecsHD = urls.map((u) => vectors.get(u)!);

  // Adaptive DBSCAN parameters
  const k = Math.max(3, Math.min(10, Math.floor(leaves.length * 0.05)));
  const eps = adaptiveEpsilon(points2D, k);
  const minPts = Math.max(2, Math.floor(leaves.length * 0.02));

  const scanner = new DBSCAN();
  const clusterArrays = scanner.run(points2D, eps, minPts);
  const noiseIndices = scanner.noise;

  // Build per-cluster text snippets for c-TF-IDF
  // Use first 500 chars of each doc's text to keep memory bounded
  const allClusterTexts: string[][] = [];
  for (const memberIndices of clusterArrays) {
    const texts: string[] = [];
    for (const idx of memberIndices) {
      const url = urls[idx];
      const fullText = docTexts.get(url) ?? '';
      texts.push(fullText.slice(0, 500));
    }
    allClusterTexts.push(texts);
  }

  const clusters: Cluster[] = [];
  let colorIdx = 0;

  for (let cIdx = 0; cIdx < clusterArrays.length; cIdx++) {
    const memberIndices = clusterArrays[cIdx];
    const memberPoints = memberIndices.map((i) => points2D[i]);
    const memberVecs = memberIndices.map((i) => vecsHD[i]);
    const centroid2D = computeCentroid(memberPoints) as Point2D;
    const centroidHD = computeCentroid(memberVecs);

    // c-TF-IDF candidate phrases
    const candidates = cTfIdfCandidates(allClusterTexts, cIdx, 20);
    let label = `Cluster ${cIdx}`;

    if (candidates.length > 0) {
      // Embed candidates and rank by similarity to HD centroid
      const scored: { phrase: string; score: number }[] = [];
      for (const phrase of candidates) {
        try {
          const vec = await embedFn(phrase);
          const score = cosineSimilarity(vec, centroidHD);
          scored.push({ phrase, score });
        } catch {
          // skip failed embeddings
        }
      }
      scored.sort((a, b) => b.score - a.score);

      // Take top 2-3 non-redundant phrases
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
    clusters.push({ id: cIdx, memberIndices, centroid2D, centroidHD, label, color });
  }

  // Noise cluster
  if (noiseIndices.length > 0) {
    const memberPoints = noiseIndices.map((i) => points2D[i]);
    const memberVecs = noiseIndices.map((i) => vecsHD[i]);
    clusters.push({
      id: -1,
      memberIndices: noiseIndices,
      centroid2D: computeCentroid(memberPoints) as Point2D,
      centroidHD: computeCentroid(memberVecs),
      label: 'noise',
      color: NOISE_COLOR,
    });
  }

  return clusters;
}
