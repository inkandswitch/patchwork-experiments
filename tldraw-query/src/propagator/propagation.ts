import {
  findRef,
  type Ref,
  type RefUrl,
  type Repo,
} from "@automerge/automerge-repo";
import {
  renderPlaintextFromRichText,
  type Editor,
  type TLRichText,
  type TLShape,
} from "@tldraw/tldraw";
import {
  PROPAGATOR_MEMBER_BINDING_TYPE,
  PROPAGATOR_SHAPE_TYPE,
  getHullPagePoints,
  type PropagatorShape,
} from "./PropagatorShape.tsx";
import { pointInPolygon } from "./convexHull.ts";

const DEBOUNCE_MS = 150;

/**
 * Run a propagator's transform body. The code receives `shapes` (the member
 * shape records) and returns the value to write to the target. Non-string
 * results are coerced; `null`/`undefined` become an empty string.
 */
function runTransform(code: string, shapes: TLShape[]): string {
  const fn = new Function("shapes", code) as (s: TLShape[]) => unknown;
  const result = fn(shapes);
  return result == null ? "" : String(result);
}

/**
 * Readable label text for a shape. tldraw stores labels as `richText`
 * (ProseMirror JSON), so we render it to plaintext; legacy `props.text`
 * strings are used as-is. Returns "" when the shape has no label.
 */
function extractPlaintext(editor: Editor, shape: TLShape): string {
  const props = shape.props as { richText?: TLRichText; text?: unknown };
  if (props.richText) {
    try {
      return renderPlaintextFromRichText(editor, props.richText).trim();
    } catch {
      return "";
    }
  }
  if (typeof props.text === "string") return props.text.trim();
  return "";
}

/**
 * Auto-add shapes whose center falls inside a propagator's hull as members
 * (the "drop into the hull to add" gesture). Add-only — dragging a shape out
 * doesn't remove it. Skipped mid-drag so it fires on drop, not while moving.
 */
function reconcileMembership(editor: Editor): void {
  if (editor.inputs.isDragging) return;

  const shapes = editor.getCurrentPageShapes();
  const propagators = shapes.filter((s) => s.type === PROPAGATOR_SHAPE_TYPE);
  if (propagators.length === 0) return;

  for (const prop of propagators) {
    const hull = getHullPagePoints(editor, prop.id);
    if (hull.length < 3) continue;

    const memberIds = new Set(
      editor
        .getBindingsFromShape(prop.id, PROPAGATOR_MEMBER_BINDING_TYPE)
        .map((b) => b.toId)
    );

    for (const shape of shapes) {
      if (shape.type === PROPAGATOR_SHAPE_TYPE) continue;
      if (memberIds.has(shape.id)) continue;
      const bounds = editor.getShapePageBounds(shape.id);
      if (!bounds) continue;
      if (pointInPolygon({ x: bounds.center.x, y: bounds.center.y }, hull)) {
        editor.createBinding({
          type: PROPAGATOR_MEMBER_BINDING_TYPE,
          fromId: prop.id,
          toId: shape.id,
          props: {},
        });
      }
    }
  }
}

/**
 * Member shape records, enriched with a `props.text` plaintext label when the
 * shape has one (leaving it absent otherwise so transforms can fall back to
 * `type`). Transforms receive these enriched copies.
 */
function getMemberShapes(editor: Editor, propagatorId: PropagatorShape["id"]): TLShape[] {
  return editor
    .getBindingsFromShape(propagatorId, PROPAGATOR_MEMBER_BINDING_TYPE)
    .map((b) => editor.getShape(b.toId))
    .filter((s): s is TLShape => !!s)
    .map((s) => {
      const text = extractPlaintext(editor, s);
      return text ? ({ ...s, props: { ...s.props, text } } as TLShape) : s;
    });
}

/**
 * Watches every propagator shape in the document and keeps its target ref in
 * sync: members -> transform -> string written into the target doc. Cross-doc
 * writes don't touch the tldraw store, so there's no feedback loop.
 *
 * Returns a teardown function.
 */
export function startPropagation(editor: Editor, repo: Repo): () => void {
  // url -> resolved ref (cached; resolution is async and may fail)
  const refByUrl = new Map<string, Promise<Ref<string> | null>>();
  // propagatorId -> last successfully written { url, value }, to skip no-ops
  const lastByPropagator = new Map<string, { url: string; value: string }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const resolveRef = (url: string): Promise<Ref<string> | null> => {
    let p = refByUrl.get(url);
    if (!p) {
      p = findRef<string>(repo, url as RefUrl).catch((err) => {
        console.warn("[propagator] could not resolve target ref", url, err);
        return null;
      });
      refByUrl.set(url, p);
    }
    return p;
  };

  const recompute = async () => {
    if (stopped) return;

    reconcileMembership(editor);

    const propagators = editor.store
      .allRecords()
      .filter(
        (r): r is PropagatorShape =>
          r.typeName === "shape" &&
          (r as TLShape).type === PROPAGATOR_SHAPE_TYPE
      );

    for (const prop of propagators) {
      // Repair any propagator left offset by older builds: it must sit at the
      // page origin so its hull (page-space) renders in the right place.
      if (prop.x !== 0 || prop.y !== 0) {
        editor.updateShape({ id: prop.id, type: PROPAGATOR_SHAPE_TYPE, x: 0, y: 0 });
      }

      const url = prop.props.target?.trim() ?? "";
      const members = getMemberShapes(editor, prop.id);

      let value: string;
      try {
        value = runTransform(prop.props.transform, members);
      } catch (err) {
        console.warn("[propagator] transform threw", prop.id, err);
        continue;
      }

      if (!url) continue;

      const last = lastByPropagator.get(prop.id);
      if (last && last.url === url && last.value === value) continue;

      const ref = await resolveRef(url);
      if (stopped) return;
      if (!ref) continue;

      try {
        ref.change(value);
        lastByPropagator.set(prop.id, { url, value });
        console.log(
          "[propagator] propagated",
          prop.id,
          "->",
          url,
          `(${members.length} members)`,
          JSON.stringify(value).slice(0, 80)
        );
      } catch (err) {
        console.warn("[propagator] write to target failed", prop.id, url, err);
      }
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void recompute(), DEBOUNCE_MS);
  };

  const unsub = editor.store.listen(schedule, { scope: "document" });
  void recompute();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    unsub();
  };
}
