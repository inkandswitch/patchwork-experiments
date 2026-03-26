import type { Ref } from '@automerge/automerge-repo';
import { createDocumentProjection, useDocHandle } from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { getRegistry, getSupportedToolsForType } from '@inkandswitch/patchwork-plugins';
import { ChevronDown } from 'lucide-solid';
import { type Accessor, createResource, createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { z } from 'zod';
import { openMenu } from './menu.js';
import type { HasPatchworkMetadata } from '@inkandswitch/patchwork-filesystem';
import './embed.css';

export const schema = z.object({
  type: z.literal('embed'),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  zIndex: z.number(),
  docUrl: z.string().optional(),
  docType: z.string().optional(),
  toolId: z.string().optional(),
  toolUrl: z.string().optional(),
  width: z.number(),
  height: z.number(),
});

export type EmbedShape = z.infer<typeof schema>;

// ─── Entry point ──────────────────────────────────────────────────────────────

export default function embedRefTool(ref: Ref<EmbedShape>, element: HTMLElement): () => void {
  return render(() => <EmbedView embedRef={ref} />, element);
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

function EmbedView(props: { embedRef: Ref<EmbedShape> }) {
  const [shape, setShape] = createSignal<EmbedShape | undefined>(
    props.embedRef.value() as EmbedShape | undefined,
  );

  onCleanup(props.embedRef.onChange((value) => setShape(value as EmbedShape | undefined)));

  const { title, docType } = useDocMetadata(
    () => shape()?.docUrl,
    () => shape()?.docType,
  );

  const usingToolUrl = () => !!shape()?.toolUrl;

  const tools = () => {
    if (usingToolUrl()) return [];
    const dt = docType();
    if (!dt) return [];
    return getSupportedToolsForType(dt).filter((t) => !(t as any).unlisted);
  };

  const effectiveToolId = () => {
    const s = shape();
    if (!s || usingToolUrl()) return '';
    if (s.toolId) return s.toolId;
    const tls = tools();
    const concrete = tls.find((t) => {
      const sd = (t as any).supportedDatatypes;
      return Array.isArray(sd) && !sd.includes('*');
    });
    return concrete?.id ?? tls[0]?.id ?? '';
  };

  const activeToolName = () => {
    const active = effectiveToolId();
    return tools().find((t) => t.id === active)?.name ?? '';
  };

  function handleToolBtnClick(e: MouseEvent) {
    e.stopPropagation();
    const tls = tools();
    if (tls.length === 0) return;
    const docUrl = shape()?.docUrl;
    openMenu(
      e.currentTarget as HTMLElement,
      tls.map((t) => ({
        id: t.id,
        name: t.name,
        dragData: docUrl ? JSON.stringify([`${docUrl}?tool=${t.id}`]) : undefined,
      })),
      (toolId) =>
        props.embedRef.change((s) => {
          (s as EmbedShape).toolId = toolId;
        }),
    );
  }

  function handleClose(e: MouseEvent) {
    e.stopPropagation();
    props.embedRef.remove();
  }

  return (
    <>
      {shape() && (
        shape()!.docUrl
          ? (
            <div
              class="embed-card"
              style={{ width: `${shape()!.width}px`, height: `${shape()!.height}px` }}
            >
              <div class="embed-header">
                <span class="embed-title">{title()}</span>
                {!usingToolUrl() && tools().length > 0 && (
                  <button
                    class="embed-tool-btn"
                    onClick={handleToolBtnClick}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span class="embed-tool-btn-label">{activeToolName()}</span>
                    <ChevronDown size={10} />
                  </button>
                )}
                <button
                  class="embed-close-btn"
                  onClick={handleClose}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Close"
                >
                  ×
                </button>
              </div>
              <div class="embed-content" onPointerDown={(e) => e.stopPropagation()}>
                {usingToolUrl()
                  ? (
                    <patchwork-view-with-tool-url
                      attr:doc-url={shape()!.docUrl}
                      attr:tool-url={shape()!.toolUrl}
                      style="display:block;width:100%;height:100%;"
                    />
                  )
                  : (
                    <patchwork-view
                      attr:doc-url={shape()!.docUrl}
                      attr:tool-id={effectiveToolId() || undefined}
                      style="display:block;width:100%;height:100%;"
                    />
                  )}
              </div>
            </div>
          )
          : (
            <div
              class="embed-pending"
              style={{ width: `${shape()!.width}px`, height: `${shape()!.height}px` }}
            />
          )
      )}
    </>
  );
}

// ─── useDocMetadata ───────────────────────────────────────────────────────────

function useDocMetadata(
  docUrl: Accessor<string | undefined>,
  knownDocType: Accessor<string | undefined>,
): { title: Accessor<string>; docType: Accessor<string> } {
  const handle = useDocHandle<any>(() => docUrl() as any, { repo: (window as any).repo });
  const doc = createDocumentProjection<HasPatchworkMetadata>(handle);

  const docType = () => knownDocType() ?? (doc() as any)?.['@patchwork']?.type ?? '';

  const [datatype] = createResource(docType, (dt) =>
    dt ? getRegistry('patchwork:datatype').load(dt) : Promise.resolve(null),
  );

  const title = () => {
    const d = doc();
    if (!d) return 'Untitled';
    return datatype()?.module?.getTitle?.(d) || 'Untitled';
  };

  return { title, docType };
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:ref-tool' as const,
    id: 'paper-embed',
    name: 'Embed',
    schema,
    async load() {
      return embedRefTool;
    },
  },
];
