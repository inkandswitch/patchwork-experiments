import {
  DefaultContextMenu,
  DefaultContextMenuContent,
  DefaultStylePanel,
  DefaultStylePanelContent,
  DefaultToolbar,
  DefaultToolbarContent,
  StateNode,
  TldrawUiMenuItem,
  createShapeId,
  useEditor,
  useIsToolSelected,
  useTools,
  useValue,
  type Editor,
  type TLUiContextMenuProps,
  type TLUiOverrides,
  type TLUiStylePanelProps,
  type TLUiToolsContextType,
} from "@tldraw/tldraw";
import { useState } from "react";
import {
  PROPAGATOR_MEMBER_BINDING_TYPE,
  PROPAGATOR_SHAPE_TYPE,
  DEFAULT_TRANSFORM,
  type PropagatorShape,
} from "./PropagatorShape.tsx";
import { CodeEditor, getEditorColors, type EditorColors } from "./CodeEditor.tsx";
import { validateRef } from "./refValidation.ts";
import { listMembers, removeMember } from "./propagation.ts";

export const PROPAGATOR_TOOL_ID = "propagator";

/**
 * Wraps the currently-selected shapes in a new propagator: creates a
 * propagator shape at the page origin and a `propagator-member` binding to
 * each selected shape, then returns to the select tool.
 */
export function createPropagatorFromSelection(editor: Editor): void {
  const memberIds = editor
    .getSelectedShapeIds()
    .filter((id) => editor.getShape(id)?.type !== PROPAGATOR_SHAPE_TYPE);

  if (memberIds.length === 0) {
    console.warn("[propagator] no shapes selected — select shapes first");
    return;
  }

  const propagatorId = createShapeId();

  editor.run(() => {
    editor.createShape<PropagatorShape>({
      id: propagatorId,
      type: PROPAGATOR_SHAPE_TYPE,
      x: 0,
      y: 0,
      parentId: editor.getCurrentPageId(),
      props: { target: "", transform: DEFAULT_TRANSFORM },
    });

    for (const memberId of memberIds) {
      editor.createBinding({
        type: PROPAGATOR_MEMBER_BINDING_TYPE,
        fromId: propagatorId,
        toId: memberId,
        props: {},
      });
    }
    // Keep the filled hull behind its members so they stay clickable; clicking
    // the empty hull interior selects the propagator.
    editor.sendToBack([propagatorId]);
  });

  console.log("[propagator] created propagator", propagatorId, "with members", memberIds);
  editor.select(propagatorId);
}

// ---------------------------------------------------------------------------
// StateNode tool — acts immediately on activation, using the live selection
// ---------------------------------------------------------------------------

export class PropagatorTool extends StateNode {
  static override id = PROPAGATOR_TOOL_ID;

  override onEnter() {
    createPropagatorFromSelection(this.editor);
    this.editor.setCurrentTool("select");
  }
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

export const propagatorUiOverrides: TLUiOverrides = {
  tools(editor: Editor, tools: TLUiToolsContextType) {
    tools[PROPAGATOR_TOOL_ID] = {
      id: PROPAGATOR_TOOL_ID,
      icon: "share-1",
      label: "Propagator",
      kbd: "p",
      onSelect() {
        editor.setCurrentTool(PROPAGATOR_TOOL_ID);
      },
    };
    return tools;
  },
};

/** Toolbar with the propagator added as a normal icon item alongside the rest. */
export function PropagatorToolbar() {
  const tools = useTools();
  const tool = tools[PROPAGATOR_TOOL_ID];
  const isSelected = useIsToolSelected(tool);
  return (
    <DefaultToolbar>
      <DefaultToolbarContent />
      {tool && <TldrawUiMenuItem {...tool} isSelected={isSelected} />}
    </DefaultToolbar>
  );
}

// ---------------------------------------------------------------------------
// Style panel — when a propagator is selected, the standard style panel (the
// one that otherwise just shows opacity for our shape) hosts the target ref
// and transform editors. Wired via Tldraw `components.StylePanel`.
// ---------------------------------------------------------------------------

interface PropInfo {
  id: PropagatorShape["id"];
  target: string;
  transform: string;
}

export function PropagatorStylePanel(props: TLUiStylePanelProps) {
  const editor = useEditor();
  const dark = useValue("propagator-dark", () => editor.user.getIsDarkMode(), [
    editor,
  ]);
  const info = useValue(
    "propagator-style",
    (): PropInfo | null => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const shape = editor.getShape(ids[0]);
      if (!shape || shape.type !== PROPAGATOR_SHAPE_TYPE) return null;
      const prop = shape as PropagatorShape;
      return { id: prop.id, target: prop.props.target, transform: prop.props.transform };
    },
    [editor]
  );

