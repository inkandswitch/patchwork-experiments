import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type TLShape,
} from "@tldraw/tldraw";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem";
import {
  PATCHWORK_TOKEN_TYPE,
  type PatchworkDndData,
  type PatchworkDndItem,
} from "./PatchworkTokenShape.tsx";

export const PATCHWORK_WINDOW_TYPE = "patchwork-window" as const;

declare module "@tldraw/tldraw" {
  export interface TLGlobalShapePropsMap {
    [PATCHWORK_WINDOW_TYPE]: { w: number; h: number; data: string };
  }
}

export type PatchworkWindowShape = TLShape<typeof PATCHWORK_WINDOW_TYPE>;

const HEADER_HEIGHT = 36;

export class PatchworkWindowShapeUtil extends BaseBoxShapeUtil<PatchworkWindowShape> {
  static override type = PATCHWORK_WINDOW_TYPE as string;

  static override props = {
    w: T.number,
    h: T.number,
    data: T.string,
  };

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override getDefaultProps(): PatchworkWindowShape["props"] {
    return {
      w: 400,
      h: 300,
      data: "{}",
    };
  }

  override component(shape: PatchworkWindowShape) {
    const editor = this.editor;
    const isEditing = editor.getEditingShapeId() === shape.id;

    let parsed: PatchworkDndData | null = null;
    try {
      parsed = JSON.parse(shape.props.data);
    } catch {
      // invalid JSON
    }

    const firstItem = parsed?.items?.[0];
    const iframeSrc = firstItem?.url
      ? automergeUrlToServiceWorkerUrl(firstItem.url as AutomergeUrl)
      : undefined;

    const handleDragOut = (
      e: React.PointerEvent,
      tokenData: string,
      tokenW: number,
      tokenH: number,
    ) => {
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      let pastThreshold = false;

      const handleMove = (me: PointerEvent) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          pastThreshold = true;
        }
      };

      const handleUp = (me: PointerEvent) => {
        cleanup();
        if (pastThreshold) {
          const point = editor.screenToPage({ x: me.clientX, y: me.clientY });
          editor.markHistoryStoppingPoint("drag out token from window");
          editor.createShape({
            type: PATCHWORK_TOKEN_TYPE,
            x: point.x - tokenW / 2,
            y: point.y - tokenH / 2,
            props: { w: tokenW, h: tokenH, data: tokenData },
          });
        }
      };

      const cleanup = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    };

    const makeTypeTokenData = (item: PatchworkDndItem) =>
      JSON.stringify({ source: parsed?.source ?? "", items: [item] });

    const makeDocTokenData = () =>
      JSON.stringify({ source: parsed?.source ?? "", items: parsed?.items ?? [] });

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
        <div
          className="patchwork-window-header"
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
          {firstItem && (
            <div
              className="patchwork-window-token"
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                padding: "2px 8px",
                background: "#fff",
                border: "1px solid #ddd",
                borderRadius: 4,
                cursor: "grab",
                userSelect: "none",
              }}
              onPointerDown={(e) =>
                handleDragOut(
                  e,
                  makeDocTokenData(),
                  220,
                  40 + (parsed?.items?.length ?? 1) * 28,
                )
              }
              onTouchStart={(e) => e.stopPropagation()}
            >
              {firstItem.name}
            </div>
          )}
          {parsed?.items?.map((item, i) => (
            <div
              key={item.id ?? i}
              className="patchwork-window-token"
              style={{
                padding: "2px 8px",
                background: "#e8e8e8",
                border: "1px solid #ccc",
                borderRadius: 4,
                fontSize: 10,
                textTransform: "uppercase",
                color: "#666",
                cursor: "grab",
                userSelect: "none",
                whiteSpace: "nowrap",
              }}
              onPointerDown={(e) =>
                handleDragOut(e, makeTypeTokenData(item), 220, 68)
              }
              onTouchStart={(e) => e.stopPropagation()}
            >
              {item.type}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {iframeSrc ? (
            <iframe
              src={iframeSrc}
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                pointerEvents: isEditing ? "all" : "none",
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "#999",
              }}
            >
              No document URL
            </div>
          )}
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: PatchworkWindowShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />;
  }
}
