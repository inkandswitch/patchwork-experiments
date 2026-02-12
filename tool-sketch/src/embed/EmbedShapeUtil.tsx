import { useCallback, useEffect, useRef, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, type RecordProps, Rectangle2d, T, type TLResizeInfo, type TLShape, resizeBox, type Editor } from "tldraw";
import { useDocHandle, useDocument } from "@automerge/automerge-repo-react-hooks";
import { type AutomergeUrl } from "@automerge/automerge-repo";
import { getSupportedToolsForType } from "@inkandswitch/patchwork-plugins";
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
  const { docUrl, toolId, type } = shape.props;
  const editor = util.editor;

  const [selectedToolId, setSelectedToolId] = useState<string | null>(toolId ?? null);
  const effectiveToolId = toolId ?? selectedToolId;

  if (!docUrl) {
    return <EmptyEmbed w={shape.props.w} h={shape.props.h} />;
  }

  return (
    <div
      className="w-full h-full flex flex-col relative bg-white"
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
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
        <div className="flex-1 min-h-0 pointer-events-auto">
          {/* @ts-expect-error Custom element from patchwork-elements */}
          <patchwork-view doc-url={docUrl} tool-id={effectiveToolId} style={{ width: "100%", height: "100%", display: "block" }} />
        </div>
      )}
    </div>
  );
}

function EmbedHeader({ shape, editor, docUrl, type, effectiveToolId, onSelectTool }: { shape: IEmbedShape; editor: Editor; docUrl: AutomergeUrl; type?: string; effectiveToolId: string | null; onSelectTool: (id: string) => void }) {
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
    <div onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp} className="px-2 py-1.5 border-b border-gray-200 cursor-grab flex items-center gap-2 shrink-0 bg-gray-50">
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

    // Use local-modules getDatatypeById for registry lookup
    // eslint-disable-next-line import/no-relative-packages
    // (If not already imported, at the top: import { getDatatypeById } from "@tool-sketch/src/local-modules";)
    // Here, we use dynamic import if not statically available, adapt as needed for your codebase.

    const plugin = getDatatypeById(docType) as any;
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

  const autoSelectedRef = useRef(false);

  if (loading || !docType) {
    return <span className="text-xs text-gray-400">{loading ? "Loading..." : "Unknown document type"}</span>;
  }

  const tools = getSupportedToolsForType(docType).filter((t) => !t.unlisted);

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
