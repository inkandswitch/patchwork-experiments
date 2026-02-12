import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useDocHandle } from "@automerge/automerge-repo-react-hooks";
import { Tldraw, useEditor } from "tldraw";
import { useAutomergeStore } from "./automerge-tldraw/useAutomergeStore.ts";
import type { TLDrawDoc } from "./datatype.ts";
import { EmbedShapeUtil } from "./embed/EmbedShapeUtil.tsx";
import { EmbedShapeTool } from "./embed/EmbedShapeTool.tsx";
import { components, uiOverrides } from "./ui-overrides.tsx";
import { useCallback, useEffect, useMemo } from "react";

const shapeUtils = [EmbedShapeUtil];
const tools = [EmbedShapeTool];

export function TldrawTool({ docUrl }: { docUrl: AutomergeUrl }) {
  const handle = useDocHandle<TLDrawDoc>(docUrl, { suspense: true });
  const userId = "chee";
  const store = useAutomergeStore({
    handle,
    userId,
    shapeUtils,
  });

  return (
    <Tldraw inferDarkMode autoFocus store={store} shapeUtils={shapeUtils} tools={tools} overrides={uiOverrides} components={components} licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}>
      <TldrawInner docUrl={docUrl} />
    </Tldraw>
  );
}

function TldrawInner(props: { docUrl: AutomergeUrl }) {
  const key = useMemo(() => `${props.docUrl}-camera`, [props.docUrl]);

  const editor = useEditor();
  const onChange = useCallback(() => {
    if (!editor) return;
    const camstate = editor.getCameraState();
    if (camstate == "moving") {
      // todo debounce?
      localStorage.setItem(key, JSON.stringify(editor.getCamera()));
    }
  }, [editor, key]);

  useEffect(() => {
    if (!editor) return;
    const existing = localStorage.getItem(key);
    if (existing) {
      try {
        const cam = JSON.parse(existing);
        editor.setCamera(cam);
      } catch {
        localStorage.removeItem(key);
      }
    }
    editor.on("change", onChange);
    return () => void editor.off("change", onChange);
  }, [editor, key, onChange]);
  return null;
}
