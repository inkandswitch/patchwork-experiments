import {
  Geometry2d,
  HTMLContainer,
  Polygon2d,
  Rectangle2d,
  type RecordProps,
  ShapeUtil,
  T,
  Vec,
  useEditor,
  useValue,
  type Editor,
  type TLShape,
  type TLShapeId,
} from "@tldraw/tldraw";
import { useState } from "react";
import { centroid, convexHull, growHull, type Pt } from "./convexHull.ts";

export const PROPAGATOR_SHAPE_TYPE = "propagator" as const;
export const PROPAGATOR_MEMBER_BINDING_TYPE = "propagator-member" as const;

const HULL_PADDING = 16;

/** Default transform body. Receives `shapes` (member records) -> returns a string. */
export const DEFAULT_TRANSFORM = `// shapes: array of member shape records
// return a markdown string
return shapes
  .map((s) => "- " + (s.props?.text ?? s.props?.name ?? s.type))
  .join("\\n");`;

// ---------------------------------------------------------------------------
// Register the shape's props in tldraw's type system
// ---------------------------------------------------------------------------

declare module "@tldraw/tldraw" {
  export interface TLGlobalShapePropsMap {
    [PROPAGATOR_SHAPE_TYPE]: {
      target: string;
      transform: string;
    };
  }
}

export type PropagatorShape = TLShape<typeof PROPAGATOR_SHAPE_TYPE>;

// ---------------------------------------------------------------------------
// Geometry helpers (live — nothing is cached on the shape)
// ---------------------------------------------------------------------------

/** Page-space corner points of every shape bound to this propagator. */
export function getMemberPagePoints(editor: Editor, propagatorId: TLShapeId): Pt[] {
  const bindings = editor.getBindingsFromShape(
    propagatorId,
    PROPAGATOR_MEMBER_BINDING_TYPE
  );
  const points: Pt[] = [];
  for (const binding of bindings) {
    const bounds = editor.getShapePageBounds(binding.toId);
    if (!bounds) continue;
    points.push(
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY }
    );
  }
  return points;
}

/**
 * The grown convex hull (page space): the hull of the members' corners, then
 * offset outward by a fixed distance with rounded corners. Falls back to the
 * union bounding rectangle for <3 (or collinear) points.
 */
