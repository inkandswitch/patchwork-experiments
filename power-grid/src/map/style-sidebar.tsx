import { useState } from 'react';
import { X, Minus } from 'lucide-react';
import type { ColorScale, MapStyle, PredicateStyle } from '../datalog/datatype';

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

// CSS gradient strings for each scale (used in preview swatches)
export const SCALE_GRADIENTS: Record<ColorScale, string> = {
  'red-green':      'linear-gradient(to right, #ef4444, #eab308, #22c55e)',
  'green-red':      'linear-gradient(to right, #22c55e, #eab308, #ef4444)',
  'red-gray-green': 'linear-gradient(to right, #ef4444, #9ca3af, #22c55e)',
  'blue-red':       'linear-gradient(to right, #3b82f6, #06b6d4, #eab308, #ef4444)',
  'cool':           'linear-gradient(to right, #3b82f6, #06b6d4)',
  'plasma':         'linear-gradient(to right, #6d28d9, #be185d, #f59e0b)',
};

// ---------------------------------------------------------------------------
// ColorPicker — palette swatch grid, no "None" option
// ---------------------------------------------------------------------------

interface ColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
  allowClear?: boolean;
}

function ColorPicker({ value, onChange, allowClear }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const displayed = value ?? (allowClear ? null : PALETTE[0]);

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Pick color"
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          border: displayed ? `2px solid ${displayed}` : '1.5px dashed #d1d5db',
          background: displayed ?? '#f9fafb',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {!displayed && <Minus size={10} color="#9ca3af" />}
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          />
          <div
            style={{
              position: 'absolute',
              top: 26,
              right: 0,
              zIndex: 50,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 20px)',
                gap: 5,
              }}
            >
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => { onChange(c); setOpen(false); }}
                  title={c}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    border: displayed === c ? '2px solid #1e293b' : '1px solid transparent',
                    background: c,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              ))}
            </div>
            {allowClear && (
              <button
                onClick={() => { onChange(null); setOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  width: '100%',
                  padding: '3px 6px',
                  border: '1px solid #e5e7eb',
                  borderRadius: 4,
                  background: value === null ? '#f3f4f6' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 11,
                  color: '#6b7280',
                }}
              >
                <X size={10} />
                Clear
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dropdown — generic styled popover dropdown
// ---------------------------------------------------------------------------

interface DropdownOption {
  value: string | null;
  label: string;
  preview?: React.ReactNode;
}

interface DropdownProps {
  value: string | null;
  options: DropdownOption[];
  onChange: (value: string | null) => void;
  /** Custom trigger content. Falls back to preview + label of selected option. */
  renderTrigger?: (selected: DropdownOption | undefined) => React.ReactNode;
  triggerStyle?: React.CSSProperties;
}

function Dropdown({ value, options, onChange, renderTrigger, triggerStyle }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          height: 20,
          minWidth: 28,
          borderRadius: 4,
          border: '1px solid #d1d5db',
          background: '#fff',
          cursor: 'pointer',
          padding: '0 5px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
          color: '#374151',
          ...triggerStyle,
        }}
      >
        {renderTrigger
          ? renderTrigger(selected)
          : (
            <>
              {selected?.preview}
              <span>{selected?.label ?? '—'}</span>
            </>
          )}
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          />
          <div
            style={{
              position: 'absolute',
              top: 26,
              right: 0,
              zIndex: 50,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              padding: 4,
              minWidth: 148,
            }}
          >
            {options.map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '5px 8px',
                  background: opt.value === value ? '#eff6ff' : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 12,
                  color: opt.value === value ? '#1d4ed8' : '#374151',
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}
              >
                {opt.preview && <span style={{ flexShrink: 0, lineHeight: 1 }}>{opt.preview}</span>}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Direction dropdown options
// ---------------------------------------------------------------------------

type Direction = 'none' | 'forward' | 'backward';

const DIRECTION_OPTIONS: DropdownOption[] = [
  { value: 'none',     label: 'No arrow', preview: <span style={{ color: '#9ca3af', fontSize: 13 }}>—</span> },
  { value: 'forward',  label: 'Forward',  preview: <span style={{ fontSize: 13 }}>→</span> },
  { value: 'backward', label: 'Backward', preview: <span style={{ fontSize: 13 }}>←</span> },
];

// ---------------------------------------------------------------------------
// Scale dropdown options
// ---------------------------------------------------------------------------

function GradientSwatch({ scale }: { scale: ColorScale }) {
  return (
    <div
      style={{
        width: 40,
        height: 10,
        borderRadius: 2,
        background: SCALE_GRADIENTS[scale],
        flexShrink: 0,
        border: '1px solid rgba(0,0,0,0.06)',
      }}
    />
  );
}

const SCALE_OPTIONS: DropdownOption[] = [
  { value: null,             label: 'No scale' },
  { value: 'red-green',      label: 'Red → Green',      preview: <GradientSwatch scale="red-green" /> },
  { value: 'green-red',      label: 'Green → Red',      preview: <GradientSwatch scale="green-red" /> },
  { value: 'red-gray-green', label: 'Red → Gray → Green', preview: <GradientSwatch scale="red-gray-green" /> },
  { value: 'blue-red',       label: 'Blue → Red',       preview: <GradientSwatch scale="blue-red" /> },
  { value: 'cool',           label: 'Cool',             preview: <GradientSwatch scale="cool" /> },
  { value: 'plasma',         label: 'Plasma',           preview: <GradientSwatch scale="plasma" /> },
];

// ---------------------------------------------------------------------------
// StyleSidebar
// ---------------------------------------------------------------------------

interface StyleSidebarProps {
  open: boolean;
  onClose: () => void;
  mapStyle: MapStyle;
  linePredicates: string[];
  unaryPredicates: string[];
  numericPredicates: string[];
  textPredicates: string[];
  onUpdateLine: (pred: string, patch: Partial<PredicateStyle>) => void;
  onUpdateProperty: (pred: string, patch: Partial<PredicateStyle>) => void;
  onHoverPred: (pred: string | null) => void;
}

export function StyleSidebar({
  open,
  onClose,
  mapStyle,
  linePredicates,
  unaryPredicates,
  numericPredicates,
  textPredicates,
  onUpdateLine,
  onUpdateProperty,
  onHoverPred,
}: StyleSidebarProps) {
  const allAttributePredicates = [...unaryPredicates, ...numericPredicates, ...textPredicates];
  const DEFAULT_STYLE: PredicateStyle = { color: null, enabled: false, direction: 'none', scale: null };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        height: '100%',
        width: 270,
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
              const ps = mapStyle.lines[pred] ?? DEFAULT_STYLE;
              return (
                <LinePredicateRow
                  key={pred}
                  pred={pred}
                  predStyle={ps}
                  onChange={(patch) => onUpdateLine(pred, patch)}
                  onHoverChange={(hovered) => onHoverPred(hovered ? pred : null)}
                />
              );
            })
          )}
        </Section>

        <Section title="Attributes">
          {allAttributePredicates.length === 0 ? (
            <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>No attribute predicates found.</p>
          ) : (
            allAttributePredicates.map((pred) => {
              const ps = mapStyle.properties[pred] ?? DEFAULT_STYLE;
              const isUnary = unaryPredicates.includes(pred);
              const isNumeric = numericPredicates.includes(pred);
              return (
                <AttributePredicateRow
                  key={pred}
                  pred={pred}
                  predStyle={ps}
                  kind={isUnary ? 'unary' : isNumeric ? 'numeric' : 'text'}
                  onChange={(patch) => onUpdateProperty(pred, patch)}
                  onHoverChange={(hovered) => onHoverPred(hovered ? pred : null)}
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
// Shared clickable name span
// ---------------------------------------------------------------------------

function PredicateName({
  pred,
  enabled,
  onEnable,
}: {
  pred: string;
  enabled: boolean;
  onEnable: () => void;
}) {
  return (
    <span
      onClick={() => { if (!enabled) onEnable(); }}
      style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        cursor: enabled ? 'default' : 'pointer',
        userSelect: 'none',
        fontSize: 13,
        color: '#374151',
      }}
      title={pred}
    >
      {pred}
    </span>
  );
}

// ---------------------------------------------------------------------------
// LinePredicateRow — checkbox | name | color picker | direction dropdown
// ---------------------------------------------------------------------------

interface LineRowProps {
  pred: string;
  predStyle: PredicateStyle;
  onChange: (patch: Partial<PredicateStyle>) => void;
  onHoverChange: (hovered: boolean) => void;
}

function LinePredicateRow({ pred, predStyle, onChange, onHoverChange }: LineRowProps) {
  return (
    <div
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
    >
      <input
        type="checkbox"
        checked={predStyle.enabled}
        onChange={(e) => onChange({ enabled: e.target.checked })}
        style={{ width: 13, height: 13, cursor: 'pointer', flexShrink: 0, margin: 0 }}
      />

      <PredicateName
        pred={pred}
        enabled={predStyle.enabled}
        onEnable={() => onChange({ enabled: true })}
      />

      <ColorPicker
        value={predStyle.color}
        onChange={(color) => onChange({ color })}
      />

      <Dropdown
        value={predStyle.direction}
        options={DIRECTION_OPTIONS}
        onChange={(v) => onChange({ direction: (v ?? 'none') as Direction })}
        renderTrigger={(sel) => (
          <span style={{ fontSize: 14, color: '#374151', lineHeight: 1 }}>
            {sel?.preview ?? '—'}
          </span>
        )}
        triggerStyle={{ minWidth: 24, padding: '0 3px' }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttributePredicateRow — three variants by kind
// ---------------------------------------------------------------------------

interface AttrRowProps {
  pred: string;
  predStyle: PredicateStyle;
  kind: 'unary' | 'numeric' | 'text';
  onChange: (patch: Partial<PredicateStyle>) => void;
  onHoverChange: (hovered: boolean) => void;
}

function AttributePredicateRow({ pred, predStyle, kind, onChange, onHoverChange }: AttrRowProps) {
  return (
    <div
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
    >
      <input
        type="checkbox"
        checked={predStyle.enabled}
        onChange={(e) => onChange({ enabled: e.target.checked })}
        style={{ width: 13, height: 13, cursor: 'pointer', flexShrink: 0, margin: 0 }}
      />

      <PredicateName
        pred={pred}
        enabled={predStyle.enabled}
        onEnable={() => onChange({ enabled: true })}
      />

      {kind === 'unary' && (
        <ColorPicker
          value={predStyle.color}
          onChange={(color) => onChange({ color })}
          allowClear
        />
      )}

      {kind === 'numeric' && (
        <Dropdown
          value={predStyle.scale}
          options={SCALE_OPTIONS}
          onChange={(v) => onChange({ scale: v as ColorScale | null })}
          renderTrigger={(sel) =>
            sel?.value ? (
              <div
                style={{
                  width: 36,
                  height: 10,
                  borderRadius: 2,
                  background: SCALE_GRADIENTS[sel.value as ColorScale],
                  border: '1px solid rgba(0,0,0,0.08)',
                }}
              />
            ) : (
              <span style={{ fontSize: 11, color: '#9ca3af' }}>scale</span>
            )
          }
          triggerStyle={{ minWidth: 50, padding: '0 4px' }}
        />
      )}
    </div>
  );
}
