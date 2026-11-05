import { createShapeId, toRichText, type Editor, type TLShape, type TLShapeId } from "@tldraw/tldraw";

// ToolAdapter protocol, v1.
//
// A tool that wants to be driven by another tool in the same page (e.g. the
// Livelymerge Morphic kernel) registers an adapter on
// `window.__patchworkToolAdapters`. An adapter is a flat object of closures
// (callers may invoke them through proxies, so nothing relies on `this`) that
// take and return plain JSON-able values. Callers look adapters up by id on
// every use and never hold on to them across reloads.
//
//   info()               → { id, kind, toolId, docUrl, verbs }
//   shapes()             → ShapeSummary[]
//   selectedIds()        → string[]
//   select(ids)
//   createShape(spec)    → id
//   updateShape(id, patch)
//   deleteShapes(ids)
//   rotateShapes(ids, radians)
//   nudge(ids, dx, dy)
//   zoomToFit()
//   drainEvents()        → AdapterEvent[]   (queued since the last drain)

export type ToolAdapterInfo = {
  id: string;
  kind: string;
  toolId: string;
  docUrl: string;
  verbs: string[];
};

export type ToolAdapter = {
  info(): ToolAdapterInfo;
  [verb: string]: (...args: any[]) => unknown;
};

type ToolAdapterRegistry = {
  version: 1;
  adapters: Record<string, ToolAdapter>;
  register(adapter: ToolAdapter): () => void;
  get(id: string): ToolAdapter | null;
  list(): ToolAdapterInfo[];
};

export function toolAdapterRegistry(): ToolAdapterRegistry {
  const w = window as unknown as { __patchworkToolAdapters?: ToolAdapterRegistry };
  if (w.__patchworkToolAdapters?.version === 1) return w.__patchworkToolAdapters;
  const adapters: Record<string, ToolAdapter> = {};
  const registry: ToolAdapterRegistry = {
    version: 1,
    adapters,
    register(adapter) {
      const id = adapter.info().id;
      adapters[id] = adapter;
      return () => {
        if (adapters[id] === adapter) delete adapters[id];
      };
    },
    get: (id) => adapters[id] ?? null,
    list: () => Object.values(adapters).map((a) => a.info()),
  };
  w.__patchworkToolAdapters = registry;
  return registry;
}

const TLDRAW_COLORS = [
  "black", "grey", "light-violet", "violet", "blue", "light-blue", "yellow",
  "orange", "green", "light-green", "light-red", "red", "white",
];
const MAX_QUEUED_EVENTS = 200;

type ShapeSpec = {
  type?: "geo" | "note" | "text";
  geo?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  text?: string;
  color?: string;
};

type AdapterEvent =
  | { type: "selection"; ids: string[] }
  | { type: "shapes"; added: string[]; removed: string[]; updated: string[] };

let adapterCounter = 0;

