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

const PRESENCE_INTERVAL_MS = 500;
const PEER_TTL_MS = 8000;

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
      update('playhead', null);
      return;
    }
    update('playhead', {
      name: id.name,
      color: id.color,
      x: ph.x,
      y: ph.y,
      height: ph.height,
      currentX: currentXRef.current,
    });
  }, [update]);

  useEffect(() => {
    publish();
    const interval = window.setInterval(publish, PRESENCE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [publish, playhead?.id, playhead?.x, playhead?.y, playhead?.height]);

  return useMemo(() => {
    const ghosts: GhostPlayhead[] = [];
    for (const peer of peerStates.peers) {
      const ph = peer.value.playhead;
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
