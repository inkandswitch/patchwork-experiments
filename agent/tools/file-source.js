/**
 * Filing a kept source somewhere a person will find it.
 *
 * Every fetch already keeps what it fetched, so "keep this" needs no tool of
 * its own; "put it in my folder" or "put this wasm module in the package" does.
 * That used to be a `folder` argument on two different fetch tools, which meant
 * deciding where a thing belongs before seeing it, and two ways of doing one
 * thing. Now it is one step that composes with any kept source.
 *
 * The link is pinned to the source's heads. A kept source is never changed by
 * the agent, but it is an ordinary document a person may edit, and the folder
 * should go on holding what was fetched.
 */

import { FILES_GROUP } from "./folders.js"
import { treeNode, treeEntries, treeLink } from "../documents/tree.js"
import { openDocument } from "./read-source.js"

export const sourceFile = {
  id: "source_file",
  present: { verb: "file", detail: (i) => i.name ?? "kept source" },
  ...FILES_GROUP,
  name: "File a kept source",
  target: { fields: ["folder"] },
  description: [
    "Put a kept source — a page, PDF or file that web_fetch or http_request kept, or a web snapshot web_capture kept — into a folder, so the person finds it there or a package can use it. The link is pinned to the version that was fetched.",
    "",
    "For a file a package needs (a wasm module, an image, a font): fetch it with http_request, then file it into the package folder under the name its code imports.",
  ].join("\n"),
  where: "worker",
  risk: "write",
  input_schema: {
    type: "object",
    required: ["source", "folder"],
    properties: {
      source: { type: "string", description: "The automerge: URL of the kept source, as the fetch result gave it." },
      folder: { type: "string", description: "The automerge: URL of the folder to file it in." },
      name: { type: "string", description: "The name it gets in the folder. Defaults to the kept source's own name." },
    },
  },

  async execute(input, ctx) {
    const sourceHandle = await openDocument(input.source, ctx.repo)
    const kept = sourceHandle.doc()
    if (!kept?.source) throw new Error(`${input.source} is not a kept source. Only what a fetch kept is filed this way; fs_write writes anything else.`)

    const folder = await ctx.repo.find(input.folder)
    const node = treeNode(folder)
    if (!node) throw new Error(`${input.folder} is not a folder document.`)
    const folderDoc = folder.doc()

    const name = String(input.name ?? "").trim() || kept.name || kept.title || "source"
    const url = sourceHandle.view(sourceHandle.heads()).url
    const title = folderDoc.title ?? input.folder
    const existing = treeEntries(node).find((entry) => entry.name === name)
    if (existing?.url === url) return `'${name}' is already filed in ${title}.`
    if (existing) throw new Error(`${title} already has something called '${name}'. Pass a different name.`)

    // Filed as what it is: a web snapshot opens in its own view, a file in the File tool.
    const type = typeof kept["@patchwork"]?.type === "string" ? kept["@patchwork"].type : "file"
    treeLink(node, { name, type, url })
    return `Filed '${name}' in ${title}.`
  },

  summarize(input, output) {
    const filed = String(output ?? "").match(/'([^']+)'/)
    return filed ? `filed ${filed[1]}` : "filed"
  },
}

export default [sourceFile]
