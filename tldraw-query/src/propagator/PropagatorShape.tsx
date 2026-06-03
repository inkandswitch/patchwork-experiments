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
import { convexHull, growHull, type Pt } from "./convexHull.ts";

export const PROPAGATOR_SHAPE_TYPE = "propagator" as const;
export const PROPAGATOR_MEMBER_BINDING_TYPE = "propagator-member" as const;

const HULL_PADDING = 16;

/** Default transform body. Receives `shapes` (member records) -> returns a string. */
export const DEFAULT_TRANSFORM = `// shapes: member shape records (frames included).
// Builds a markdown checklist: positive emoji (✅ 👍) => checked, others
// unchecked. Shapes inside a frame are grouped under the frame's label.
var POS = ["✅", "✔️", "☑️", "👍", "🟢", "✓"];
var EMOJI = /[✅✔️☑️👍🟢✓❌✖️👎🔴⬜✗]/gu;

function labelOf(s) {
  var t = s.props && (s.props.text || s.props.name);
  return t ? String(t) : s.type;
}
function todo(s) {
  var raw = labelOf(s);
  var checked = POS.some(function (e) { return raw.indexOf(e) >= 0; });
  var label = raw.replace(EMOJI, "").trim();
  return "- [" + (checked ? "x" : " ") + "] " + (label || s.type);
}

var frames = {};
shapes.forEach(function (s) { if (s.type === "frame") frames[s.id] = s; });

var top = [];
var grouped = {};
shapes.forEach(function (s) {
  if (s.type === "frame") return;
  if (s.parentId && frames[s.parentId]) {
    (grouped[s.parentId] = grouped[s.parentId] || []).push(s);
  } else {
    top.push(s);
  }
});

var out = top.map(todo);
Object.keys(frames).forEach(function (fid) {
  if (out.length) out.push("");
  out.push("## " + (labelOf(frames[fid]).replace(EMOJI, "").trim() || "Frame"));
  (grouped[fid] || []).forEach(function (s) { out.push(todo(s)); });
});
return out.join("\\n");`;

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

  // The propagator's position is derived from its members, so it must stay at
  // the page origin. Returning the initial shape on every translate frame pins
  // it in place (selectable, but not draggable).
  override onTranslate(initial: PropagatorShape) {
    return initial;
  }
  override onTranslateEnd(initial: PropagatorShape) {
    return initial;
  }

  getGeometry(shape: PropagatorShape): Geometry2d {
    const pts = getHullPagePoints(this.editor, shape.id);
    if (pts.length < 3) {
      return new Rectangle2d({ width: 1, height: 1, isFilled: true });
    }
    // Filled so the hull interior is hoverable/clickable for selection. The
    // shape is kept at the back (see createPropagatorFromSelection) so member
    // shapes on top stay independently clickable.
    return new Polygon2d({
      points: pts.map((p) => new Vec(p.x - shape.x, p.y - shape.y)),
      isFilled: true,
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
// React component — draws the dashed hull. Colour encodes link state:
// dim grey when no target, hyperlink-blue when linked.
// ---------------------------------------------------------------------------

const UNLINKED_COLOR = "#8b8f98";

function PropagatorComponent({ shape }: { shape: PropagatorShape }) {
  const editor = useEditor();

  const pts = useValue(
    "propagator-hull",
    () => getHullPagePoints(editor, shape.id),
    [editor, shape.id]
  );
  const isSelected = useValue(
    "propagator-selected",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );

  if (pts.length < 3) return null;

  const local = pts.map((p) => ({ x: p.x - shape.x, y: p.y - shape.y }));
  const polygon = local.map((p) => `${p.x},${p.y}`).join(" ");

  const hasTarget = !!shape.props.target;
  const color = hasTarget ? "var(--color-selected, #2f80ed)" : UNLINKED_COLOR;

  return (
    <HTMLContainer style={{ overflow: "visible", pointerEvents: "none" }}>
      <svg
        style={{ position: "absolute", overflow: "visible", pointerEvents: "none" }}
      >
        <polygon
          points={polygon}
          fill={color}
          fillOpacity={isSelected ? 0.12 : 0.05}
          stroke={color}
          strokeWidth={isSelected ? 2.5 : 1.5}
          strokeDasharray="6 5"
          strokeLinejoin="round"
        />
      </svg>
    </HTMLContainer>
  );
}
