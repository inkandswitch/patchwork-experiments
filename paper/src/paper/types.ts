// ─── Shapes ───────────────────────────────────────────────────────────────────

export type BaseShape = {
  id: string;
  x: number;
  y: number;
  zIndex: number;
  [key: string]: unknown;
};

export type PanelPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'left-top'
  | 'left-center'
  | 'left-bottom'
  | 'right-top'
  | 'right-center'
  | 'right-bottom';

export type PanelEntry = {
  id: string;
  toolId: string;
  position: PanelPosition;
};

export type PaperDoc = {
  title: string;
  shapes: Record<string, BaseShape>;
  panels: PanelEntry[];
};

export type Camera = {
  x: number;
  y: number;
  z: number;
};
