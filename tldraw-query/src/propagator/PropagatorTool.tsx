import {
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

  return (
    <DefaultStylePanel {...props}>
      {info ? (
        <PropagatorFields key={info.id} info={info} />
      ) : (
        <DefaultStylePanelContent />
      )}
    </DefaultStylePanel>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  opacity: 0.6,
};

const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  border: "1px solid var(--color-muted-1, rgba(0,0,0,0.15))",
  borderRadius: "var(--radius-2, 6px)",
  background: "var(--color-background, #fff)",
  color: "var(--color-text-1, inherit)",
  font: "12px var(--tl-font-sans, system-ui, sans-serif)",
};

function PropagatorFields({ info }: { info: PropInfo }) {
  const editor = useEditor();
  const [target, setTarget] = useState(info.target);
  const [transform, setTransform] = useState(info.transform);

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
        color: "var(--color-text-1, #1d1d1d)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={fieldLabelStyle}>Target ref</label>
        <input
          value={target}
          placeholder="automerge:…/path"
          spellCheck={false}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={() => commit({ target: target.trim() })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          style={fieldInputStyle}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={fieldLabelStyle}>Transform</label>
        <textarea
          value={transform}
          spellCheck={false}
          onChange={(e) => setTransform(e.target.value)}
          onBlur={() => commit({ transform })}
          rows={10}
          style={{
            ...fieldInputStyle,
            resize: "vertical",
            font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
            lineHeight: 1.4,
          }}
        />
      </div>
    </div>
  );
}
