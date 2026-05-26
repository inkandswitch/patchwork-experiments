import type { Point } from '../types.ts';
import { escapeHtml, polygonArea, computeOverlayGeometry, projectPoint } from '../shared/utils.ts';
import type { TrackedSceneCard, VisibleCard } from './types.ts';
import { hueToColor } from './composition.ts';

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
    const color = hueToColor(card.hue);

    return `
      <g>
        <polygon class="qr-outline ${held ? 'held' : 'fresh'}" fill="${held ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.16)'}" stroke="${color}" points="${points}"></polygon>
        <text class="qr-label" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">
          ${escapeHtml(`hue ${card.hue}`)}
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

export function toVisibleCard(markerId: number, cornerPoints: Point[]): VisibleCard | null {
  if (markerId < 0 || markerId > 359) {
    return null;
  }

  if (cornerPoints.length < 4) {
    return null;
  }

  const centroid = cornerPoints.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  const x = centroid.x / cornerPoints.length;
  const y = centroid.y / cornerPoints.length;

  return {
    trackingId: '',
    hue: markerId,
    cornerPoints,
    x,
    y,
    area: polygonArea(cornerPoints),
  };
}
