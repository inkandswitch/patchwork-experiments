import { createPortal } from 'react-dom';
import { useEffect, useRef, type RefObject } from 'react';
import {
  getRegistry,
  type DatatypeDescription,
} from '@inkandswitch/patchwork-plugins';

export function getListedDatatypes(): DatatypeDescription[] {
  try {
    const registry = getRegistry<DatatypeDescription>('patchwork:datatype');
    return registry.filter((d) => !d.unlisted) as unknown as DatatypeDescription[];
  } catch {
    return [];
  }
}

interface EmbedShapeMenuProps {
  datatypes: DatatypeDescription[];
  selectedId: string;
  pos: { x: number; y: number };
  /** The button that opened this menu — excluded from the outside-click check. */
  anchorRef: RefObject<Element | null>;
  onPick: (id: string) => void;
  onClose: () => void;
}

export function EmbedShapeMenu({ datatypes, selectedId, pos, anchorRef, onPick, onClose }: EmbedShapeMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside both the menu and the anchor button.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        transform: 'translate(-50%, -100%)',
        marginTop: '-8px',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        padding: '4px',
        minWidth: '150px',
        zIndex: 100000,
      }}
    >
      {datatypes.map((dt) => (
        <button
          key={dt.id}
          type="button"
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onPick(dt.id); }}
          style={{
            display: 'block',
            width: '100%',
            padding: '6px 10px',
            border: 'none',
            borderRadius: '4px',
            background: dt.id === selectedId ? '#f0f4ff' : 'transparent',
            cursor: 'pointer',
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#333',
            textAlign: 'left',
            whiteSpace: 'nowrap',
          }}
          onPointerEnter={(e) => {
            if (dt.id !== selectedId) (e.currentTarget as HTMLElement).style.background = '#f5f5f5';
          }}
          onPointerLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = dt.id === selectedId ? '#f0f4ff' : 'transparent';
          }}
        >
          {dt.name}
        </button>
      ))}
    </div>,
    document.body,
  );
}
