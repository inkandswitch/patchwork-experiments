import { useRef, useEffect } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  createShapeId,
  type TLShape,
  type TLShapeId,
} from "@tldraw/tldraw";
import {
  PATCHWORK_TOKEN_TYPE,
  DOC_TOKEN_STYLE,
  TOKEN_H,

  TOOL_SLOT_W,
  parseTokenData,
  isToolCompatibleWithDocType,
  measureDocTokenWidth,
  measureToolTokenWidth,
  ToolTokenSvg,
  ToolSlotPlaceholder,
  DocSlotPlaceholder,
  previewOriginals,
  type PatchworkTokenShape,
} from "./PatchworkTokenShape.tsx";

export const PATCHWORK_VIEW_TYPE = "patchwork-view" as const;

declare module "@tldraw/tldraw" {
  export interface TLGlobalShapePropsMap {
    [PATCHWORK_VIEW_TYPE]: {
      w: number;
      h: number;
      docUrl: string;
      docName: string;
      toolId: string;
    };
  }
}

export type PatchworkViewShape = TLShape<typeof PATCHWORK_VIEW_TYPE>;

const HEADER_HEIGHT = 36;

const SHIELD_EVENTS = [
  "pointerdown", "pointermove", "pointerup",
  "wheel", "keydown", "keyup",
] as const;

/** Stops all interactive events from propagating to tldraw when active. */
function ViewBody({ active, children }: { active: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const stop = (e: Event) => e.stopPropagation();
    for (const type of SHIELD_EVENTS) el.addEventListener(type, stop);
    return () => { for (const type of SHIELD_EVENTS) el.removeEventListener(type, stop); };
  }, [active]);
  return (
    <div ref={ref} style={{ flex: 1, overflow: "hidden", position: "relative" }}>
      {children}
    </div>
  );
}

export class PatchworkViewShapeUtil extends BaseBoxShapeUtil<PatchworkViewShape> {
  static override type = PATCHWORK_VIEW_TYPE as string;

  static override props = {
    w: T.number,
    h: T.number,
    docUrl: T.string,
    docName: T.string,
    toolId: T.string,
  };

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override getDefaultProps(): PatchworkViewShape["props"] {
    return { w: 400, h: 300, docUrl: "", docName: "", toolId: "" };
  }

  // --- Drag-in preview (show slot fill while hovering, revert on leave) ---

  override onDragShapesIn(
    shape: PatchworkViewShape,
    draggingShapes: TLShape[],
  ): void {
    const { editor } = this;
    const tokens = draggingShapes.filter(
      (s) => s.type === PATCHWORK_TOKEN_TYPE && s.parentId !== shape.id,
    );
    if (tokens.length === 0) return;

    const token = tokens[0] as PatchworkTokenShape;
    const info = parseTokenData(token.props.data);
    if (!info) return;

    console.log("[tiles] onDragShapesIn:", {
      isDoc: info.isDoc,
      isTool: info.isTool,
      itemType: info.item.type,
      itemName: info.item.name,
      itemUrl: info.item.url,
      viewToolId: shape.props.toolId,
    });

    if (info.isDoc && shape.props.toolId) {
      if (!isToolCompatibleWithDocType(shape.props.toolId, info.item.type, info.item.url)) return;
    }

    if (!previewOriginals.has(shape.id)) {
      previewOriginals.set(shape.id, {
        docUrl: shape.props.docUrl,
        docName: shape.props.docName,
        toolId: shape.props.toolId,
      });
    }

    const updates: Partial<PatchworkViewShape["props"]> = {};
    if (info.isDoc) {
      updates.docUrl = info.item.url;
      updates.docName = info.item.name;
    }
    if (info.isTool) {
      updates.toolId = info.item.type;
    }

    editor.updateShape({
      id: shape.id,
      type: PATCHWORK_VIEW_TYPE,
      props: updates,
    });
  }

  override onDragShapesOut(shape: PatchworkViewShape): void {
    const { editor } = this;
    const orig = previewOriginals.get(shape.id);
    if (orig) {
      editor.updateShape({
        id: shape.id,
        type: PATCHWORK_VIEW_TYPE,
        props: orig,
      });
      previewOriginals.delete(shape.id);
    }
  }

  // --- Component ---

