import type * as nbformat from "@jupyterlab/nbformat"
import { MimeModel, RenderMimeRegistry, standardRendererFactories } from "@jupyterlab/rendermime"
import type { IRenderMime } from "@jupyterlab/rendermime-interfaces"
import { marked } from "marked"

/**
 * JupyterLab's renderers for output and markdown, outside JupyterLab. The
 * notebook is a shared document anyone with access can write outputs into,
 * so nothing is trusted: HTML is sanitized and JavaScript never runs.
 */
export function createRenderMime(): RenderMimeRegistry {
  return new RenderMimeRegistry({
    initialFactories: standardRendererFactories,
    markdownParser: { render: async source => marked.parse(source, { async: false, gfm: true }) as string },
  })
}

/** The mime bundle an output shows, as JupyterLab's OutputModel builds it. */
export function outputBundle(output: nbformat.IOutput): nbformat.IMimeBundle {
  switch (output.output_type) {
    case "stream": {
      const stream = output as nbformat.IStream
      return { [stream.name === "stderr" ? "application/vnd.jupyter.stderr" : "application/vnd.jupyter.stdout"]: joined(stream.text) }
    }
    case "error":
      return { "application/vnd.jupyter.stderr": (output.traceback as string[] | undefined)?.join("\n") ?? `${output.ename}: ${output.evalue}` }
    case "display_data":
    case "execute_result":
      return Object.fromEntries(Object.entries(output.data ?? {}).map(([type, value]) => [type, Array.isArray(value) ? value.join("") : value])) as nbformat.IMimeBundle
    default:
      return {}
  }
}

/**
 * Renders a mime bundle into `host`, replacing what was there. Resolves
 * with a function that disposes the renderer.
 */
export async function renderBundle(
  rendermime: RenderMimeRegistry,
  host: HTMLElement,
  bundle: nbformat.IMimeBundle,
  metadata: Record<string, unknown> = {},
): Promise<() => void> {
  const mimeType = rendermime.preferredMimeType(bundle as any, "ensure")
  host.replaceChildren()
  if (!mimeType) {
    host.textContent = `No renderer for ${Object.keys(bundle).join(", ") || "this output"}`
    host.className = "pwnb-output-unrenderable"
    return () => {}
  }
  const renderer = rendermime.createRenderer(mimeType)
  const model = new MimeModel({ data: bundle as IRenderMime.IMimeModel["data"], metadata: metadata as any, trusted: false })
  await renderer.renderModel(model)
  host.append(renderer.node)
  return () => renderer.dispose()
}

function joined(text: nbformat.MultilineString | undefined): string {
  return Array.isArray(text) ? text.join("") : (text ?? "")
}
