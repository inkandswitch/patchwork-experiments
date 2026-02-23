import {
  ShapeUtil,
  HTMLContainer,
  Polygon2d,
  Rectangle2d,
  T,
  Vec,
  type Geometry2d,
  type TLShape,
} from "@tldraw/tldraw";
import type { Repo } from "@automerge/automerge-repo";
import type { LLMProcessDoc, WorkspaceDoc, WorkspaceEntry } from "./process/types";

let _repo: Repo | null = null;

/** Call once from TldrawInner to give shape utils access to the repo. */
export function setTokenShapeRepo(repo: Repo) {
  _repo = repo;
}

export const PATCHWORK_TOKEN_TYPE = "patchwork-token" as const;

declare module "@tldraw/tldraw" {
  export interface TLGlobalShapePropsMap {
    [PATCHWORK_TOKEN_TYPE]: { w: number; h: number; data: string };
  }
}

export type PatchworkTokenShape = TLShape<typeof PATCHWORK_TOKEN_TYPE>;

export interface PatchworkDndItem {
  id: string;
  url: string;
  type: string;
  name: string;
  source: string;
}

export interface PatchworkDndData {
  source: string;
  items: PatchworkDndItem[];
}

export const TOKEN_H = 28;
export const DIAMOND_INSET = 8;
export const TOOL_SLOT_W = 60;

export const previewOriginals = new Map<
  string,
  { docUrl: string; docName: string; toolId: string }
>();

export function parseTokenData(data: string): {
  item: PatchworkDndItem;
  isDoc: boolean;
  isTool: boolean;
} | null {
  try {
    const parsed: PatchworkDndData = JSON.parse(data);
    const item = parsed?.items?.[0];
    if (!item) return null;
    return { item, isDoc: !!item.url, isTool: !!item.type };
  } catch {
    return null;
  }
}

let _measureCanvas: HTMLCanvasElement | null = null;
function measureText(text: string, font: string): number {
  if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
  const ctx = _measureCanvas.getContext("2d")!;
  ctx.font = font;
  return Math.ceil(ctx.measureText(text).width);
}

export function measureDocTokenWidth(name: string): number {
  return measureText(name, "12px sans-serif") + 24;
}

export function measureToolTokenWidth(toolId: string): number {
  return measureText(toolId.toUpperCase(), "10px sans-serif") + 24 + DIAMOND_INSET * 2;
}

export function getDiamondPoints(w: number, h: number): Vec[] {
  const i = DIAMOND_INSET;
  return [
    new Vec(i, 0),
    new Vec(w - i, 0),
    new Vec(w, h / 2),
    new Vec(w - i, h),
    new Vec(i, h),
    new Vec(0, h / 2),
  ];
}

export function diamondPathData(w: number, h: number): string {
  const pts = getDiamondPoints(w, h);
  return `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`;
}

export const DOC_TOKEN_STYLE: React.CSSProperties = {
  fontFamily: "sans-serif",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  display: "flex",
  alignItems: "center",
  padding: "4px 10px",
  background: "#f8f8f8",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 12,
  color: "#333",
};

export function ToolTokenSvg({
  label,
  width,
  height,
}: {
  label: string;
  width: number;
  height: number;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        d={diamondPathData(width, height)}
        fill="#f8f8f8"
        stroke="#ccc"
        strokeWidth={1}
      />
      <text
        x={width / 2}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontSize: 10, fill: "#666", fontFamily: "sans-serif" }}
      >
        {label.toUpperCase()}
      </text>
    </svg>
  );
}

