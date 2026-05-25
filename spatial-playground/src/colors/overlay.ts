import type { Point } from '../types.ts';
import { escapeHtml, polygonArea, computeOverlayGeometry, projectPoint } from '../shared/utils.ts';
import type { CardPayload, TrackedSceneCard, VisibleCard } from './types.ts';
import { CARD_LIBRARY } from './constants.ts';
import { withAlpha } from './composition.ts';

export function renderOverlay(
  overlay: HTMLDivElement,
  video: HTMLVideoElement,
  trackedCards: Map<string, TrackedSceneCard>,
  cards: VisibleCard[],
) {
  if (!cards.length || !video.videoWidth || !video.videoHeight) {
    overlay.innerHTML = '';
    return;
  }

  const width = overlay.clientWidth;
  const height = overlay.clientHeight;
  if (!width || !height) {
    overlay.innerHTML = '';
    return;
  }

  const geometry = computeOverlayGeometry(video.videoWidth, video.videoHeight, width, height);
  const now = performance.now();
  const marks = cards.map((card) => {
    if (card.cornerPoints.length < 4) {
      return '';
    }

    const tracked = trackedCards.get(card.trackingId);
    const held = tracked ? now - tracked.lastSeenAt > 260 : false;
    const projected = card.cornerPoints.map((point) => projectPoint(point, geometry));
    const points = projected.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const centroid = projected.reduce(
      (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
      { x: 0, y: 0 },
    );
    const labelX = centroid.x / projected.length;
    const labelY = centroid.y / projected.length - 10;

    return `
      <g>
        <polygon class="qr-outline ${held ? 'held' : 'fresh'}" fill="${withAlpha(card.card.accent, held ? 0.08 : 0.16)}" stroke="${card.card.accent}" points="${points}"></polygon>
        <text class="qr-label" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">
          ${escapeHtml(card.card.label)}
        </text>
      </g>
    `;
  }).join('');

  overlay.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      ${marks}
    </svg>
  `;
}

export function toVisibleCard(rawValue: string | undefined, cornerPoints: Point[]): VisibleCard | null {
  if (!rawValue) {
    return null;
  }

  const payload = normalizePayload(rawValue);
  if (!payload) {
    return null;
  }

  const card = CARD_LIBRARY.get(payload);
  if (!card) {
    return null;
  }

  const centroid = cornerPoints.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  const x = centroid.x / Math.max(1, cornerPoints.length);
  const y = centroid.y / Math.max(1, cornerPoints.length);

  return {
    trackingId: '',
    card,
    rawValue,
    cornerPoints,
    x,
    y,
    area: polygonArea(cornerPoints),
  } satisfies VisibleCard;
}

export function normalizePayload(rawValue: string): CardPayload | null {
  const trimmed = rawValue.trim().toLowerCase();

  if (CARD_LIBRARY.has(trimmed as CardPayload)) {
    return trimmed as CardPayload;
  }

  if (trimmed === 'scene:red') {
    return 'color:red';
  }

  if (trimmed === 'scene:blue') {
    return 'color:blue';
  }

  return null;
}
