import { useCallback, useEffect, useRef, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, type RecordProps, Rectangle2d, T, type TLResizeInfo, type TLShape, resizeBox, type Editor } from "tldraw";
import { useDocHandle } from "@automerge/react";
import { getSupportedToolsForType } from "@inkandswitch/patchwork-plugins";
import type { HasPatchworkMetadata } from "@inkandswitch/patchwork-filesystem";
import { parseEmbedUrl } from "./parseEmbedUrl";
import "@inkandswitch/patchwork-elements";

const EMBED_TYPE = "patchwork-embed";
const EMBED_BG = "var(--color-background)";

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    [EMBED_TYPE]: {
      w: number;
      h: number;
      docUrl?: string;
      toolId?: string;
      type?: string;
    };
  }
}

export type IEmbedShape = TLShape<typeof EMBED_TYPE>;

export class EmbedShapeUtil extends BaseBoxShapeUtil<IEmbedShape> {
  static override type = EMBED_TYPE;
  static override props: RecordProps<IEmbedShape> = {
    w: T.positiveNumber,
    h: T.positiveNumber,
    docUrl: T.string.optional(),
    toolId: T.string.optional(),
    type: T.string.optional(),
  };

  override getDefaultProps(): IEmbedShape["props"] {
    return {
      w: 400,
      h: 300,
    };
  }

  override getGeometry(shape: IEmbedShape) {
    const w = Math.max(1, shape.props.w);
    const h = Math.max(1, shape.props.h);
    return new Rectangle2d({
      width: w,
      height: h,
      isFilled: true,
    });
  }

  override onResize(shape: IEmbedShape, info: TLResizeInfo<IEmbedShape>) {
    return resizeBox(shape, info);
  }

  override canEdit() {
    return false;
  }

  override onDoubleClick(shape: IEmbedShape) {
    if (!shape.props.docUrl) {
      const url = window.prompt("Enter document URL or ID:", "");
      if (url) {
        const parsed = parseEmbedUrl(url);
        if (parsed) {
          const props = { ...shape.props, docUrl: parsed.docUrl };
          if (parsed.toolId != null) props.toolId = parsed.toolId;
          else delete props.toolId;
          if (parsed.type != null) props.type = parsed.type;
          else delete props.type;
          this.editor.updateShape({
            id: shape.id,
            type: EMBED_TYPE,
            props,
          });
        }
      }
    }
  }

  override component(shape: IEmbedShape) {
    return (
      <HTMLContainer
        id={shape.id}
        style={{
          width: shape.props.w,
          height: shape.props.h,
          minWidth: shape.props.w,
          minHeight: shape.props.h,
          overflow: "hidden",
          position: "relative",
          pointerEvents: "all",
          backgroundColor: EMBED_BG,
        }}
      >
        <EmbedContent shape={shape} util={this} />
      </HTMLContainer>
    );
  }

  override indicator(shape: IEmbedShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}

function EmbedContent({ shape, util }: { shape: IEmbedShape; util: EmbedShapeUtil }) {
  const { docUrl, toolId, type } = shape.props;
  const editor = util.editor;

  const [selectedToolId, setSelectedToolId] = useState<string | null>(toolId ?? null);
  const effectiveToolId = toolId ?? selectedToolId;

  if (!docUrl) {
    return <EmptyEmbed w={shape.props.w} h={shape.props.h} />;
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: EMBED_BG,
      }}
    >
      <EmbedHeader
        shape={shape}
        editor={editor}
        docUrl={docUrl}
        type={type}
        effectiveToolId={effectiveToolId}
        onSelectTool={(id) => {
          setSelectedToolId(id || null);
          const props = { ...shape.props };
          if (id) props.toolId = id;
          else delete props.toolId;
          editor.updateShape({
            id: shape.id,
            type: EMBED_TYPE,
            props,
          });
        }}
      />
      {effectiveToolId && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            pointerEvents: "all",
          }}
        >
          {/* @ts-expect-error Custom element from patchwork-elements */}
          <patchwork-view doc-url={docUrl} tool-id={effectiveToolId} style={{ width: "100%", height: "100%", display: "block" }} />
        </div>
      )}
    </div>
  );
}

