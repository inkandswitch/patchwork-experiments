// ─── Geometry ─────────────────────────────────────────────────────────────────

export type Vec2 = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

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

export type UserState = {
  selectedTool?: string;
  selection?: Record<string, true>;
};

export type ShapeElement = HTMLElement & {
  doesShapeOverlapWith?(rect: Rect): boolean;
};

export type PaperDoc = {
  title: string;
  shapes: Record<string, BaseShape>;
  panels: PanelEntry[];
  userState?: Record<string, UserState>;
};

export type Camera = {
  x: number;
  y: number;
  z: number;
};

// ─── Viewport ─────────────────────────────────────────────────────────────────

export type ViewportElement = HTMLDivElement & {
  getShapesInRect(rect: Rect): ShapeElement[];
  screenToCanvas(x: number, y: number): Vec2;
  getCamera(): Camera;
};

// ─── Paper pointer events ─────────────────────────────────────────────────────

export type PaperPointerEventDetail = {
  x: number;
  y: number;
  pointerId: number;
  pointerType: string;
  buttons: number;
  shiftKey: boolean;
  viewport: ViewportElement;
};

// ─── Paper drag events ────────────────────────────────────────────────────────

export type PaperDragEventDetail = {
  canvasX: number;
  canvasY: number;
  dataTransfer: DataTransfer | null;
  // Pre-decoded from text/x-patchwork-urls — only populated for paper:drop, null otherwise.
  patchworkUrls: string[] | null;
  viewport: ViewportElement;
};

declare global {
  interface HTMLElementEventMap {
    'paper:pointerdown': CustomEvent<PaperPointerEventDetail>;
    'paper:pointermove': CustomEvent<PaperPointerEventDetail>;
    'paper:pointerup': CustomEvent<PaperPointerEventDetail>;
    'paper:dragover': CustomEvent<PaperDragEventDetail>;
    'paper:dragenter': CustomEvent<PaperDragEventDetail>;
    'paper:dragleave': CustomEvent<PaperDragEventDetail>;
    'paper:drop': CustomEvent<PaperDragEventDetail>;
  }
}
