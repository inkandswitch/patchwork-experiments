/**
 * Minimal base shape stored in the canvas doc.
 * Each tool extends this with its own fields (e.g. RectangleShape, PenShape).
 */
export interface CanvasShape {
  id: string;
  x: number;
  y: number;
  zIndex: number;
  type: string;
}

export interface UserState {
  selection: { [shapeId: string]: true };
  color: string;
  fill?: "transparent" | "white" | "filled";
  fontSize?: number;
  selectedTool?: string;
}

/**
 * Panel position as a [side, align] tuple.
 * For top/bottom sides align is 'left' | 'center' | 'right'.
 * For left/right sides align is 'top' | 'center' | 'bottom'.
 * Examples: ['bottom', 'center'], ['top', 'right'], ['left', 'top']
 */
export interface PanelEntry {
  position: [side: "top" | "bottom" | "left" | "right", align: "left" | "center" | "right" | "top" | "bottom"];
}

export interface CanvasDoc {
  shapes: Record<string, CanvasShape>;
  stateByUser: { [contactUrl: string]: UserState };
  panels: { [panelId: string]: PanelEntry };
}

// ============================================================================
// Ephemeral / runtime types
// ============================================================================

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface PointerInfo {
  x: number; // page coordinates
  y: number;
  dx: number; // delta from last event
  dy: number;
  origin: Vec2; // page coordinates at pointer-down
  pointerId: number;
  buttons: number;
  shiftKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export type Disposer = () => void;
