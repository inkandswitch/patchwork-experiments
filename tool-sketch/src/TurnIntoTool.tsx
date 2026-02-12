import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useEditor } from "tldraw";
import { useCallback } from "react";

export interface TurnIntoToolCapture {
  imageUrl: string;
  embeds: { docUrl: AutomergeUrl; dataType: string; toolId: string }[];
}

export function TurnIntoTool({ onCapture }: { onCapture?: (capture: TurnIntoToolCapture) => void }) {
  const editor = useEditor();

  const handleClick = useCallback(async () => {
    const selectedShapeIds = editor.getSelectedShapeIds();
    if (selectedShapeIds.length === 0) {
      console.warn("No shapes selected");
      return;
    }

    const bounds = editor.getSelectionPageBounds();
    if (!bounds) {
      console.warn("Could not get selection bounds");
      return;
    }

    // Collect embed shapes from the selection
    const embeds: TurnIntoToolCapture["embeds"] = [];
    for (const id of selectedShapeIds) {
      const shape = editor.getShape(id);
      if (shape && shape.type === "patchwork-embed") {
        const props = shape.props as {
          docUrl?: string;
          toolId?: string;
          type?: string;
        };
        if (props.docUrl) {
          embeds.push({
            docUrl: props.docUrl as AutomergeUrl,
            dataType: props.type ?? "",
            toolId: props.toolId ?? "",
          });
        }
      }
    }

    // Take a screenshot of the selection
    const { url } = await editor.toImageDataUrl(selectedShapeIds, {
      format: "png",
      background: true,
      padding: 16,
    });

    const capture: TurnIntoToolCapture = { imageUrl: url, embeds };

    if (onCapture) {
      onCapture(capture);
    }
  }, [editor, onCapture]);

  return (
    <button
      className="tlui-share-zone__button"
      style={{
        pointerEvents: "all",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 16px",
        borderRadius: "8px",
        fontSize: "14px",
        fontWeight: 600,
        cursor: "pointer",
        background: "#2563eb",
        color: "white",
        border: "none",
      }}
      onClick={handleClick}
    >
      Turn into Tool
    </button>
  );
}