export function ToolSlotPlaceholder({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  return (
    <div
      style={{
        width,
        height,
        flexShrink: 0,
        clipPath: `polygon(${DIAMOND_INSET}px 0, calc(100% - ${DIAMOND_INSET}px) 0, 100% 50%, calc(100% - ${DIAMOND_INSET}px) 100%, ${DIAMOND_INSET}px 100%, 0 50%)`,
        background: "#e4e4e4",
        boxShadow: "inset 0 1px 3px rgba(0,0,0,0.2)",
      }}
    />
  );
}

export function DocSlotPlaceholder({ height }: { height: number }) {
  return (
    <div
      style={{
        flex: 1,
        height,
        background: "#e4e4e4",
        borderRadius: 6,
        boxShadow: "inset 0 1px 3px rgba(0,0,0,0.2)",
      }}
    />
  );
}

export class PatchworkTokenShapeUtil extends ShapeUtil<PatchworkTokenShape> {
  static override type = PATCHWORK_TOKEN_TYPE as string;

  static override props = {
    w: T.number,
    h: T.number,
    data: T.string,
  };

  override canResize() {
    return false;
  }

  override hideResizeHandles() {
    return true;
  }

  override getDefaultProps(): PatchworkTokenShape["props"] {
    return { w: 120, h: TOKEN_H, data: "{}" };
  }

  override getGeometry(shape: PatchworkTokenShape): Geometry2d {
    const { w, h } = shape.props;
    const info = parseTokenData(shape.props.data);
    const isTool = info ? info.isTool && !info.isDoc : false;

    if (isTool) {
      return new Polygon2d({
        points: getDiamondPoints(w, h),
        isFilled: true,
      });
    }

    return new Rectangle2d({ width: w, height: h, isFilled: true });
  }

  override component(shape: PatchworkTokenShape) {
    const { w, h } = shape.props;
    const info = parseTokenData(shape.props.data);

    if (!info) {
      return (
        <HTMLContainer
          style={{ ...DOC_TOKEN_STYLE, color: "#999", pointerEvents: "all" }}
        >
          Invalid token
        </HTMLContainer>
      );
    }

    const { item } = info;
    const isTool = info.isTool && !info.isDoc;

    if (isTool) {
      return (
        <ToolTokenSvg label={item.type || "???"} width={w} height={h} />
      );
    }

    return (
      <HTMLContainer style={{ ...DOC_TOKEN_STYLE, pointerEvents: "all" }}>
        {item.name || "Untitled"}
      </HTMLContainer>
    );
  }

  override indicator(shape: PatchworkTokenShape) {
    const { w, h } = shape.props;
    const info = parseTokenData(shape.props.data);
    const isTool = info ? info.isTool && !info.isDoc : false;

    if (isTool) {
      return <path d={diamondPathData(w, h)} />;
    }
    return <rect width={w} height={h} rx={6} ry={6} />;
  }

  override onTranslateEnd(
    _initial: PatchworkTokenShape,
    shape: PatchworkTokenShape,
  ) {
    const { editor } = this;
    const info = parseTokenData(shape.props.data);
    if (!info) return;

    const pageBounds = editor.getShapePageBounds(shape.id);
    if (!pageBounds) return;

    const target = editor.getShapeAtPoint(pageBounds.center, {
      hitInside: true,
      filter: (s) => s.type === "patchwork-view" && s.id !== shape.id,
    });
    if (!target) return;

    const view = target as any;
    const { item, isDoc, isTool } = info;

    // -----------------------------------------------------------------------
    // TEMPORARY: When the drop target is a patchwork-view rendering an
    // llm-process tool, write the token's entry directly into the
    // LLMProcessDoc's WorkspaceDoc via Automerge.
    //
    // This bridges the gap between tldraw's shape-drag system and the
    // embedded <patchwork-view> which can't receive tldraw drag events.
    // Replace with a proper cross-boundary DnD protocol when available.
    // -----------------------------------------------------------------------
    if (view.props?.toolId === "llm-process" && view.props?.docUrl && _repo) {
      const repo = _repo;
      const processDocUrl = view.props.docUrl;

      (async () => {
        try {
          const processHandle = await repo.find<LLMProcessDoc>(processDocUrl);
          const processDoc = processHandle.doc();
          if (!processDoc?.workspaceUrl) return;

          const wsHandle = await repo.find<WorkspaceDoc>(processDoc.workspaceUrl);
          wsHandle.change((ws: any) => {
            if (!ws.entries) ws.entries = [];

            const exists = ws.entries.some(
              (e: WorkspaceEntry) => e.name === item.name && e.url === item.url,
            );
            if (exists) return;

            if (item.type && item.type !== "raw" && !item.url) return;

            const isToolEntry =
              item.type &&
              item.type !== "raw" &&
              item.type !== "file" &&
              item.type !== "folder";

            if (isToolEntry) {
              ws.entries.push({
                name: item.name || item.type,
                url: item.url,
                path: "tool.js",
                type: "tool",
              });
            } else {
              ws.entries.push({
                name: item.name || "Untitled",
                url: item.url,
                type: "document",
              });
            }
          });
        } catch (err) {
          console.error("[tiles] token→llm-process bridge failed:", err);
        }
      })();

      editor.deleteShape(shape.id);
      previewOriginals.delete(view.id);
      return;
    }
    // -----------------------------------------------------------------------
    // END TEMPORARY
    // -----------------------------------------------------------------------

    const updates: Record<string, string> = {};
    if (isDoc) {
      updates.docUrl = item.url;
      updates.docName = item.name;
    }
    if (isTool) {
      updates.toolId = item.type;
    }

    editor.updateShape({
      id: view.id,
      type: "patchwork-view",
      props: updates,
    });

    editor.deleteShape(shape.id);
    previewOriginals.delete(view.id);
  }
}