export function registerTldrawAdapter(editor: Editor, docUrl: string): () => void {
  const id = `tldraw:${docUrl.slice(-6)}#${++adapterCounter}`;
  const events: AdapterEvent[] = [];
  const push = (e: AdapterEvent) => {
    events.push(e);
    if (events.length > MAX_QUEUED_EVENTS) events.splice(0, events.length - MAX_QUEUED_EVENTS);
  };

  const shapeText = (shape: TLShape): string | null => {
    try {
      const util = editor.getShapeUtil(shape) as { getText?: (s: TLShape) => string | undefined };
      return util.getText?.(shape) ?? null;
    } catch {
      return null;
    }
  };

  const summarize = (shape: TLShape) => {
    const b = editor.getShapePageBounds(shape.id);
    const props = shape.props as { color?: string };
    return {
      id: shape.id as string,
      type: shape.type,
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation,
      w: b?.w ?? 0,
      h: b?.h ?? 0,
      color: props.color ?? null,
      text: shapeText(shape),
    };
  };

  const toIds = (ids: unknown): TLShapeId[] => Array.from(ids as ArrayLike<string>) as TLShapeId[];
  const validColor = (c?: string) => (c && TLDRAW_COLORS.includes(c) ? c : undefined);

  const adapter: ToolAdapter = {
    info: () => ({
      id,
      kind: "tldraw",
      toolId: "llm-canvas",
      docUrl,
      verbs: Object.keys(adapter).filter((k) => k !== "info"),
    }),
    shapes: () => editor.getCurrentPageShapes().map(summarize),
    selectedIds: () => editor.getSelectedShapeIds().map(String),
    select: (ids: unknown) => {
      editor.setSelectedShapes(toIds(ids));
    },
    createShape: (spec: ShapeSpec) => {
      const type = spec.type ?? "geo";
      const shapeId = createShapeId();
      const props: Record<string, unknown> = {};
      const color = validColor(spec.color);
      if (color) props.color = color;
      if (spec.text != null) props.richText = toRichText(String(spec.text));
      if (type === "geo") {
        props.geo = spec.geo ?? "rectangle";
        props.w = spec.w ?? 160;
        props.h = spec.h ?? 90;
      }
      editor.createShape({
        id: shapeId,
        type,
        x: spec.x ?? 0,
        y: spec.y ?? 0,
        rotation: spec.rotation ?? 0,
        parentId: editor.getCurrentPageId(),
        props,
      });
      return shapeId as string;
    },
    updateShape: (shapeId: string, patch: ShapeSpec) => {
      const shape = editor.getShape(shapeId as TLShapeId);
      if (!shape) return false;
      const props: Record<string, unknown> = {};
      const color = validColor(patch.color);
      if (color) props.color = color;
      if (patch.text != null) props.richText = toRichText(String(patch.text));
      if (shape.type === "geo") {
        if (patch.w != null) props.w = patch.w;
        if (patch.h != null) props.h = patch.h;
      }
      editor.updateShape({
        id: shape.id,
        type: shape.type,
        ...(patch.x != null ? { x: patch.x } : {}),
        ...(patch.y != null ? { y: patch.y } : {}),
        ...(patch.rotation != null ? { rotation: patch.rotation } : {}),
        props,
      });
      return true;
    },
    deleteShapes: (ids: unknown) => {
      editor.deleteShapes(toIds(ids));
    },
    rotateShapes: (ids: unknown, radians: number) => {
      editor.rotateShapesBy(toIds(ids), radians);
    },
    nudge: (ids: unknown, dx: number, dy: number) => {
      editor.nudgeShapes(toIds(ids), { x: dx, y: dy });
    },
    zoomToFit: () => {
      editor.zoomToFit({ animation: { duration: 300 } });
    },
    drainEvents: () => events.splice(0, events.length),
  };

  let lastSelection = editor.getSelectedShapeIds().join(",");
  const stopSelection = editor.store.listen(
    () => {
      const ids = editor.getSelectedShapeIds();
      const key = ids.join(",");
      if (key === lastSelection) return;
      lastSelection = key;
      push({ type: "selection", ids: ids.map(String) });
    },
    { scope: "session" },
  );
  const stopShapes = editor.store.listen(
    ({ changes }) => {
      const isShape = (r: { typeName: string }) => r.typeName === "shape";
      const added = Object.values(changes.added).filter(isShape).map((r) => r.id as string);
      const removed = Object.values(changes.removed).filter(isShape).map((r) => r.id as string);
      const updated = Object.values(changes.updated)
        .filter(([, to]) => isShape(to))
        .map(([, to]) => to.id as string);
      if (added.length || removed.length || updated.length) push({ type: "shapes", added, removed, updated });
    },
    { scope: "document", source: "user" },
  );

  const unregister = toolAdapterRegistry().register(adapter);
  return () => {
    stopSelection();
    stopShapes();
    unregister();
  };
}