  // For a selected propagator, render our own self-themed panel container
  // (scoped width, solid background so the fields aren't free-floating).
  // Everything else falls through to the standard style panel.
  if (info) {
    const c = getEditorColors(dark);
    return (
      <div
        className="tlui-style-panel"
        style={{
          width: 320,
          maxWidth: "calc(100vw - 32px)",
          pointerEvents: "all",
          background: c.panelBg,
          color: c.text,
          border: `1px solid ${c.border}`,
          borderRadius: "var(--radius-4, 12px)",
          boxShadow: "var(--shadow-2, 0 1px 3px rgba(0,0,0,0.3))",
          overflow: "hidden",
        }}
      >
        <PropagatorFields key={info.id} info={info} dark={dark} />
      </div>
    );
  }

  return (
    <DefaultStylePanel {...props}>
      <DefaultStylePanelContent />
    </DefaultStylePanel>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  borderStyle: "solid",
  borderWidth: 1.5,
  borderRadius: "var(--radius-2, 6px)",
  font: "12px var(--tl-font-sans, system-ui, sans-serif)",
  outline: "none",
};

function PropagatorFields({ info, dark }: { info: PropInfo; dark: boolean }) {
  const editor = useEditor();
  const c = getEditorColors(dark);
  const [target, setTarget] = useState(info.target);
  const [transform, setTransform] = useState(info.transform);
  const members = useValue(
    "propagator-members",
    () => listMembers(editor, info.id),
    [editor, info.id]
  );

  const validity = validateRef(target);
  // Convey validity entirely through the input border (red = invalid,
  // accent = valid, neutral = empty), with a tooltip on the invalid state.
  const borderColor =
    validity === "invalid"
      ? c.danger
      : validity === "valid"
        ? c.accent
        : c.border;

  const commit = (props: Partial<PropagatorShape["props"]>) => {
    editor.updateShape<PropagatorShape>({
      id: info.id,
      type: PROPAGATOR_SHAPE_TYPE,
      props,
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 12,
        font: "500 12px var(--tl-font-sans, system-ui, sans-serif)",
        color: c.text,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ ...fieldLabelStyle, color: c.muted }}>Target ref</label>
        <input
          value={target}
          placeholder="automerge:…/path"
          spellCheck={false}
          title={validity === "invalid" ? "Not a valid automerge URL" : undefined}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={() => commit({ target: target.trim() })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          style={{
            ...fieldInputStyle,
            background: c.fieldBg,
            color: c.text,
            borderColor,
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ ...fieldLabelStyle, color: c.muted }}>
          Members ({members.length})
        </label>
        {members.length === 0 ? (
          <div style={{ fontSize: 12, color: c.muted }}>
            Drop shapes into the hull to add.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {members.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "3px 4px 3px 8px",
                  borderRadius: "var(--radius-2, 6px)",
                  background: c.fieldBg,
                  border: `1px solid ${c.border}`,
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 12,
                    color: c.text,
                  }}
                >
                  {m.label}
                </span>
                <RemoveButton
                  colors={c}
                  onClick={() => removeMember(editor, info.id, m.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ ...fieldLabelStyle, color: c.muted }}>Transform</label>
        <CodeEditor
          value={transform}
          dark={dark}
          onChange={setTransform}
          onBlur={() => commit({ transform })}
        />
      </div>
    </div>
  );
}

function RemoveButton({
  colors,
  onClick,
}: {
  colors: EditorColors;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      title="Remove from propagator"
      style={{
        flexShrink: 0,
        width: 20,
        height: 20,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: "var(--radius-1, 4px)",
        background: hover ? colors.danger : "transparent",
        color: hover ? "#fff" : colors.muted,
        cursor: "pointer",
        fontSize: 14,
        lineHeight: 1,
      }}
    >
      ×
    </button>
  );
}

// ---------------------------------------------------------------------------
// Context menu — "Remove from propagator" on a member shape.
// ---------------------------------------------------------------------------

export function PropagatorContextMenu(props: TLUiContextMenuProps) {
  const editor = useEditor();
  const member = useValue(
    "propagator-context-member",
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const memberId = ids[0];
      const bindings = editor.getBindingsToShape(
        memberId,
        PROPAGATOR_MEMBER_BINDING_TYPE
      );
      if (bindings.length === 0) return null;
      return { memberId, propIds: bindings.map((b) => b.fromId) };
    },
    [editor]
  );

  return (
    <DefaultContextMenu {...props}>
      {member && (
        <TldrawUiMenuItem
          id="propagator-remove-member"
          label="Remove from propagator"
          icon="cross-2"
          readonlyOk
          onSelect={() => {
            for (const propId of member.propIds) {
              removeMember(editor, propId, member.memberId);
            }
          }}
        />
      )}
      <DefaultContextMenuContent />
    </DefaultContextMenu>
  );
}
