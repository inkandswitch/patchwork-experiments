import { onCleanup, createEffect } from "solid-js";

/** CodeMirror */
import { EditorView, type DecorationSet } from "@codemirror/view";
import { EditorState, type Extension, Compartment } from "@codemirror/state";

/** Automerge */
import type { Prop as AutomergeProp } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import {
  createSyncExtension,
  createReadOnlyExtension,
  createDecorationsExtension,
} from "./extensions";

/** Utility function to lookup a value along the specified path in an Automerge document */
const lookup = <T = unknown,>(
  doc: Record<string, unknown>,
  path: AutomergeProp[]
): T | undefined => {
  let current: unknown = doc;
  for (const key of path) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[key];
  }
  return current as T | undefined;
};

type CodeMirrorProps<T> = {
  handle: DocHandle<T>;
  path: AutomergeProp[];
  decorations: () => DecorationSet;
  extensions?: Extension[];
  onChangeSelection: (from: number, to: number) => void;
  readOnly?: boolean;
  withView?(view: EditorView): void;
};

export function CodeMirror<T>(props: CodeMirrorProps<T>) {
  const initialDoc = () =>
    (props.handle && (lookup(props.handle.doc(), props.path) as string)) || "";

  const [syncExtension, createEffectReconfigureSync] = createSyncExtension(
    () => props.handle,
    () => props.path,
    initialDoc
  );

  const [readOnlyExtension, createEffectReconfigureReadOnly] =
    createReadOnlyExtension(() => !!props.readOnly);

  const [decorationsExtension, createEffectReconfigureDecorations] =
    createDecorationsExtension(() => props.decorations?.());

  // Create a compartment for user-provided extensions so they can be reconfigured
  const userExtensionsCompartment = new Compartment();

  const selectionExtension = EditorView.updateListener.of((update) => {
    if (!props.onChangeSelection) return;
    // Bubble all updates to consumers (doc changes, viewport, scroll, etc.)
    if (update.selectionSet) {
      const sel = update.state.selection.main;
      props.onChangeSelection(sel.from, sel.to);
    }
  });

  const extensions = [
    selectionExtension,
    decorationsExtension,
    userExtensionsCompartment.of(props.extensions || []),
    syncExtension,
    readOnlyExtension,
  ].filter(Boolean) as Extension[];

  const state = EditorState.create({
    doc: initialDoc(),
    extensions,
  });

  const view = new EditorView({
    state,
  });

  props.withView?.(view);

  // Create effects to reconfigure the extensions when their props change
  createEffectReconfigureSync(view);
  createEffectReconfigureReadOnly(view);
  createEffectReconfigureDecorations?.(view);

  // Reconfigure user extensions when props.extensions changes
  createEffect(() => {
    view.dispatch({
      effects: userExtensionsCompartment.reconfigure(props.extensions || []),
    });
  });

  onCleanup(() => view.destroy());

  return view.dom;
}
