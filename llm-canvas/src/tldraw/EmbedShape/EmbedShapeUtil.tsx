import { HTMLContainer, Rectangle2d, ShapeUtil, T, createShapeId, resizeBox, useEditor, useValue, type RecordProps, type TLResizeInfo, type TLShape } from "@tldraw/tldraw";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getSupportedToolsForType, type LoadedTool } from "@inkandswitch/patchwork-plugins";
import { DocChip, ToolChip, ToolIcon } from "./TokenShapeUtil.tsx";

export const EMBED_SHAPE_TYPE = "tile-embed" as const;

declare module "@tldraw/tldraw" {
  export interface TLGlobalShapePropsMap {
    [EMBED_SHAPE_TYPE]: {
      w: number;
      h: number;
      docUrl: string;
      docName: string;
      docType: string;
      toolId: string;
    };
  }
}

export type EmbedShape = TLShape<typeof EMBED_SHAPE_TYPE>;

export function makeEmbedShapeId(docUrl: string) {
  return createShapeId(docUrl.replace(/[^a-zA-Z0-9]/g, "_"));
}

export class EmbedShapeUtil extends ShapeUtil<EmbedShape> {
  static override type = EMBED_SHAPE_TYPE;

  static override props: RecordProps<EmbedShape> = {
    w: T.number,
    h: T.number,
    docUrl: T.string,
    docName: T.string,
    docType: T.string,
    toolId: T.string,
  };

  getDefaultProps(): EmbedShape["props"] {
    return { w: 640, h: 480, docUrl: "", docName: "Untitled", docType: "", toolId: "" };
  }

  getGeometry(shape: EmbedShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canResize() {
    return true;
  }
  override canEdit() {
    return false;
  }
  override hideRotateHandle() {
    return true;
  }

  override onResize(shape: any, info: TLResizeInfo<any>) {
    return resizeBox(shape, info);
  }

  component(shape: EmbedShape) {
    return <EmbedShapeComponent shape={shape} />;
  }

  indicator(shape: EmbedShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}

// Closes when a pointerdown lands outside `ref`, but only while `active`.
function useOutsideClick(ref: React.RefObject<Element | null>, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", handler, true);
    return () => window.removeEventListener("pointerdown", handler, true);
  }, [ref, onClose, active]);
}

function useSupportedTools(docType: string): LoadedTool[] {
  return useMemo(() => {
    if (!docType) return [];
    try {
      return getSupportedToolsForType(docType).filter((t) => !(t as any).unlisted);
    } catch {
      return [];
    }
  }, [docType]);
}

function EmbedShapeComponent({ shape }: { shape: EmbedShape }) {
  const { docUrl, docName, docType, toolId } = shape.props;
  const editor = useEditor();
  const tools = useSupportedTools(docType);
  const isSelectTool = useValue("is select tool", () => editor.getCurrentToolId() === "select", [editor]);

  const [isFocused, setIsFocused] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const toolMenuRef = useRef<HTMLDivElement>(null);

  const currentTool = tools.find((t) => t.id === toolId) ?? tools[0];

  useOutsideClick(
    contentRef,
    useCallback(() => setIsFocused(false), []),
    isFocused,
  );
  useOutsideClick(
    toolMenuRef,
    useCallback(() => setToolMenuOpen(false), []),
    toolMenuOpen,
  );

  // Block tldraw keyboard / wheel / pointer events from reaching the canvas
  // while the embedded content is focused.
  useEffect(() => {
    if (!isFocused) return;
    const el = contentRef.current;
    if (!el) return;

    const stopKey = (e: KeyboardEvent) => e.stopPropagation();
    const stopWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) e.stopPropagation();
    };
    const stopPointer = (e: PointerEvent) => e.stopPropagation();

    el.addEventListener("keydown", stopKey);
    el.addEventListener("keyup", stopKey);
    el.addEventListener("keypress", stopKey);
    el.addEventListener("wheel", stopWheel);
    el.addEventListener("pointerdown", stopPointer, true);
    el.addEventListener("pointermove", stopPointer, true);
    el.addEventListener("pointerup", stopPointer, true);
    return () => {
      el.removeEventListener("keydown", stopKey);
      el.removeEventListener("keyup", stopKey);
      el.removeEventListener("keypress", stopKey);
      el.removeEventListener("wheel", stopWheel);
      el.removeEventListener("pointerdown", stopPointer, true);
      el.removeEventListener("pointermove", stopPointer, true);
      el.removeEventListener("pointerup", stopPointer, true);
    };
  }, [isFocused]);

  const handleToolChange = useCallback(
    (newToolId: string) => {
      editor.updateShape({ id: shape.id, type: EMBED_SHAPE_TYPE, props: { toolId: newToolId } } as any);
      setToolMenuOpen(false);
    },
    [editor, shape.id],
  );

  return (
    <HTMLContainer>
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid #e5e7eb",
          borderRadius: "6px",
          background: "#ffffff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          pointerEvents: "all",
        }}
      >
        {/* Titlebar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "28px",
            padding: "15px 5px",
            borderBottom: "1px solid #e5e7eb",
            flexShrink: 0,
            cursor: "grab",
            userSelect: "none",
            background: "#fafafa",
          }}
        >
          {/* Doc name — left (always-visible draggable chip) */}
          <DocChip docUrl={docUrl} name={docName || "Untitled"} />

          {/* Tool — right (always-visible draggable chip with dropdown) */}
          {currentTool && (
            <div ref={toolMenuRef} style={{ position: "relative", flexShrink: 0 }}>
              <ToolChip docUrl={docUrl} name={currentTool.name} hasDropdown={tools.length > 1} onPickerOpen={() => setToolMenuOpen((v) => !v)} />

              {toolMenuOpen && tools.length > 1 && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: "4px",
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "6px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
                    padding: "4px",
                    minWidth: "140px",
                    zIndex: 10000,
                  }}
                >
                  {tools.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleToolChange(t.id);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        width: "100%",
                        padding: "15px 5px",
                        border: "none",
                        borderRadius: "4px",
                        background: t.id === currentTool.id ? "#f0f4ff" : "transparent",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontFamily: "system-ui, -apple-system, sans-serif",
                        color: "#374151",
                        textAlign: "left",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <ToolIcon />
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content area */}
        <div
          ref={contentRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            position: "relative",
            // Always auto so that drag events (dragover/drop) reach inner elements.
            // Pointer events are stopped inline to preserve tldraw isolation.
            pointerEvents: "auto",
            userSelect: isFocused ? "text" : "none",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (isSelectTool) setIsFocused(true);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            if (isSelectTool) {
              // Synthesize click for frameworks using document-level delegation (e.g. Solid.js).
              (e.target as HTMLElement)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: e.clientX, clientY: e.clientY }));
            }
          }}
          onPointerMove={(e) => {
            if (!isSelectTool) e.stopPropagation();
          }}
        >
          {docUrl ? (
            // @ts-expect-error Custom element from @inkandswitch/patchwork-elements
            <patchwork-view doc-url={docUrl} {...(toolId ? { "tool-id": toolId } : {})} key={toolId || "default"} style={{ display: "block", width: "100%", height: "100%" }} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af", fontSize: "12px", fontFamily: "system-ui, -apple-system, sans-serif" }}>Creating…</div>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}