export function getHullPagePoints(editor: Editor, propagatorId: TLShapeId): Pt[] {
  const pts = getMemberPagePoints(editor, propagatorId);
  if (pts.length === 0) return [];

  const hull = convexHull(pts);
  const base =
    hull.length >= 3
      ? hull
      : [
          { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
          { x: Math.max(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
          { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
          { x: Math.min(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
        ];

  return growHull(base, HULL_PADDING);
}

// ---------------------------------------------------------------------------
// ShapeUtil
// ---------------------------------------------------------------------------

export class PropagatorShapeUtil extends ShapeUtil<PropagatorShape> {
  static override type = PROPAGATOR_SHAPE_TYPE;

  static override props: RecordProps<PropagatorShape> = {
    target: T.string,
    transform: T.string,
  };

  getDefaultProps(): PropagatorShape["props"] {
    return { target: "", transform: DEFAULT_TRANSFORM };
  }

  // The propagator lives at the page origin so its local coordinate space
  // equals page space — the hull is computed live from member positions.
  override canResize() {
    return false;
  }
  override canEdit() {
    return false;
  }
  override hideRotateHandle() {
    return true;
  }
  override hideResizeHandles() {
    return true;
  }
  /** A propagator can be the `fromId` of a binding but shouldn't be a member. */
  override canBind({ toShapeType }: { toShapeType: string }) {
    return toShapeType !== PROPAGATOR_SHAPE_TYPE;
  }

  getGeometry(shape: PropagatorShape): Geometry2d {
    const pts = getHullPagePoints(this.editor, shape.id);
    if (pts.length < 3) {
      return new Rectangle2d({ width: 1, height: 1, isFilled: false });
    }
    return new Polygon2d({
      points: pts.map((p) => new Vec(p.x - shape.x, p.y - shape.y)),
      isFilled: false,
    });
  }

  component(shape: PropagatorShape) {
    return <PropagatorComponent shape={shape} />;
  }

  indicator(shape: PropagatorShape) {
    const pts = getHullPagePoints(this.editor, shape.id);
    if (pts.length < 3) return null;
    const local = pts.map((p) => `${p.x - shape.x},${p.y - shape.y}`).join(" ");
    return <polygon points={local} />;
  }
}

// ---------------------------------------------------------------------------
// React component — draws the dashed hull + a small control chip
// ---------------------------------------------------------------------------

function PropagatorComponent({ shape }: { shape: PropagatorShape }) {
  const editor = useEditor();

  const pts = useValue(
    "propagator-hull",
    () => getHullPagePoints(editor, shape.id),
    [editor, shape.id]
  );

  const origin = { x: shape.x, y: shape.y };
  const local = pts.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
  const center = centroid(local);
  const polygon = local.map((p) => `${p.x},${p.y}`).join(" ");

  const hasTarget = !!shape.props.target;

  const configureTarget = () => {
    const next = window.prompt(
      "Propagator target (RefUrl to a string):",
      shape.props.target || ""
    );
    if (next == null) return;
    editor.updateShape<PropagatorShape>({
      id: shape.id,
      type: PROPAGATOR_SHAPE_TYPE,
      props: { target: next.trim() },
    });
    console.log("[propagator] target set", shape.id, next.trim());
  };

  const editTransform = () => {
    const next = window.prompt("Propagator transform code:", shape.props.transform);
    if (next == null) return;
    editor.updateShape<PropagatorShape>({
      id: shape.id,
      type: PROPAGATOR_SHAPE_TYPE,
      props: { transform: next },
    });
    console.log("[propagator] transform updated", shape.id);
  };

  return (
    <HTMLContainer style={{ overflow: "visible", pointerEvents: "none" }}>
      {local.length >= 3 && (
        <svg
          style={{
            position: "absolute",
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <polygon
            points={polygon}
            fill="var(--color-selected, #2f80ed)"
            fillOpacity={0.06}
            stroke="var(--color-selected, #2f80ed)"
            strokeWidth={1.5}
            strokeDasharray="6 5"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <div
        style={{
          position: "absolute",
          left: center.x,
          top: center.y,
          transform: "translate(-50%, -50%)",
          display: "flex",
          alignItems: "stretch",
          pointerEvents: "all",
          background: "var(--color-panel, #fff)",
          color: "var(--color-text-1, #1d1d1d)",
          border: "1px solid var(--color-muted-1, rgba(0,0,0,0.1))",
          borderRadius: "var(--radius-3, 8px)",
          boxShadow: "var(--shadow-2, 0 1px 3px rgba(0,0,0,0.2))",
          font: "500 12px var(--tl-font-sans, system-ui, sans-serif)",
          overflow: "hidden",
          userSelect: "none",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <ChipButton
          onClick={configureTarget}
          title={hasTarget ? shape.props.target : "Set the propagator's target ref"}
          accent={hasTarget}
        >
          <LinkGlyph />
          {hasTarget ? "Target" : "Set target"}
        </ChipButton>
        <div style={{ width: 1, background: "var(--color-muted-1, rgba(0,0,0,0.1))" }} />
        <ChipButton onClick={editTransform} title="Edit the transform code">
          <span style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}>ƒ</span>
        </ChipButton>
      </div>
    </HTMLContainer>
  );
}

function ChipButton({
  onClick,
  title,
  accent,
  children,
}: {
  onClick: () => void;
  title?: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 10px",
        border: "none",
        background: hover ? "var(--color-muted-2, rgba(0,0,0,0.05))" : "transparent",
        color: accent ? "var(--color-selected, #2f80ed)" : "inherit",
        cursor: "pointer",
        font: "inherit",
        whiteSpace: "nowrap",
        lineHeight: "14px",
      }}
    >
      {children}
    </button>
  );
}

function LinkGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
