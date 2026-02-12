import { getHeads } from "@automerge/automerge";
import { type AutomergeUrl, encodeHeads, parseAutomergeUrl, stringifyAutomergeUrl } from "@automerge/automerge-repo";
import { useDocHandle, useRepo } from "@automerge/automerge-repo-react-hooks";
import { useCallback, useState } from "react";
import { createShapeId, useEditor } from "tldraw";
import type { ToolSketchDoc } from "../datatype.ts";
import { createFolder } from "./folder.ts";
import { generateToolFromCapture } from "./generate-tool-prompt.ts";

export interface TurnIntoToolCapture {
  imageUrl: string;
  embeds: { docUrl: AutomergeUrl; dataType: string; toolId: string }[];
}

const EMBED_TYPE = "patchwork-embed";

export function TurnIntoTool({ docUrl }: { docUrl: AutomergeUrl }) {
  const editor = useEditor();
  const repo = useRepo();
  const tldrawDocHandle = useDocHandle<ToolSketchDoc>(docUrl);
  const [generating, setGenerating] = useState(false);

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

    // ── 1. Capture: screenshot + collect embed info ──────────────
    const embeds: TurnIntoToolCapture["embeds"] = [];
    for (const id of selectedShapeIds) {
      const shape = editor.getShape(id);
      if (shape && shape.type === EMBED_TYPE) {
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

    const { url: imageUrl } = await editor.toImageDataUrl(selectedShapeIds, {
      format: "png",
      background: true,
      padding: 16,
    });

    const capture: TurnIntoToolCapture = { imageUrl, embeds };

    // ── 2. Create placeholder embed to the right of the selection ─
    const placeholderShapeId = createShapeId();
    const gap = 40;
    editor.createShape({
      id: placeholderShapeId,
      type: EMBED_TYPE,
      x: bounds.maxX + gap,
      y: bounds.y,
      props: {
        w: 400,
        h: 300,
        placeholder: true,
      },
    });

    // ── 3. Generate tool via LLM ─────────────────────────────────
    setGenerating(true);
    let result;
    try {
      result = await generateToolFromCapture(capture);
    } catch (err) {
      console.error("Failed to generate tool:", err);
      // Remove the placeholder on failure
      editor.deleteShape(placeholderShapeId);
      setGenerating(false);
      return;
    }

    const { id: toolId, name, code, example } = result;
    const datatypeId = toolId;
    const toolToolId = `${toolId}-tool`;

    // ── 4. Create folder with package.json + main.js ─────────────
    const folder = createFolder(repo, name);

    const packageJson = JSON.stringify(
      {
        name: `@patchwork/generated-${toolId}`,
        version: "0.0.1",
        type: "module",
        main: "main.js",
        exports: { ".": "main.js" },
      },
      null,
      2
    );

    await folder.write("package.json", packageJson, {
      extension: "json",
      mimeType: "application/json",
    });

    await folder.write("main.js", code, {
      extension: "js",
      mimeType: "application/javascript",
    });

    folder.flush();

    // Compute the folder URL pinned to current heads
    const folderDoc = folder.handle.doc();
    if (!folderDoc) {
      console.error("Folder document not ready after flush");
      setGenerating(false);
      return;
    }
    const { documentId: folderDocId } = parseAutomergeUrl(folder.handle.url);
    const folderUrlWithHeads = stringifyAutomergeUrl({
      documentId: folderDocId,
      heads: encodeHeads(getHeads(folderDoc)),
    });

    // ── 5. Create example document ───────────────────────────────
    const exampleHandle = repo.create<Record<string, unknown>>();
    exampleHandle.change((doc: Record<string, unknown>) => {
      // Set patchwork metadata so the platform recognizes the type
      (doc as any)["@patchwork"] = { type: datatypeId };
      // Apply the example fields
      for (const [key, value] of Object.entries(example)) {
        doc[key] = value;
      }
    });

    // ── 6. Update the placeholder embed ──────────────────────────
    editor.updateShape({
      id: placeholderShapeId,
      type: EMBED_TYPE,
      props: {
        docUrl: exampleHandle.url,
        toolId: toolToolId,
        type: datatypeId,
        placeholder: false,
      },
    });

    // ── 7. Track the folder URL on the TLDrawDoc ─────────────────
    // this will trigger a load of the module in the tool-sketch tool
    tldrawDocHandle?.change((d) => {
      if (!d.moduleFolders) d.moduleFolders = [];
      d.moduleFolders.push(folder.handle.url);
    });

    setGenerating(false);
    console.log(`Tool "${name}" generated successfully. Folder: ${folderUrlWithHeads}`);
  }, [editor, repo, tldrawDocHandle]);

  return (
    <div className="p-2">
      <button className="pointer-events-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-base font-semibold cursor-pointer bg-blue-600 text-white border-0 disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleClick} disabled={generating}>
        {generating ? "Generating..." : "Make Tool"}
      </button>
    </div>
  );
}
