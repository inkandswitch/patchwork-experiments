import {
  EditorAtom,
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
  type RecordProps,
  type TLShape,
  type TLShapeId,
} from '@tldraw/tldraw';
import { useCallback, useLayoutEffect, useRef } from 'react';
import {
  DocChip,
  ToolChip,
  ToolIcon,
  type DocChipProps,
  type ToolChipProps,
} from '../../shared/tokens.tsx';

export { DocChip, ToolChip, ToolIcon };
export type { DocChipProps, ToolChipProps };

// ---------------------------------------------------------------------------
// DOM-driven sizing via EditorAtom + ResizeObserver
// ---------------------------------------------------------------------------

const TokenShapeSizes = new EditorAtom(
  'token shape sizes',
  (editor) => {
    const map = new Map<TLShapeId, { width: number; height: number }>();
    editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
      TokenShapeSizes.update(editor, (m) => {
        if (!m.has(shape.id)) return m;
        const next = new Map(m);
        next.delete(shape.id);
        return next;
      });
    });
    return map;
  },
);

function useTokenShapeSize(shapeId: TLShapeId) {
  const ref = useRef<HTMLDivElement>(null);
  const editor = useEditor();

  const updateSize = useCallback(() => {
    if (!ref.current) return;
    const { offsetWidth: width, offsetHeight: height } = ref.current;
    TokenShapeSizes.update(editor, (map) => {
      const existing = map.get(shapeId);
      if (existing?.width === width && existing?.height === height) return map;
      const next = new Map(map);
      next.set(shapeId, { width, height });
      return next;
    });
  }, [editor, shapeId]);

  // Measure after every render
  useLayoutEffect(() => {
    updateSize();
  });

  // Watch for DOM size changes
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(updateSize);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [updateSize]);

  return ref;
}

// ---------------------------------------------------------------------------
// tile-token-doc
// ---------------------------------------------------------------------------

export const DOC_TOKEN_SHAPE_TYPE = 'tile-token-doc' as const;

declare module '@tldraw/tldraw' {
  export interface TLGlobalShapePropsMap {
    [DOC_TOKEN_SHAPE_TYPE]: {
      docUrl: string;
      name: string;
    };
  }
}

export type DocTokenShape = TLShape<typeof DOC_TOKEN_SHAPE_TYPE>;

function DocTokenComponent({ shape }: { shape: DocTokenShape }) {
  const { docUrl, name } = shape.props;
  const editor = useEditor();
  const sizeRef = useTokenShapeSize(shape.id);
  return (
    <HTMLContainer>
      <DocChip
        docUrl={docUrl}
        name={name}
        chipRef={sizeRef}
        dragEffect="move"
        onDragEnd={(e) => {
          if (e.dataTransfer?.dropEffect !== 'none') {
            editor.deleteShapes([shape.id]);
          }
        }}
      />
    </HTMLContainer>
  );
}

export class DocTokenShapeUtil extends ShapeUtil<DocTokenShape> {
  static override type = DOC_TOKEN_SHAPE_TYPE;

  static override props: RecordProps<DocTokenShape> = {
    docUrl: T.string,
    name: T.string,
  };

  getDefaultProps(): DocTokenShape['props'] {
    return { docUrl: '', name: 'Untitled' };
  }

  getGeometry(shape: DocTokenShape) {
    const size = TokenShapeSizes.get(this.editor).get(shape.id);
    return new Rectangle2d({ width: size?.width ?? 120, height: 24, isFilled: true });
  }

  override canResize() { return false; }
  override hideRotateHandle() { return true; }
  override hideSelectionBoundsBg() { return true; }
  override hideSelectionBoundsFg() { return true; }
  override canCull() { return false; }

  component(shape: DocTokenShape) {
    return <DocTokenComponent shape={shape} />;
  }

  indicator(shape: DocTokenShape) {
    const size = TokenShapeSizes.get(this.editor).get(shape.id);
    const w = size?.width ?? 120;
    return <rect width={w} height={24} rx={12} />;
  }
}

// ---------------------------------------------------------------------------
// tile-token-tool
// ---------------------------------------------------------------------------

export const TOOL_TOKEN_SHAPE_TYPE = 'tile-token-tool' as const;

declare module '@tldraw/tldraw' {
  export interface TLGlobalShapePropsMap {
    [TOOL_TOKEN_SHAPE_TYPE]: {
      docUrl: string;
      name: string;
      path: string;
    };
  }
}

export type ToolTokenShape = TLShape<typeof TOOL_TOKEN_SHAPE_TYPE>;

function ToolTokenComponent({ shape }: { shape: ToolTokenShape }) {
  const { docUrl, name, path } = shape.props;
  const editor = useEditor();
  const sizeRef = useTokenShapeSize(shape.id);
  return (
    <HTMLContainer>
      <ToolChip
        docUrl={docUrl}
        name={name}
        path={path}
        chipRef={sizeRef}
        dragEffect="move"
        onDragEnd={(e) => {
          if (e.dataTransfer.dropEffect !== 'none') {
            editor.deleteShapes([shape.id]);
          }
        }}
      />
    </HTMLContainer>
  );
}

export class ToolTokenShapeUtil extends ShapeUtil<ToolTokenShape> {
  static override type = TOOL_TOKEN_SHAPE_TYPE;

  static override props: RecordProps<ToolTokenShape> = {
    docUrl: T.string,
    name: T.string,
    path: T.string,
  };

  getDefaultProps(): ToolTokenShape['props'] {
    return { docUrl: '', name: 'Untitled', path: '' };
  }

  getGeometry(shape: ToolTokenShape) {
    const size = TokenShapeSizes.get(this.editor).get(shape.id);
    return new Rectangle2d({ width: size?.width ?? 120, height: 24, isFilled: true });
  }

  override canResize() { return false; }
  override hideRotateHandle() { return true; }
  override hideSelectionBoundsBg() { return true; }
  override hideSelectionBoundsFg() { return true; }
  override canCull() { return false; }

  component(shape: ToolTokenShape) {
    return <ToolTokenComponent shape={shape} />;
  }

  indicator(shape: ToolTokenShape) {
    const size = TokenShapeSizes.get(this.editor).get(shape.id);
    const w = size?.width ?? 120;
    return <rect width={w} height={24} rx={12} />;
  }
}
