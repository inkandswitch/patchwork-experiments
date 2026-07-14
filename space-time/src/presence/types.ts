export type SpaceTimePresenceMessage = {
  type: 'space-time-presence';
  name: string;
  color?: string;
  playhead: {
    x: number;
    y: number;
    height: number;
    currentX: number;
  };
  timestamp: number;
};

export type GhostPlayhead = {
  name: string;
  color: string;
  x: number;
  y: number;
  height: number;
  currentX: number;
  timestamp: number;
};