function EmbedHeader({ shape, editor, docUrl, type, effectiveToolId, onSelectTool }: { shape: IEmbedShape; editor: Editor; docUrl: string; type?: string; effectiveToolId: string | null; onSelectTool: (id: string) => void }) {
  const dragRef = useRef<{ startX: number; startY: number; shapeX: number; shapeY: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      const pagePoint = editor.screenToPage({ x: e.clientX, y: e.clientY });
      dragRef.current = {
        startX: pagePoint.x,
        startY: pagePoint.y,
        shapeX: shape.x,
        shapeY: shape.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [editor, shape.x, shape.y]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const pagePoint = editor.screenToPage({ x: e.clientX, y: e.clientY });
      const dx = pagePoint.x - dragRef.current.startX;
      const dy = pagePoint.y - dragRef.current.startY;
      editor.updateShape({
        id: shape.id,
        type: EMBED_TYPE,
        x: dragRef.current.shapeX + dx,
        y: dragRef.current.shapeY + dy,
      });
      dragRef.current = {
        startX: pagePoint.x,
        startY: pagePoint.y,
        shapeX: dragRef.current.shapeX + dx,
        shapeY: dragRef.current.shapeY + dy,
      };
    },
    [editor, shape.id]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      style={{
        padding: "6px 8px",
        borderBottom: "1px solid var(--color-text-3)",
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
        backgroundColor: "var(--color-muted-1)",
      }}
    >
      {!effectiveToolId ? <ToolPickerDropdown docUrl={docUrl} type={type} onSelect={onSelectTool} /> : <ToolPickerDropdown docUrl={docUrl} type={type} onSelect={onSelectTool} value={effectiveToolId} />}
    </div>
  );
}

function EmptyEmbed({ w, h }: { w: number; h: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        border: "2px dashed var(--color-text-3)",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 12, color: "var(--color-text-3)" }}>Double click to add embed URL</span>
      <span style={{ fontSize: 10, color: "var(--color-text-2)" }}>Examples: automerge:xxx, or full patchwork URL</span>
    </div>
  );
}

function ToolPickerDropdown({ docUrl, type, onSelect, value }: { docUrl: string; type?: string; onSelect: (toolId: string) => void; value?: string }) {
  const [docType, setDocType] = useState<string | null>(type ?? null);
  const [loading, setLoading] = useState(!type);

  const handle = useDocHandle<HasPatchworkMetadata>(docUrl as any, {
    suspense: false,
  });

  useEffect(() => {
    if (type) {
      setDocType(type);
      setLoading(false);
      return;
    }
    if (!handle) return;
    handle.whenReady().then(() => {
      const doc = handle.doc();
      const t = doc?.["@patchwork"]?.type;
      setDocType(t ?? null);
      setLoading(false);
    });
  }, [handle, type]);

  if (loading || !docType) {
    return <span style={{ fontSize: 12, color: "var(--color-text-3)" }}>{loading ? "Loading..." : "Unknown document type"}</span>;
  }

  const tools = getSupportedToolsForType(docType);
  if (tools.length === 0) {
    return <span style={{ fontSize: 12, color: "var(--color-text-3)" }}>No tools for {docType}</span>;
  }

  if (tools.length === 1) {
    return <SingleToolPicker toolId={tools[0].id} name={tools[0].name} onSelect={onSelect} />;
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        const id = e.target.value;
        if (id) onSelect(id);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        padding: "4px 8px",
        fontSize: 12,
        border: "1px solid var(--color-text-3)",
        borderRadius: 4,
        background: "var(--color-background)",
        cursor: "pointer",
        flex: 1,
        minWidth: 0,
      }}
    >
      <option value="">Choose tool...</option>
      {tools.map((tool) => (
        <option key={tool.id} value={tool.id}>
          {tool.name}
        </option>
      ))}
    </select>
  );
}

function SingleToolPicker({ toolId, name, onSelect }: { toolId: string; name: string; onSelect: (id: string) => void }) {
  const calledRef = useRef(false);
  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      onSelect(toolId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId]);
  return <span style={{ fontSize: 12, color: "var(--color-text-3)" }}>Loading {name}...</span>;
}
