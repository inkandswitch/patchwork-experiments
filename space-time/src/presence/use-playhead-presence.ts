import type { DocHandle } from '@automerge/automerge-repo';
import { usePresence } from '@automerge/automerge-repo-react-hooks';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { Playhead, SpaceTimeDoc } from '../types';
import type { GhostPlayhead } from './types';
import { hashColor } from './use-identity';

type PlayheadPresenceState = {
  playhead: {
    name: string;
    color: string;
    x: number;
    y: number;
    height: number;
    currentX: number;
  } | null;
};

/** Fallback publish while idle (heartbeats are handled by usePresence). */
const PRESENCE_IDLE_INTERVAL_MS = 2000;
const PEER_TTL_MS = 8000;

type PublishedSnapshot = {
  x: number;
  y: number;
  height: number;
  currentX: number;
};

function snapshotMatches(a: PublishedSnapshot, b: PublishedSnapshot): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.height === b.height &&
    Math.abs(a.currentX - b.currentX) < 0.5
  );
}

export function usePlayheadPresence(
  handle: DocHandle<SpaceTimeDoc>,
  identity: { name: string; color: string },
  playhead: Playhead | null,
  currentX: number,
): GhostPlayhead[] {
  const playheadRef = useRef(playhead);
  const currentXRef = useRef(currentX);
  const identityRef = useRef(identity);
  playheadRef.current = playhead;
  currentXRef.current = currentX;
  identityRef.current = identity;

  const lastPublishedRef = useRef<PublishedSnapshot | null>(null);
  const publishRafRef = useRef<number | null>(null);

  const { peerStates, update } = usePresence<PlayheadPresenceState>({
    handle,
    initialState: { playhead: null },
    heartbeatMs: 2000,
    peerTtlMs: PEER_TTL_MS,
  });

  const publish = useCallback(() => {
    const ph = playheadRef.current;
    const id = identityRef.current;
    if (!ph) {
      lastPublishedRef.current = null;
      update('playhead', null);
      return;
    }

    const snapshot: PublishedSnapshot = {
      x: ph.x,
      y: ph.y,
      height: ph.height,
      currentX: currentXRef.current,
    };
    if (lastPublishedRef.current && snapshotMatches(lastPublishedRef.current, snapshot)) {
      return;
    }
    lastPublishedRef.current = snapshot;

    update('playhead', {
      name: id.name,
      color: id.color,
      ...snapshot,
    });
  }, [update]);

  const schedulePublish = useCallback(() => {
    if (publishRafRef.current !== null) return;
    publishRafRef.current = requestAnimationFrame(() => {
      publishRafRef.current = null;
      publish();
    });
  }, [publish]);

  useEffect(() => {
    schedulePublish();
  }, [currentX, playhead?.id, playhead?.x, playhead?.y, playhead?.height, schedulePublish]);

  useEffect(() => {
    publish();
    const interval = window.setInterval(publish, PRESENCE_IDLE_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      if (publishRafRef.current !== null) {
        cancelAnimationFrame(publishRafRef.current);
        publishRafRef.current = null;
      }
    };
  }, [publish, playhead?.id, playhead?.x, playhead?.y, playhead?.height]);

  return useMemo(() => {
    const ghosts: GhostPlayhead[] = [];
    for (const peer of peerStates.peers) {
      // Heartbeats can create peer entries before any snapshot/update (value undefined).
      const ph = peer.value?.playhead;
      if (!ph) continue;
      ghosts.push({
        name: ph.name,
        color: ph.color || hashColor(ph.name),
        x: ph.x,
        y: ph.y,
        height: ph.height,
        currentX: ph.currentX,
        timestamp: peer.lastActiveAt,
      });
    }
    return ghosts;
  }, [peerStates]);
}
