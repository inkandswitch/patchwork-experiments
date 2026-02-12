import { useCallback, useEffect, useRef, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, type RecordProps, Rectangle2d, T, type TLResizeInfo, type TLShape, resizeBox, type Editor, useIsEditing } from "tldraw";
import { useDocHandle, useDocument } from "@automerge/automerge-repo-react-hooks";
import { type AutomergeUrl } from "@automerge/automerge-repo";
import { useToolDescriptions } from "@inkandswitch/patchwork-react";
import type { HasPatchworkMetadata } from "@inkandswitch/patchwork-filesystem";
import { parseEmbedUrl } from "./parseEmbedUrl";
import "@inkandswitch/patchwork-elements";
import { getDatatypeById } from "../local-modules";

const EMBED_TYPE = "patchwork-embed";

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    [EMBED_TYPE]: {
      w: number;
      h: number;
      docUrl?: string;
      toolId?: string;
      type?: string;
      placeholder?: boolean;
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
    placeholder: T.boolean.optional(),
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

  override canEdit(shape: IEmbedShape) {
    return !!shape.props.docUrl;
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
          pointerEvents: "all",
        }}
      >
        <div className="w-full h-full overflow-hidden relative border border-gray-300 rounded bg-white">
          <EmbedContent shape={shape} util={this} />
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: IEmbedShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}

function EmbedContent({ shape, util }: { shape: IEmbedShape; util: EmbedShapeUtil }) {
  const { docUrl, toolId, type, placeholder } = shape.props;
  const editor = util.editor;

  const [selectedToolId, setSelectedToolId] = useState<string | null>(toolId ?? null);
  const effectiveToolId = toolId ?? selectedToolId;

  const isEditing = useIsEditing(shape.id);
  const contentRef = useRef<HTMLDivElement>(null);

  // Stop events from bubbling to tldraw when in editing/interaction mode.
  // Unlike iframes, custom elements don't create an event boundary,
  // so we need to manually prevent propagation.
  useEffect(() => {
    if (!isEditing) return;
    const el = contentRef.current;
    if (!el) return;

    const stopProp = (e: Event) => {
      e.stopPropagation();
    };

    const events = [
      "pointerdown", "pointermove", "pointerup", "pointercancel",
      "mousedown", "mousemove", "mouseup",
      "click", "dblclick",
      "keydown", "keyup", "keypress",
      "wheel",
      "touchstart", "touchmove", "touchend", "touchcancel",
    ];

    for (const evt of events) {
      el.addEventListener(evt, stopProp);
    }

    return () => {
      for (const evt of events) {
        el.removeEventListener(evt, stopProp);
      }
    };
  }, [isEditing]);

  if (placeholder) {
    return <PlaceholderEmbed w={shape.props.w} h={shape.props.h} />;
  }

  if (!docUrl) {
    return <EmptyEmbed w={shape.props.w} h={shape.props.h} />;
  }

  return (
    <div className="w-full h-full flex flex-col relative bg-white">
      <EmbedHeader
        shape={shape}
        editor={editor}
        docUrl={docUrl as AutomergeUrl}
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
          ref={contentRef}
          className="flex-1 min-h-0 relative"
        >
          {/* @ts-expect-error Custom element from patchwork-elements */}
          <patchwork-view
            key={effectiveToolId}
            doc-url={docUrl}
            tool-id={effectiveToolId}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              pointerEvents: isEditing ? "auto" : "none",
            }}
          />
        </div>
      )}
      {effectiveToolId && (
        <div
          style={{
            textAlign: "center",
            position: "absolute",
            bottom: isEditing ? -40 : 0,
            padding: 4,
            fontFamily: "inherit",
            fontSize: 12,
            left: 0,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              background: "var(--color-panel, white)",
              padding: "4px 12px",
              borderRadius: 99,
              border: "1px solid var(--color-muted-1, #e5e7eb)",
            }}
          >
            {isEditing ? "Click the canvas to exit" : "Double click to interact"}
          </span>
        </div>
      )}
    </div>
  );
}