  override component(shape: PatchworkViewShape) {
    const editor = this.editor;
    const isEditing = editor.getEditingShapeId() === shape.id;
    const { docUrl, docName, toolId } = shape.props;

    const hasDoc = docUrl !== "";
    const hasTool = toolId !== "";

    const toolW = hasTool
      ? measureToolTokenWidth(toolId)
      : TOOL_SLOT_W;

    // --- Drag-out handler: immediate removal, cursor-follow, snap-back ---
    const handleDragOut = (
      e: React.PointerEvent,
      slotType: "doc" | "tool",
    ) => {
      e.stopPropagation();
      e.preventDefault();

      const savedDocUrl = docUrl;
      const savedDocName = docName;
      const savedToolId = toolId;

      const isDocSlot = slotType === "doc";
      const tokenData = isDocSlot
        ? JSON.stringify({
            source: "",
            items: [
              { id: "", url: docUrl, type: "", name: docName, source: "" },
            ],
          })
        : JSON.stringify({
            source: "",
            items: [
              { id: "", url: "", type: toolId, name: toolId, source: "" },
            ],
          });

      const tokenW = isDocSlot
        ? measureDocTokenWidth(docName || "Untitled")
        : measureToolTokenWidth(toolId);
      const tokenH = TOKEN_H;

      const startPoint = editor.screenToPage({
        x: e.clientX,
        y: e.clientY,
      });

      const newId: TLShapeId = createShapeId();

      editor.markHistoryStoppingPoint("drag out token");

      editor.updateShape({
        id: shape.id,
        type: PATCHWORK_VIEW_TYPE,
        props: isDocSlot
          ? { docUrl: "", docName: "" }
          : { toolId: "" },
      });

      editor.createShape({
        id: newId,
        type: PATCHWORK_TOKEN_TYPE,
        x: startPoint.x - tokenW / 2,
        y: startPoint.y - tokenH / 2,
        props: { w: tokenW, h: tokenH, data: tokenData },
      });

      let isOverView = false;

      const handleMove = (me: PointerEvent) => {
        const point = editor.screenToPage({ x: me.clientX, y: me.clientY });
        editor.updateShape({
          id: newId,
          type: PATCHWORK_TOKEN_TYPE,
          x: point.x - tokenW / 2,
          y: point.y - tokenH / 2,
        });

        const viewBounds = editor.getShapePageBounds(shape.id);
        const nowOver = !!(viewBounds && viewBounds.containsPoint(point));

        if (nowOver && !isOverView) {
          editor.updateShape({
            id: shape.id,
            type: PATCHWORK_VIEW_TYPE,
            props: isDocSlot
              ? { docUrl: savedDocUrl, docName: savedDocName }
              : { toolId: savedToolId },
          });
        } else if (!nowOver && isOverView) {
          editor.updateShape({
            id: shape.id,
            type: PATCHWORK_VIEW_TYPE,
            props: isDocSlot
              ? { docUrl: "", docName: "" }
              : { toolId: "" },
          });
        }
        isOverView = nowOver;
      };

      const handleUp = (me: PointerEvent) => {
        cleanup();
        const point = editor.screenToPage({ x: me.clientX, y: me.clientY });
        const viewBounds = editor.getShapePageBounds(shape.id);

        if (viewBounds && viewBounds.containsPoint(point)) {
          editor.updateShape({
            id: shape.id,
            type: PATCHWORK_VIEW_TYPE,
            props: isDocSlot
              ? { docUrl: savedDocUrl, docName: savedDocName }
              : { toolId: savedToolId },
          });
          editor.deleteShape(newId);
        }
      };

      const cleanup = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    };

    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#fff",
          border: "1px solid #bbb",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          fontFamily: "sans-serif",
          fontSize: 12,
          pointerEvents: "all",
        }}
      >
        {/* Header: token slots */}
        <div
          className="patchwork-view-header"
          style={{
            height: HEADER_HEIGHT,
            minHeight: HEADER_HEIGHT,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 8px",
            background: "#f0f0f0",
            borderBottom: "1px solid #ccc",
          }}
        >
          {/* Doc slot */}
          {hasDoc ? (
            <div
              className="patchwork-view-token"
              style={{
                ...DOC_TOKEN_STYLE,
                flex: 1,
                cursor: "grab",
                userSelect: "none",
              }}
              onPointerDown={(e) => handleDragOut(e, "doc")}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {docName || "Untitled"}
            </div>
          ) : (
            <DocSlotPlaceholder height={TOKEN_H} />
          )}

          {/* Tool slot */}
          {hasTool ? (
            <div
              className="patchwork-view-token"
              style={{ cursor: "grab", userSelect: "none" }}
              onPointerDown={(e) => handleDragOut(e, "tool")}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <ToolTokenSvg
                label={toolId}
                width={toolW}
                height={TOKEN_H}
              />
            </div>
          ) : (
            <ToolSlotPlaceholder width={TOOL_SLOT_W} height={TOKEN_H} />
          )}
        </div>

        {/* Body: ViewBody shields events from tldraw when editing */}
        <ViewBody active={isEditing}>
          {hasDoc && hasTool ? (
            // @ts-expect-error Custom element from patchwork-elements
            <patchwork-view
              doc-url={docUrl}
              tool-id={toolId}
              style={{
                display: "block",
                position: "absolute",
                inset: 0,
                pointerEvents: isEditing ? "all" : "none",
              }}
            />
          ) : null}
        </ViewBody>
      </HTMLContainer>
    );
  }

  override indicator(shape: PatchworkViewShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />
    );
  }
}
