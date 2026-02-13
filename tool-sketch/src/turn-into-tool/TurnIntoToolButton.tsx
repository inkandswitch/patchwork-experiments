import { getHeads } from "@automerge/automerge";
import { type AutomergeUrl, encodeHeads, parseAutomergeUrl, stringifyAutomergeUrl } from "@automerge/automerge-repo";
import { useDocHandle, useRepo } from "@automerge/automerge-repo-react-hooks";
import { createDocOfDatatype2, getRegistry, type DatatypeDescription, type LoadedDatatype } from "@inkandswitch/patchwork-plugins";
import { useCallback } from "react";
import { type Box, type Editor, createShapeId, useEditor } from "tldraw";
import type { ToolSketchDoc } from "../datatype.ts";
import { createFolder } from "./folder.ts";
import { generateToolFromCapture } from "./generate-tool-prompt.ts";

export interface TurnIntoToolCapture {
  imageUrl: string;
  embeds: { docUrl: AutomergeUrl; dataType: string; toolId: string }[];
}

const EMBED_TYPE = "patchwork-embed";
const EMBED_WIDTH = 400;
const EMBED_HEIGHT = 300;

function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function findPlacementPosition(editor: Editor, selectionBounds: Box, embedWidth: number, embedHeight: number, gap: number): { x: number; y: number } {
  const allShapes = editor.getCurrentPageShapes();
  const candidateX = selectionBounds.maxX + gap;
  let candidateY = selectionBounds.y;

  for (let attempts = 0; attempts < 50; attempts++) {
    const hasOverlap = allShapes.some((shape) => {
      const shapeBounds = editor.getShapePageBounds(shape.id);
      if (!shapeBounds) return false;
      return rectsOverlap(candidateX, candidateY, embedWidth, embedHeight, shapeBounds.x, shapeBounds.y, shapeBounds.w, shapeBounds.h);
    });
    if (!hasOverlap) break;
    candidateY += embedHeight + 20;
  }

  return { x: candidateX, y: candidateY };
}

export function TurnIntoTool({ docUrl }: { docUrl: AutomergeUrl }) {
  const editor = useEditor();
  const repo = useRepo();
  const tldrawDocHandle = useDocHandle<ToolSketchDoc>(docUrl);
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
    const gap = 80;
    const placement = findPlacementPosition(editor, bounds, EMBED_WIDTH, EMBED_HEIGHT, gap);
    editor.createShape({
      id: placeholderShapeId,
      type: EMBED_TYPE,
      x: placement.x,
      y: placement.y,
      props: {
        w: EMBED_WIDTH,
        h: EMBED_HEIGHT,
        placeholder: true,
      },
    });

    // ── 2b. Create arrow from embed to selection ─────────────────
    const arrowId = createShapeId();
    const selectionRightCenter = {
      x: bounds.maxX,
      y: bounds.y + bounds.h / 2,
    };

    editor.createShape({
      id: arrowId,
      type: "arrow",
      x: selectionRightCenter.x,
      y: selectionRightCenter.y,
      props: {
        color: "grey",
        start: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
      },
    });

    editor.createBinding({
      fromId: arrowId,
      toId: placeholderShapeId,
      type: "arrow",
      props: {
        terminal: "start",
        normalizedAnchor: { x: 0, y: 0.5 },
        isExact: false,
        isPrecise: true,
      },
    });

    // ── 3. Generate tool via LLM ─────────────────────────────────
    const idSuffix = crypto.randomUUID().split("-")[0];
    let result;
    try {
      result = await generateToolFromCapture(capture, idSuffix);
    } catch (err) {
      console.error("Failed to generate tool:", err);
      // Remove the placeholder and arrow on failure
      editor.deleteShapes([placeholderShapeId, arrowId]);
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
      return;
    }
    const { documentId: folderDocId } = parseAutomergeUrl(folder.handle.url);
    const folderUrlWithHeads = stringifyAutomergeUrl({
      documentId: folderDocId,
      heads: encodeHeads(getHeads(folderDoc)),
    });

    // ── 5. Load module so the datatype is registered ───────────────
    const patchworkView = document.createElement("patchwork-view") as any;
    await patchworkView.moduleWatcher.loadModules([folder.handle.url]);

    const datatype = (await getRegistry<DatatypeDescription>("patchwork:datatype").load(datatypeId)) as LoadedDatatype | undefined;
    if (!datatype) {
      console.error(`Datatype "${datatypeId}" not found after loading module`);
      editor.deleteShapes([placeholderShapeId, arrowId]);
      return;
    }

    // ── 6. Create example document via datatype API ──────────────
    const exampleHandle = await createDocOfDatatype2(datatype, repo, (doc: any) => {
      // Apply the example fields on top of the init() defaults
      Object.assign(doc, example);
    });

    // ── 7. Update the placeholder embed ──────────────────────────
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

    // ── 8. Track the folder URL on the TLDrawDoc ─────────────────
    // this will trigger a load of the module in the tool-sketch tool
    tldrawDocHandle?.change((d) => {
      if (!d.moduleFolders) d.moduleFolders = [];
      d.moduleFolders.push(folder.handle.url);
    });

    console.log(`Tool "${name}" generated successfully. Folder: ${folderUrlWithHeads}`);
  }, [editor, repo, tldrawDocHandle]);

  return (
    <div className="p-2">
      <button className="pointer-events-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-base font-semibold cursor-pointer bg-blue-600 text-white border-0" onClick={handleClick}>
        Make Tool
      </button>
    </div>
  );
}
