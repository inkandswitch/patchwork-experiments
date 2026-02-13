import { getHeads } from "@automerge/automerge";
import { type AutomergeUrl, encodeHeads, parseAutomergeUrl, stringifyAutomergeUrl } from "@automerge/automerge-repo";
import { useDocHandle, useRepo } from "@automerge/automerge-repo-react-hooks";
import { createDocOfDatatype2, getRegistry, type DatatypeDescription, type LoadedDatatype } from "@inkandswitch/patchwork-plugins";
import { useCallback, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { type Box, type Editor, type TLShapeId, createShapeId, toRichText, useEditor } from "tldraw";
import type { FolderDoc, HasPatchworkMetadata } from "@inkandswitch/patchwork-filesystem";
import type { ToolSketchDoc } from "../datatype.ts";
import { createFolder, openFolder } from "./folder.ts";
import { generateToolFromCapture } from "./generate-tool-prompt.ts";
import { getPromptConfig } from "./prompts";

const MAX_SOURCE_LENGTH = 12_000;

export interface TurnIntoToolCapture {
  imageUrl: string;
  embeds: { docUrl: AutomergeUrl; dataType: string; toolId: string; sourceCode?: string; docContent?: string }[];
}

const EMBED_TYPE = "patchwork-embed";
const EMBED_WIDTH = 400;
const EMBED_HEIGHT = 300;

const AVAILABLE_MODELS = [
  { id: "openai/gpt-5.2", label: "GPT-5.2" },
  { id: "openai/gpt-5-nano", label: "GPT-5 Nano" },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { id: "openai/gpt-5.2-codex", label: "GPT-5.2 Codex" },
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6" },
  { id: "anthropic/claude-opus-4.5", label: "Claude Opus 4.5" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
] as const;

const DEFAULT_MODEL = "openai/gpt-5.2-codex";

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

/** Short display name from a model id like "openai/gpt-5.2-codex" → "GPT-5.2 Codex" */
function modelLabel(modelId: string): string {
  const entry = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (entry) return entry.label;
  // Fallback: take part after "/"
  const slash = modelId.indexOf("/");
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

export function TurnIntoTool({ docUrl }: { docUrl: AutomergeUrl }) {
  const editor = useEditor();
  const repo = useRepo();
  const tldrawDocHandle = useDocHandle<ToolSketchDoc>(docUrl);

  const [selectedModels, setSelectedModels] = useState<string[]>([DEFAULT_MODEL]);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);

  // Close the panel when clicking outside
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target) && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setExpanded(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [expanded]);

  // Position the dropdown relative to the button
  useEffect(() => {
    if (!expanded || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [expanded]);

  const toggleModel = useCallback((modelId: string) => {
    setSelectedModels((prev) => {
      if (prev.includes(modelId)) {
        // Don't allow deselecting the last model
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== modelId);
      }
      return [...prev, modelId];
    });
  }, []);

  const handleClick = useCallback(async () => {
    const models = selectedModels.length > 0 ? selectedModels : [DEFAULT_MODEL];
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

    // ── 1a. Try to load document content + source code for each embed ──
    for (const embed of embeds) {
      try {
        const docHandle = await repo.find<HasPatchworkMetadata>(embed.docUrl);
        const doc = docHandle.doc();
        if (!doc) continue;

        // Serialize document content (strip @patchwork metadata)
        const { "@patchwork": _, ...docData } = doc as Record<string, unknown>;
        const docJson = JSON.stringify(docData, null, 2);
        if (docJson.length <= MAX_SOURCE_LENGTH) {
          embed.docContent = docJson;
        }

        // Try to load tool source code from suggestedImportUrl
        const importUrl = doc["@patchwork"]?.suggestedImportUrl;
        if (!importUrl) continue;

        const folderHandle = await repo.find<FolderDoc>(importUrl as AutomergeUrl);
        const folder = openFolder(folderHandle, repo);
        const entries = folder.ls();

        // Only proceed if folder has exactly package.json + one source file
        const fileEntries = entries.filter((e) => e.type === "file");
        if (fileEntries.length !== 2) continue;
        const mainEntry = fileEntries.find((e) => e.name !== "package.json");
        if (!mainEntry) continue;

        const content = await folder.read(mainEntry.name);
        const source = typeof content === "string" ? content : new TextDecoder().decode(content);
        if (source.length <= MAX_SOURCE_LENGTH) {
          embed.sourceCode = source;
        }
      } catch (err) {
        // Non-fatal — just skip extra context for this embed
        console.warn(`Could not load context for embed ${embed.docUrl}:`, err);
      }
    }

    const { url: imageUrl } = await editor.toImageDataUrl(selectedShapeIds, {
      format: "png",
      background: true,
      padding: 16,
    });

    const capture: TurnIntoToolCapture = { imageUrl, embeds };

    // ── 1b. Select prompt config based on embed types ────────────
    const promptConfig = getPromptConfig(capture);
    if (!promptConfig) {
      console.warn("Mixed embed types in selection — not yet supported. Aborting.");
      return;
    }

    const multipleModels = models.length > 1;

    // ── 2. Create one placeholder per model ──────────────────────
    const gap = 80;
    const verticalGap = 40; // gap between stacked placeholders (+ label)
    const labelHeight = multipleModels ? 24 : 0;
    const slotHeight = EMBED_HEIGHT + labelHeight + verticalGap;

    interface Slot {
      model: string;
      placeholderId: TLShapeId;
      arrowId: TLShapeId;
      labelId?: TLShapeId;
    }
    const slots: Slot[] = [];

    const basePos = findPlacementPosition(editor, bounds, EMBED_WIDTH, EMBED_HEIGHT, gap);

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const placeholderId = createShapeId();
      const arrowId = createShapeId();
      const yOffset = i * slotHeight;

      // Model label above the embed (only when multiple models)
      let labelId: TLShapeId | undefined;
      const embedY = basePos.y + yOffset + (multipleModels ? labelHeight + 4 : 0);

      if (multipleModels) {
        labelId = createShapeId();
        editor.createShape({
          id: labelId,
          type: "text",
          x: basePos.x,
          y: basePos.y + yOffset,
          opacity: 0.5,
          props: {
            richText: toRichText(modelLabel(model)),
            color: "grey",
            size: "s",
          },
        });
      }

      editor.createShape({
        id: placeholderId,
        type: EMBED_TYPE,
        x: basePos.x,
        y: embedY,
        props: {
          w: EMBED_WIDTH,
          h: EMBED_HEIGHT,
          placeholder: true,
        },
      });

      // Dashed connector from selection to placeholder
      editor.createShape({
        id: arrowId,
        type: "arrow",
        x: bounds.maxX,
        y: bounds.y + bounds.h / 2,
        props: {
          color: "grey",
          dash: "dashed",
          arrowheadStart: "none",
          arrowheadEnd: "none",
          start: { x: 0, y: 0 },
          end: { x: 0, y: 0 },
        },
      });

      editor.createBinding({
        fromId: arrowId,
        toId: placeholderId,
        type: "arrow",
        props: {
          terminal: "start",
          normalizedAnchor: { x: 0, y: 0.5 },
          isExact: false,
          isPrecise: true,
        },
      });

      slots.push({ model, placeholderId, arrowId, labelId });
    }

    // ── 3. Generate tools via LLM (in parallel) ─────────────────
    const results = await Promise.allSettled(
      slots.map(async (slot) => {
        const idSuffix = crypto.randomUUID().split("-")[0];
        const result = await generateToolFromCapture(capture, idSuffix, promptConfig, slot.model);
        return { slot, result, idSuffix };
      })
    );

    // ── 4. Process each result ──────────────────────────────────
    for (const settled of results) {
      if (settled.status === "rejected") {
        console.error("Failed to generate tool:", settled.reason);
        continue;
      }

      const { slot, result } = settled.value;
      const { id: generatedId, name, code } = result;

      try {
        // ── 4a. Create folder with package.json + main.js ─────────
        const folder = createFolder(repo, name);

        const packageJson = JSON.stringify(
          {
            name: `@patchwork/generated-${generatedId}`,
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

        const folderDoc = folder.handle.doc();
        if (!folderDoc) {
          console.error("Folder document not ready after flush");
          continue;
        }
        const { documentId: folderDocId } = parseAutomergeUrl(folder.handle.url);
        const folderUrlWithHeads = stringifyAutomergeUrl({
          documentId: folderDocId,
          heads: encodeHeads(getHeads(folderDoc)),
        });

        if (result.mode === "extend") {
          // ── 4-extend. Reuse existing document ────────────────────
          const matchedEmbed = capture.embeds.find(
            (e) => e.docUrl === result.docUrl
          );
          const embedDataType = matchedEmbed?.dataType ?? "";

          // Optionally load the module globally
          if (promptConfig.loadGlobally) {
            const patchworkView = document.createElement("patchwork-view") as any;
            await patchworkView.moduleWatcher.loadModules([folder.handle.url]);
          }

          editor.updateShape({
            id: slot.placeholderId,
            type: EMBED_TYPE,
            props: {
              docUrl: result.docUrl ?? undefined,
              toolId: result.toolId ?? undefined,
              type: embedDataType,
              extensionModuleUrl: folder.handle.url,
              placeholder: false,
            },
          });

          console.log(`Extension "${name}" (${slot.model}) generated in extend mode. Folder: ${folderUrlWithHeads}`);
        } else {
          // ── 4-create. Current flow: new datatype + tool + doc ────
          const datatypeId = generatedId;
          const toolToolId = `${generatedId}-tool`;

          const patchworkView = document.createElement("patchwork-view") as any;
          await patchworkView.moduleWatcher.loadModules([folder.handle.url]);

          const datatype = (await getRegistry<DatatypeDescription>("patchwork:datatype").load(datatypeId)) as LoadedDatatype | undefined;
          if (!datatype) {
            console.error(`Datatype "${datatypeId}" not found after loading module`);
            const shapesToDelete = [slot.placeholderId, slot.arrowId];
            if (slot.labelId) shapesToDelete.push(slot.labelId);
            editor.deleteShapes(shapesToDelete);
            continue;
          }

          const exampleHandle = await createDocOfDatatype2(datatype, repo, (doc: any) => {
            if (result.example) {
              Object.assign(doc, result.example);
            }
          });

          editor.updateShape({
            id: slot.placeholderId,
            type: EMBED_TYPE,
            props: {
              docUrl: exampleHandle.url,
              toolId: toolToolId,
              type: datatypeId,
              placeholder: false,
            },
          });

          console.log(`Tool "${name}" (${slot.model}) generated in create mode. Folder: ${folderUrlWithHeads}`);
        }

        // ── Track the folder URL on the TLDrawDoc ─────────────────
        tldrawDocHandle?.change((d) => {
          if (!d.moduleFolders) d.moduleFolders = [];
          d.moduleFolders.push(folder.handle.url);
        });
      } catch (err) {
        console.error(`Failed to set up tool for model ${slot.model}:`, err);
        const shapesToDelete = [slot.placeholderId, slot.arrowId];
        if (slot.labelId) shapesToDelete.push(slot.labelId);
        editor.deleteShapes(shapesToDelete);
      }
    }

    // Clean up slots for rejected promises (we can identify them as placeholders still marked as placeholder)
    for (const settled of results) {
      if (settled.status === "rejected") {
        // Find any remaining placeholder shapes and remove them
        // Since we can't easily map rejected to slots, check all slots
        for (const slot of slots) {
          const shape = editor.getShape(slot.placeholderId);
          if (shape && (shape.props as any)?.placeholder) {
            const shapesToDelete: TLShapeId[] = [slot.placeholderId, slot.arrowId];
            if (slot.labelId) shapesToDelete.push(slot.labelId);
            editor.deleteShapes(shapesToDelete);
          }
        }
        break; // Only need to do the cleanup scan once
      }
    }
  }, [editor, repo, tldrawDocHandle, selectedModels]);

  return (
    <div className="p-2" ref={panelRef} style={{ order: 99 }}>
      <div className="pointer-events-auto flex items-stretch" ref={buttonRef}>
        <button className="flex items-center gap-1.5 px-4 py-1.5 rounded-l-lg text-base font-semibold cursor-pointer bg-blue-600 text-white border-0" onClick={handleClick}>
          Make Tool
        </button>
        <button className="flex items-center px-2 py-1.5 rounded-r-lg text-base font-semibold cursor-pointer bg-blue-700 text-white border-0 border-l border-l-blue-500" onClick={() => setExpanded((v) => !v)} title="Select models">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {expanded &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="pointer-events-auto bg-white border border-gray-200 rounded-lg shadow-xl py-2 min-w-[280px]"
            style={{
              position: "fixed",
              top: dropdownPos.top,
              right: dropdownPos.right,
              zIndex: 100000,
            }}
          >
            <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Models</div>
            {AVAILABLE_MODELS.map((model) => (
              <label key={model.id} className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                <input type="checkbox" checked={selectedModels.includes(model.id)} onChange={() => toggleModel(model.id)} className="accent-blue-600 w-4 h-4" />
                <span className="font-medium">{model.label}</span>
                <span className="text-xs text-gray-400 ml-auto">{model.id.split("/")[0]}</span>
              </label>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
