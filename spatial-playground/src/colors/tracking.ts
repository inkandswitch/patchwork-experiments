import { createWasmDetector, type MultiDetector } from '../shared/qr-detector.ts';
import type { CandidateCard, ColorPosition, TrackedSceneCard, VisibleCard } from './types.ts';
import { CARD_TTL_MS, DWELL_MS, MAX_SCANS_PER_SECOND, TRACK_MATCH_DISTANCE_RATIO } from './constants.ts';
import { toVisibleCard } from './overlay.ts';
import { createComposition, type ActiveComposition } from './composition.ts';

export function createCardTracker(opts: {
  video: HTMLVideoElement;
  onCompositionChange: (composition: ActiveComposition) => void;
  onVisibleCardsChange: (cards: VisibleCard[]) => void;
}): {
  start(): void;
  stop(): void;
  reset(): void;
  getVisibleCards(): VisibleCard[];
  getCandidateCards(): Map<string, CandidateCard>;
  getTrackedCards(): Map<string, TrackedSceneCard>;
  destroy(): void;
} {
  const { video, onCompositionChange, onVisibleCardsChange } = opts;

  let multiDetector: MultiDetector | null = null;
  let scanLoopHandle = 0;
  let scanInFlight = false;
  let lastScanAt = 0;
  let currentVisibleCards: VisibleCard[] = [];
  let trackedCards = new Map<string, TrackedSceneCard>();
  let candidateCards = new Map<string, CandidateCard>();
  let nextTrackingId = 1;
  let destroyed = false;
  let lastCompositionKey = '';

  function start() {
    multiDetector = createWasmDetector();
    stopLoop();
    scanLoopHandle = window.requestAnimationFrame(scanFrame);
  }

  function stopLoop() {
    if (scanLoopHandle) {
      window.cancelAnimationFrame(scanLoopHandle);
      scanLoopHandle = 0;
    }
  }

  function reset() {
    stopLoop();
    candidateCards.clear();
    trackedCards.clear();
    nextTrackingId = 1;
    currentVisibleCards = [];
    lastCompositionKey = '';
  }

  async function scanFrame(timestamp: number) {
    if (destroyed) return;

    if (scanInFlight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      scanLoopHandle = window.requestAnimationFrame(scanFrame);
      return;
    }

    const minInterval = 1000 / MAX_SCANS_PER_SECOND;
    if (timestamp - lastScanAt < minInterval) {
      scanLoopHandle = window.requestAnimationFrame(scanFrame);
      return;
    }

    lastScanAt = timestamp;
    scanInFlight = true;

    try {
      const cards = await detectVisibleCards();
      handleVisibleCards(cards);
    } catch {
      handleVisibleCards([]);
    } finally {
      scanInFlight = false;
      if (!destroyed) {
        scanLoopHandle = window.requestAnimationFrame(scanFrame);
      }
    }
  }

  async function detectVisibleCards(): Promise<VisibleCard[]> {
    if (!multiDetector) {
      return [];
    }

    const detections = await multiDetector.detect(video);
    return detections
      .map((detection) => toVisibleCard(detection.rawValue, detection.cornerPoints ?? []))
      .filter((card): card is VisibleCard => Boolean(card));
  }

  function handleVisibleCards(cards: VisibleCard[]) {
    const now = performance.now();
    pruneStaleCandidates(now);

    currentVisibleCards = updateTrackedCards(cards, now);
    onVisibleCardsChange(currentVisibleCards);

    for (const card of currentVisibleCards) {
      const sourceLastSeenAt = trackedCards.get(card.trackingId)?.lastSeenAt ?? now;
      const existing = candidateCards.get(card.trackingId);
      if (existing) {
        existing.lastSeenAt = sourceLastSeenAt;
        existing.lastArea = card.area;
        existing.x = card.x;
        existing.y = card.y;
      } else {
        candidateCards.set(card.trackingId, {
          trackingId: card.trackingId,
          card: card.card,
          firstSeenAt: now,
          lastSeenAt: sourceLastSeenAt,
          lastArea: card.area,
          x: card.x,
          y: card.y,
        });
      }
    }

    pruneStaleCandidates(now);

    const activeCards = [...candidateCards.values()]
      .filter((candidate) => now - candidate.firstSeenAt >= DWELL_MS)
      .filter((candidate) => candidate.card.category === 'color');

    const videoW = video.videoWidth || 1;
    const videoH = video.videoHeight || 1;

    const colorPositions: ColorPosition[] = activeCards
      .slice(0, 3)
      .map((candidate) => ({
        colorId: candidate.card.id,
        x: candidate.x / videoW,
        y: candidate.y / videoH,
      }));

    const nextComposition = createComposition(colorPositions);

    if (nextComposition.key !== lastCompositionKey) {
      lastCompositionKey = nextComposition.key;
      onCompositionChange(nextComposition);
    }
  }

  function updateTrackedCards(detectedCards: VisibleCard[], now: number): VisibleCard[] {
    const matchedTrackedIds = new Set<string>();
    const matchDistance = Math.max(video.videoWidth, video.videoHeight) * TRACK_MATCH_DISTANCE_RATIO;

    for (const detectedCard of detectedCards.sort((left, right) => right.area - left.area)) {
      const match = findMatchingTrackedCard(detectedCard, matchedTrackedIds, matchDistance);
      const id = match?.id ?? `scene-card-${nextTrackingId}`;
      if (!match) {
        nextTrackingId += 1;
      }

      const card = {
        ...detectedCard,
        trackingId: id,
      };

      trackedCards.set(id, {
        id,
        card: match ? smoothVisibleCard(match.card, card) : card,
        lastSeenAt: now,
      });
      matchedTrackedIds.add(id);
    }

    for (const [id, tracked] of trackedCards) {
      if (matchedTrackedIds.has(id)) {
        continue;
      }

      if (now - tracked.lastSeenAt > CARD_TTL_MS) {
        trackedCards.delete(id);
      }
    }

    return [...trackedCards.values()]
      .map((tracked) => tracked.card)
      .sort((left, right) => right.area - left.area);
  }

  function findMatchingTrackedCard(card: VisibleCard, usedIds: Set<string>, maxDistance: number) {
    let bestMatch: TrackedSceneCard | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const tracked of trackedCards.values()) {
      if (usedIds.has(tracked.id) || tracked.card.card.payload !== card.card.payload) {
        continue;
      }

      const distance = Math.hypot(tracked.card.x - card.x, tracked.card.y - card.y);
      if (distance < maxDistance && distance < bestDistance) {
        bestMatch = tracked;
        bestDistance = distance;
      }
    }

    return bestMatch;
  }

  function smoothVisibleCard(previous: VisibleCard, next: VisibleCard): VisibleCard {
    const positionBlend = 0.76;
    const cornerBlend = 0.58;
    const x = previous.x + (next.x - previous.x) * positionBlend;
    const y = previous.y + (next.y - previous.y) * positionBlend;
    const cornerPoints = previous.cornerPoints.length === next.cornerPoints.length
      ? previous.cornerPoints.map((point, index) => ({
          x: point.x + (next.cornerPoints[index].x - point.x) * cornerBlend,
          y: point.y + (next.cornerPoints[index].y - point.y) * cornerBlend,
        }))
      : next.cornerPoints;

    return {
      ...next,
      x,
      y,
      cornerPoints,
      area: previous.area + (next.area - previous.area) * positionBlend,
    } satisfies VisibleCard;
  }

  function pruneStaleCandidates(now: number) {
    for (const [id, candidate] of candidateCards) {
      if (now - candidate.lastSeenAt > CARD_TTL_MS) {
        candidateCards.delete(id);
      }
    }
  }

  return {
    start,
    stop: stopLoop,
    reset,
    getVisibleCards: () => currentVisibleCards,
    getCandidateCards: () => candidateCards,
    getTrackedCards: () => trackedCards,
    destroy() {
      destroyed = true;
      stopLoop();
      candidateCards.clear();
      trackedCards.clear();
      currentVisibleCards = [];
    },
  };
}
