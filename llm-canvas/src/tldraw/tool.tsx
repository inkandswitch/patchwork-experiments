import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useDocHandle, useDocument, useRepo } from "@automerge/react";
import { Tldraw, useEditor, getMediaAssetInfoPartial, createShapeId, type VecLike, type TLContent, type TLAssetId, type TLAsset } from "@tldraw/tldraw";
import { useAutomergeStore, useAutomergePresence } from "./automerge/useAutomergeStore.ts";
import type { TLDrawDoc } from "./datatype.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UnixFileEntry } from "@inkandswitch/patchwork-filesystem";
import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import {
  EmbedShapeUtil, EmbedShapeTool, embedUiOverrides, EmbedToolbar, setEmbedToolContext,
  getDefaultToolId, loadDatatype,
  DocTokenShapeUtil, ToolTokenShapeUtil,
  DOC_TOKEN_SHAPE_TYPE, TOOL_TOKEN_SHAPE_TYPE,
  getTokenDragData,
} from "./EmbedShape/index.ts";
import { EMBED_SHAPE_TYPE } from "./EmbedShape/EmbedShapeUtil.tsx";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function extensionForMimeType(mimeType: string): string {
  return MIME_TO_EXT[mimeType] || mimeType.split("/")[1] || "bin";
}

interface ContactDoc {
  type: string;
  name?: string;
  color?: string;
}

function useContactInfo() {
  const [contactUrl, setContactUrl] = useState<AutomergeUrl | undefined>();

  useEffect(() => {
    const accountDocHandle = (window as any).accountDocHandle as DocHandle<{ contactUrl: AutomergeUrl }> | undefined;
    if (!accountDocHandle) return;
    accountDocHandle.whenReady().then(() => {
      const doc = accountDocHandle.doc();
      if (doc?.contactUrl) {
        setContactUrl(doc.contactUrl);
      }
    });
  }, []);

  const [contactDoc] = useDocument<ContactDoc>(contactUrl);

  return {
    userId: contactUrl ?? (window as any).repo?.peerId ?? "anonymous",
    name: contactDoc?.name ?? "Anonymous",
    color: contactDoc?.color,
  };
}

const VERSION = "0.0.3";

function VersionBadge() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "58px",
        left: "8px",
        fontSize: "10px",
        color: "var(--color-text-3, #aaa)",
        fontFamily: "monospace",
        pointerEvents: "none",
        userSelect: "none",
        zIndex: 1,
      }}
    >
      v{VERSION}
    </div>
  );
}

export function TldrawTool({ docUrl, element }: { docUrl: AutomergeUrl; element: ToolElement }) {
  useEffect(() => {
    console.log("[llm-canvas] version", VERSION);
  }, []);
  const handle = useDocHandle<TLDrawDoc>(docUrl, { suspense: true });
  const contactInfo = useContactInfo();
  const store = useAutomergeStore({
    handle,
    userId: contactInfo.userId,
    shapeUtils: [EmbedShapeUtil, DocTokenShapeUtil, ToolTokenShapeUtil],
  });

  useAutomergePresence({
    handle: handle as DocHandle<any>,
    store,
    userMetadata: contactInfo,
  });

  return (
    <Tldraw
      inferDarkMode
      autoFocus
      store={store}
      shapeUtils={[EmbedShapeUtil, DocTokenShapeUtil, ToolTokenShapeUtil]}
      tools={[EmbedShapeTool]}
      overrides={embedUiOverrides}
      components={{ Toolbar: EmbedToolbar, InFrontOfTheCanvas: VersionBadge }}
    >
      <TldrawInner docUrl={docUrl} element={element} />
    </Tldraw>
  );
}

function TldrawInner(props: { docUrl: AutomergeUrl; element: ToolElement }) {
  const key = useMemo(() => `${props.docUrl}-camera`, [props.docUrl]);
  const editor = useEditor();

  useEffect(() => {
    setEmbedToolContext(props.element, editor);
  }, [props.element, editor]);

  useEditorSetup(key);
  usePatchworkDrop();

  return null;
}

