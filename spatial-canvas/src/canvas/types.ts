/**
 * Minimal base shape stored in the canvas doc.
 * Each tool extends this with its own fields (e.g. RectangleShape, PenShape).
 */
export type CanvasShape = {
  id: string;
  x: number;
  y: number;
  zIndex: number;
  type: string;
};

export type UserState = {
  selection: { [shapeId: string]: true };
  color: string;
  fill?: "transparent" | "white" | "filled";
  fontSize?: number;
  selectedTool?: string;
};

/**
 * Floating card — positioned at a [side, align] point in the 3×3 grid overlay.
 * Has card chrome (border, border-radius, shadow).
 * Examples: { kind: 'panel', position: ['bottom', 'center'] }
 */
export type FloatingPanel = {
  kind: "panel";
  position: [
    side: "top" | "bottom" | "left" | "right",
    align: "left" | "center" | "right" | "top" | "bottom",
  ];
};

/**
 * Full-side bar — pushes the canvas in from one side.
 * Left/right bars are flex siblings in the row container.
 * Top/bottom bars are flex siblings in the column wrapper.
 * The bar plugin controls its own width/height via inline styles.
 * Examples: { kind: 'bar', side: 'right' }
 */
export type Bar = {
  kind: "bar";
  side: "top" | "bottom" | "left" | "right";
};

export type LayoutEntry = FloatingPanel | Bar;

export type CanvasDoc = {
  shapes: Record<string, CanvasShape>;
  stateByUser: { [contactUrl: string]: UserState };
  layout: { [toolId: string]: LayoutEntry };
};

// ============================================================================
// Ephemeral / runtime types
// ============================================================================

export type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Vec2 = {
  x: number;
  y: number;
};

export type PointerInfo = {
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
};

export type Disposer = () => void;

declare global {
  interface Window {
    accountDocHandle?: { doc(): { contactUrl: string } | undefined };
  }
}

declare module "@inkandswitch/patchwork-plugins" {
  interface PluginDescription {
    tags?: string[];
  }
}