function EmbedHeader({ shape, editor, docUrl, type, effectiveToolId, onSelectTool }: { shape: IEmbedShape; editor: Editor; docUrl: AutomergeUrl; type?: string; effectiveToolId: string | null; onSelectTool: (id: string) => void }) {
  const headerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    shapeX: number;
    shapeY: number;
  } | null>(null);

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
      headerRef.current?.setPointerCapture(e.pointerId);
    },
    [editor, shape.x, shape.y]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const pagePoint = editor.screenToPage({ x: e.clientX, y: e.clientY });
      editor.updateShape({
        id: shape.id,
        type: EMBED_TYPE,
        x: dragRef.current.shapeX + (pagePoint.x - dragRef.current.startX),
        y: dragRef.current.shapeY + (pagePoint.y - dragRef.current.startY),
      });
    },
    [editor, shape.id]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = null;
      headerRef.current?.releasePointerCapture(e.pointerId);
    },
    []
  );

  return (
    <div ref={headerRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} className="px-2 py-1.5 border-b border-gray-200 cursor-grab flex items-center gap-2 shrink-0 bg-gray-50" style={{ pointerEvents: "all" }}>
      <DocTitle docUrl={docUrl} type={type} />
      <div className="flex-1 min-w-0"></div>
      <ToolPickerDropdown docUrl={docUrl} type={type} onSelect={onSelectTool} value={effectiveToolId ?? undefined} />
    </div>
  );
}

function DocTitle({ docUrl, type }: { docUrl: AutomergeUrl; type?: string }) {
  const [doc] = useDocument<HasPatchworkMetadata>(docUrl, { suspense: true });
  const [title, setTitle] = useState<string>("");

  useEffect(() => {
    if (!doc) return;

    const docType = type ?? doc["@patchwork"]?.type;
    if (!docType) return;

    const plugin = getDatatypeById(docType);
    if (plugin?.module?.getTitle) {
      setTitle(plugin.module.getTitle(doc));
    }
  }, [doc, type]);

  if (!title) return "Untitled";
  return <span className="text-xs font-medium text-gray-700 truncate">{title}</span>;
}

function EmptyEmbed({ w, h }: { w: number; h: number }) {
  return (
    <div className="flex items-center justify-center flex-col gap-2" style={{ width: w, height: h }}>
      <span className="text-xs text-gray-400">Double click to add embed URL</span>
    </div>
  );
}

function PlaceholderEmbed({ w, h }: { w: number; h: number }) {
  return (
    <div className="flex items-center justify-center flex-col gap-3" style={{ width: w, height: h }}>
      <div
        style={{
          width: 24,
          height: 24,
          border: "3px solid #e5e7eb",
          borderTopColor: "#2563eb",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <span className="text-xs text-gray-500 font-medium">Generating tool...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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

  const allTools = useToolDescriptions();
  const autoSelectedRef = useRef(false);

  if (loading || !docType) {
    return <span className="text-xs text-gray-400">{loading ? "Loading..." : "Unknown document type"}</span>;
  }

  const tools = allTools.filter((t) => {
    if (t.unlisted) return false;
    return t.supportedDatatypes === "*" || t.supportedDatatypes.includes(docType);
  });

  if (tools.length === 0) {
    return <span className="text-xs text-gray-400">No tools for {docType}</span>;
  }

  return <ToolSelect tools={tools} value={value} onSelect={onSelect} autoSelectedRef={autoSelectedRef} />;
}

function ToolSelect({ tools, value, onSelect, autoSelectedRef }: { tools: { id: string; name: string }[]; value?: string; onSelect: (toolId: string) => void; autoSelectedRef: React.MutableRefObject<boolean> }) {
  useEffect(() => {
    if (!autoSelectedRef.current && !value && tools.length > 0) {
      autoSelectedRef.current = true;
      onSelect(tools[0].id);
    }
  }, [tools, value, onSelect, autoSelectedRef]);

  if (tools.length === 1) {
    return <span className="text-xs text-gray-500">{tools[0].name}</span>;
  }

  return (
    <select
      value={value ?? tools[0]?.id ?? ""}
      onChange={(e) => {
        const id = e.target.value;
        if (id) onSelect(id);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="px-2 py-1 text-xs border border-gray-300 rounded bg-white cursor-pointer flex-1 min-w-0 w-fit"
    >
      {tools.map((tool) => (
        <option key={tool.id} value={tool.id}>
          {tool.name}
        </option>
      ))}
    </select>
  );
}