function useEditorSetup(key: string) {
  const editor = useEditor();
  const repo = useRepo();

  const onChange = useCallback(() => {
    if (!editor) return;
    const camstate = editor.getCameraState();
    if (camstate == "moving") {
      localStorage.setItem(key, JSON.stringify(editor.getCamera()));
    }
  }, []);

  useEffect(() => {
    if (!editor) return;

    // Handle pasted/dropped files (images, videos) by storing them as
    // UnixFileEntry automerge docs and referencing them via service-worker URLs.
    editor.registerExternalAssetHandler("file", async ({ file, assetId }) => {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");

      const id = assetId ?? (`asset:${crypto.randomUUID()}` as TLAssetId);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = extensionForMimeType(file.type);
      const name = file.name && file.name !== "image.png" ? file.name : `Pasted image on ${new Date().toLocaleDateString()}.${ext}`;

      const fileHandle = repo.create<UnixFileEntry>();
      fileHandle.change((doc) => {
        doc.content = bytes;
        doc.extension = ext;
        doc.mimeType = file.type;
        doc.name = name;
      });

      const asset = await getMediaAssetInfoPartial(file, id, isImage, isVideo);
      asset.props.src = automergeUrlToServiceWorkerUrl(fileHandle.url);
      return asset as TLAsset;
    });

    // Override the tldraw paste handler to avoid "could not migrate content"
    // errors when pasting from newer tldraw versions (e.g. tldraw.com may
    // run a canary build whose schema sequence versions are ahead of ours).
    editor.registerExternalContentHandler("tldraw", ({ point, content }: { point?: VecLike; content: TLContent }) => {
      editor.run(() => {
        const selectionBoundsBefore = editor.getSelectionPageBounds();
        editor.markHistoryStoppingPoint("paste");

        for (const shape of content.shapes) {
          if (content.rootShapeIds.includes(shape.id)) {
            shape.isLocked = false;
          }
        }

        // Replace the pasted content's schema with ours so that
        // migrateStoreSnapshot sees matching versions and skips migration
        // rather than failing on unknown future sequence versions.
        content.schema = editor.store.schema.serialize();

        editor.putContentOntoCurrentPage(content, { point, select: true });

        const selectedBoundsAfter = editor.getSelectionPageBounds();
        if (selectionBoundsBefore && selectedBoundsAfter && selectionBoundsBefore.collides(selectedBoundsAfter)) {
          editor.updateInstanceState({ isChangingStyle: true });
        }
      });
    });

    const existing = localStorage.getItem(key);
    if (existing) {
      try {
        editor.setCamera(JSON.parse(existing));
      } catch {
        localStorage.removeItem(key);
      }
    }
    editor.on("change", onChange);
    return () => void editor.off("change", onChange);
  }, [editor]);
}

function usePatchworkDrop() {
  const editor = useEditor();
  const repo = useRepo();

  useEffect(() => {
    const container = editor.getContainer();

    const isPatchworkDrop = (e: DragEvent) =>
      e.dataTransfer?.types.includes("text/x-patchwork-urls") ?? false;

    const handleDragEnter = (e: DragEvent) => {
      if (isPatchworkDrop(e)) e.preventDefault();
    };

    const handleDragOver = (e: DragEvent) => {
      if (isPatchworkDrop(e)) e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      const raw = e.dataTransfer?.getData("text/x-patchwork-urls");
      if (!raw) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      let urls: string[];
      try {
        urls = JSON.parse(raw);
      } catch {
        console.warn("[patchwork-drop] failed to parse URLs:", raw);
        return;
      }

      // Check if this is a token drag
      const tokenData = e.dataTransfer ? getTokenDragData(e.dataTransfer) : null;

      const dropPoint = editor.screenToPage({ x: e.clientX, y: e.clientY });
      const STAGGER = 20;

      for (let i = 0; i < urls.length; i++) {
        const docUrl = urls[i] as AutomergeUrl;
        const x = dropPoint.x + i * STAGGER;
        const y = dropPoint.y + i * STAGGER;

        if (tokenData) {
          // --- Token drop ---
          if (tokenData.type === "document") {
            editor.createShape({
              id: createShapeId(),
              type: DOC_TOKEN_SHAPE_TYPE,
              x,
              y,
              rotation: 0,
              parentId: editor.getCurrentPageId(),
              props: { docUrl, name: tokenData.name },
            } as any);
          } else {
            editor.createShape({
              id: createShapeId(),
              type: TOOL_TOKEN_SHAPE_TYPE,
              x,
              y,
              rotation: 0,
              parentId: editor.getCurrentPageId(),
              props: { docUrl, name: tokenData.name, path: tokenData.path ?? "" },
            } as any);
          }
        } else {
          // --- Embed drop (existing behaviour) ---
          const shapeId = createShapeId();
          editor.createShape({
            id: shapeId,
            type: EMBED_SHAPE_TYPE,
            x,
            y,
            rotation: 0,
            parentId: editor.getCurrentPageId(),
            props: {
              w: 640,
              h: 480,
              docUrl,
              docName: "Loading\u2026",
              docType: "",
              toolId: "",
            },
          } as any);

          (async () => {
            try {
              const handle = await repo.find(docUrl);
              const doc = handle.doc() as any;
              const datatypeId: string = doc?.["@patchwork"]?.type ?? "";
              const [datatype, toolId] = await Promise.all([
                datatypeId ? loadDatatype(datatypeId) : Promise.resolve(undefined),
                Promise.resolve(datatypeId ? getDefaultToolId(datatypeId) : ""),
              ]);
              const docName: string = (datatype as any)?.name ?? datatypeId ?? docUrl;

              if (editor.getShape(shapeId)) {
                editor.updateShape({
                  id: shapeId,
                  type: EMBED_SHAPE_TYPE,
                  props: { docUrl, docName, docType: datatypeId, toolId },
                } as any);
              }
            } catch (err) {
              console.error("[patchwork-drop] failed to resolve embed:", err);
              if (editor.getShape(shapeId)) {
                editor.updateShape({
                  id: shapeId,
                  type: EMBED_SHAPE_TYPE,
                  props: { docName: "Error" },
                } as any);
              }
            }
          })();
        }
      }
    };

    container.addEventListener("dragenter", handleDragEnter, { capture: true });
    container.addEventListener("dragover", handleDragOver, { capture: true });
    container.addEventListener("drop", handleDrop, { capture: true });
    return () => {
      container.removeEventListener("dragenter", handleDragEnter, { capture: true });
      container.removeEventListener("dragover", handleDragOver, { capture: true });
      container.removeEventListener("drop", handleDrop, { capture: true });
    };
  }, [editor, repo]);
}
