import { useState } from 'react';
import { X } from 'lucide-react';
import type { MapStyle, PredicateStyle } from '../datalog/datatype';

export const PALETTE = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
  '#64748b', // slate
];

// ---------------------------------------------------------------------------
// ColorPicker
// ---------------------------------------------------------------------------

interface ColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
}

function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Swatch trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Pick color"
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          border: value ? `2px solid ${value}` : '1.5px dashed #d1d5db',
          background: value ?? 'transparent',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
      />

      {/* Popover */}
      {open && (
        <>
          {/* Backdrop to close */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: 26,
              left: 0,
              zIndex: 50,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              padding: 8,
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 20px)',
              gap: 5,
            }}
          >
            {/* None option */}
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              title="None"
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                border: !value ? '2px solid #6b7280' : '1px solid #d1d5db',
                background: '#fff',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={10} color="#9ca3af" />
            </button>

            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => { onChange(c); setOpen(false); }}
                title={c}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  border: value === c ? '2px solid #1e293b' : '1px solid transparent',
                  background: c,
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StyleSidebar
// ---------------------------------------------------------------------------

interface StyleSidebarProps {
  open: boolean;
  onClose: () => void;
  mapStyle: MapStyle;
  linePredicates: string[];
  propertyPredicates: string[];
  onUpdateLine: (pred: string, patch: Partial<PredicateStyle>) => void;
  onUpdateProperty: (pred: string, patch: Partial<PredicateStyle>) => void;
}

export function StyleSidebar({
  open,
  onClose,
  mapStyle,
  linePredicates,
  propertyPredicates,
  onUpdateLine,
  onUpdateProperty,
}: StyleSidebarProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        height: '100%',
        width: 240,
        background: '#fff',
        boxShadow: '-2px 0 12px rgba(0,0,0,0.15)',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s ease',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid #e5e7eb',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>Map Style</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#6b7280',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '12px 14px' }}>
        <Section title="Lines">
          {linePredicates.length === 0 ? (
            <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>No line predicates found.</p>
          ) : (
            linePredicates.map((pred) => {
              const style = mapStyle.lines[pred] ?? { color: null, showLabel: false };
              return (
                <PredicateRow
                  key={pred}
                  pred={pred}
                  predStyle={style}
                  onChange={(patch) => onUpdateLine(pred, patch)}
                />
              );
            })
          )}
        </Section>

        <Section title="Attributes">
          {propertyPredicates.length === 0 ? (
            <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>No attribute predicates found.</p>
          ) : (
            propertyPredicates.map((pred) => {
              const style = mapStyle.properties[pred] ?? { color: null, showLabel: false };
              return (
                <PredicateRow
                  key={pred}
                  pred={pred}
                  predStyle={style}
                  onChange={(patch) => onUpdateProperty(pred, patch)}
                />
              );
            })
          )}
        </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          margin: '0 0 8px 0',
        }}
      >
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PredicateRow — unified for both lines and properties
// ---------------------------------------------------------------------------

interface PredicateRowProps {
  pred: string;
  predStyle: PredicateStyle;
  onChange: (patch: Partial<PredicateStyle>) => void;
}

function PredicateRow({ pred, predStyle, onChange }: PredicateRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        color: '#374151',
      }}
    >
      <ColorPicker
        value={predStyle.color}
        onChange={(color) => onChange({ color })}
      />

      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {pred}
      </span>

      <label
        style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flexShrink: 0 }}
        title="Show label on map"
      >
        <input
          type="checkbox"
          checked={predStyle.showLabel}
          onChange={(e) => onChange({ showLabel: e.target.checked })}
          style={{ width: 13, height: 13, cursor: 'pointer' }}
        />
        <span style={{ fontSize: 11, color: '#9ca3af' }}>label</span>
      </label>
    </div>
  );
}
