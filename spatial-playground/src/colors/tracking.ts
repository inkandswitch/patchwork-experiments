import { createArucoDetector, type MarkerDetector } from '../shared/aruco-detector.ts';
import type { CandidateCard, ColorRegion, TrackedSceneCard, VisibleCard } from './types.ts';
import { DWELL_MS, MAX_SCANS_PER_SECOND, TRACK_MATCH_DISTANCE_RATIO } from './constants.ts';
import { toVisibleCard } from './overlay.ts';

const REMOVAL_FRAME_THRESHOLD = 20;

export function createCardTracker(opts: {
  video: HTMLVideoElement;
  onVisibleCardsChange: (cards: VisibleCard[]) => void;
  onRegionsChange: (regions: ColorRegion[]) => void;
}): {
  start(): void;
  stop(): void;
  reset(): void;
  getVisibleCards(): VisibleCard[];
  getCandidateCards(): Map<string, CandidateCard>;
  getTrackedCards(): Map<string, TrackedSceneCard>;
  destroy(): void;
} {
  const { video, onVisibleCardsChange, onRegionsChange } = opts;

  let detector: MarkerDetector | null = null;
  let scanLoopHandle = 0;
  let scanInFlight = false;
  let lastScanAt = 0;
  let currentVisibleCards: VisibleCard[] = [];
  let trackedCards = new Map<string, TrackedSceneCard>();
  let candidateCards = new Map<string, CandidateCard>();
  let missedFrames = new Map<string, number>();
  let nextTrackingId = 1;
  let destroyed = false;
  let lastRegionsKey = '';

  function start() {
    detector = createArucoDetector();
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
    missedFrames.clear();
    nextTrackingId = 1;
    currentVisibleCards = [];
    lastRegionsKey = '';
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
      const cards = detectVisibleCards();
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

  function detectVisibleCards(): VisibleCard[] {
    if (!detector) {
      return [];
    }

    const markers = detector.detect(video);
    return markers
      .map((marker) => toVisibleCard(marker.id, marker.corners))
      .filter((card): card is VisibleCard => Boolean(card));
  }

  function handleVisibleCards(cards: VisibleCard[]) {
    const now = performance.now();
    updateTrackedCards(cards, now);

    currentVisibleCards = [...trackedCards.values()]
      .map((tracked) => tracked.card)
      .sort((left, right) => right.area - left.area);
    onVisibleCardsChange(currentVisibleCards);

    for (const card of currentVisibleCards) {
      const existing = candidateCards.get(card.trackingId);
      if (existing) {
        existing.lastArea = card.area;
        existing.x = card.x;
        existing.y = card.y;
      } else {
        candidateCards.set(card.trackingId, {
          trackingId: card.trackingId,
          hue: card.hue,
          firstSeenAt: now,
          lastSeenAt: now,
          lastArea: card.area,
          x: card.x,
          y: card.y,
        });
      }
    }

    for (const id of candidateCards.keys()) {
      if (!trackedCards.has(id)) {
        candidateCards.delete(id);
      }
    }

    const activeCards = [...candidateCards.values()]
      .filter((candidate) => now - candidate.firstSeenAt >= DWELL_MS);

    const videoW = video.videoWidth || 1;
    const videoH = video.videoHeight || 1;

    const regions: ColorRegion[] = activeCards.map((candidate) => {
      const tracked = trackedCards.get(candidate.trackingId);
      const corners = (tracked?.card.cornerPoints ?? []).map((p) => ({
        x: p.x / videoW,
        y: p.y / videoH,
      }));
      return { hue: candidate.hue, corners };
    });

    const regionsKey = regions
      .map(
        (r) =>
          `${r.hue}:${r.corners.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join('|')}`,
      )
      .join(';');

    if (regionsKey !== lastRegionsKey) {
      lastRegionsKey = regionsKey;
      onRegionsChange(regions);
    }
  }

  function updateTrackedCards(detectedCards: VisibleCard[], now: number) {
    const matchedTrackedIds = new Set<string>();
    const matchDistance =
      Math.max(video.videoWidth, video.videoHeight) * TRACK_MATCH_DISTANCE_RATIO;

    for (const detectedCard of detectedCards.sort(
      (left, right) => right.area - left.area,
    )) {
      const match = findMatchingTrackedCard(
        detectedCard,
        matchedTrackedIds,
        matchDistance,
      );
      const id = match?.id ?? `marker-${nextTrackingId}`;
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
      missedFrames.set(id, 0);
    }

    for (const [id] of trackedCards) {
      if (matchedTrackedIds.has(id)) continue;

      const count = (missedFrames.get(id) ?? 0) + 1;
      missedFrames.set(id, count);

      if (count > REMOVAL_FRAME_THRESHOLD) {
        trackedCards.delete(id);
        missedFrames.delete(id);
      }
    }
  }

  function findMatchingTrackedCard(
    card: VisibleCard,
    usedIds: Set<string>,
    maxDistance: number,
  ) {
    let bestMatch: TrackedSceneCard | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const tracked of trackedCards.values()) {
      if (usedIds.has(tracked.id) || tracked.card.hue !== card.hue) {
        continue;
      }

      const distance = Math.hypot(
        tracked.card.x - card.x,
        tracked.card.y - card.y,
      );
      if (distance < maxDistance && distance < bestDistance) {
        bestMatch = tracked;
        bestDistance = distance;
      }
    }

    return bestMatch;
  }

  function smoothVisibleCard(
    previous: VisibleCard,
    next: VisibleCard,
  ): VisibleCard {
    const positionBlend = 0.76;
    const cornerBlend = 0.58;
    const x = previous.x + (next.x - previous.x) * positionBlend;
    const y = previous.y + (next.y - previous.y) * positionBlend;
    const cornerPoints =
      previous.cornerPoints.length === next.cornerPoints.length
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
      missedFrames.clear();
      currentVisibleCards = [];
    },
  };
}
