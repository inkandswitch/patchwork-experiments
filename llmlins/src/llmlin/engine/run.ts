/**
 * LLMlin run engine.
 *
 * Simplified single-pass worker loop:
 * - Reads skills from readDocUrls (folders with SKILL.md)
 * - Enforces read/write constraints via LLMlinRepo
 * - Streams LLM response, parses <script> blocks, evals them
 * - Calls onOutput for each new or updated OutputBlock
 */

import type { Repo, DocHandle } from '@automerge/automerge-repo'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import type { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem'
import type { LLMlinDoc } from '../types.js'
import type { OutputBlock, ChatMessage } from './types.js'
import { parseScriptBlocks } from './parser.js'
import { createLLMlinRepo } from './workspace-repo.js'
import { resolveDocTitle } from '../../shared/resolve-doc-title.js'

// ============================================================================
// Console capture
// ============================================================================

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  try { return JSON.stringify(arg, null, 2) } catch { return '[object]' }
}

function createCapturedConsole() {
  const output: string[] = []
  return {
    log:   (...args: unknown[]) => { output.push(args.map(stringifyArg).join(' ')) },
    error: (...args: unknown[]) => { output.push('[error] ' + args.map(stringifyArg).join(' ')) },
    warn:  (...args: unknown[]) => { output.push('[warn] '  + args.map(stringifyArg).join(' ')) },
    info:  (...args: unknown[]) => { output.push(args.map(stringifyArg).join(' ')) },
    flush(): string {
      const text = output.join('\n')
      output.length = 0
      return text
    },
  }
}

// ============================================================================
// Skill discovery
// ============================================================================

type SkillInfo = {
  name: string
  description: string
  importUrl: string
  content: string
}

type DiscoverSkillsResult = {
  skills: SkillInfo[]
  sourceUrls: Set<AutomergeUrl>
}

async function discoverSkills(repo: Repo, readUrls: AutomergeUrl[]): Promise<DiscoverSkillsResult> {
  const skills: SkillInfo[] = []
  const sourceUrls = new Set<AutomergeUrl>()

  for (const url of readUrls) {
    try {
      const handle = await repo.find<FolderDoc>(url)
      const doc = handle.doc() as any
      if (!doc?.docs) continue

      // Check if this folder has a SKILL.md — treat it as a single skill
      const skillMd = (doc.docs as DocLink[]).find((d) => d.name === 'SKILL.md')
      if (skillMd) {
        try {
          const mdHandle = await repo.find(skillMd.url)
          const mdDoc = mdHandle.doc() as any
          const content = typeof mdDoc?.content === 'string'
            ? mdDoc.content
            : mdDoc?.content instanceof Uint8Array
              ? new TextDecoder().decode(mdDoc.content)
              : ''

          const frontmatter = parseFrontmatter(content)
          if (!frontmatter.name) continue

          const indexFile = (doc.docs as DocLink[]).find((d) => d.name === 'index.js')
          skills.push({
            name: frontmatter.name,
            description: frontmatter.description ?? '',
            importUrl: indexFile ? `/${url}/${indexFile.name}` : `/${url}`,
            content: stripFrontmatter(content),
          })
          sourceUrls.add(url)
        } catch {
          // skip unreadable SKILL.md
        }
        continue
      }

      // Otherwise check each subfolder for SKILL.md (skills folder containing multiple skills)
      let foundAny = false
      for (const link of doc.docs as DocLink[]) {
        if (link.type !== 'folder') continue
        try {
          const subHandle = await repo.find<FolderDoc>(link.url)
          const subDoc = subHandle.doc() as any
          if (!subDoc?.docs) continue

          const subSkillMd = (subDoc.docs as DocLink[]).find((d) => d.name === 'SKILL.md')
          if (!subSkillMd) continue

          const mdHandle = await repo.find(subSkillMd.url)
          const mdDoc = mdHandle.doc() as any
          const content = typeof mdDoc?.content === 'string'
            ? mdDoc.content
            : mdDoc?.content instanceof Uint8Array
              ? new TextDecoder().decode(mdDoc.content)
              : ''

          const frontmatter = parseFrontmatter(content)
          if (!frontmatter.name) continue

          const indexFile = (subDoc.docs as DocLink[]).find((d) => d.name === 'index.js')
          skills.push({
            name: frontmatter.name,
            description: frontmatter.description ?? '',
            importUrl: indexFile
              ? `/${link.url}/${indexFile.name}`
              : `/${link.url}`,
            content: stripFrontmatter(content),
          })
          foundAny = true
        } catch {
          // skip inaccessible skill folder
        }
      }
      if (foundAny) sourceUrls.add(url)
    } catch {
      // skip inaccessible read doc
    }
  }

  return { skills, sourceUrls }
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key   = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    result[key] = value
  }
  return result
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
}

// ============================================================================
// Message construction
// ============================================================================

type DocEntry = {
  url: AutomergeUrl
  title: string
  type: string
}

type RunContext = {
  skills: SkillInfo[]
  readDocs: DocEntry[]
  writeDocs: DocEntry[]
}

const SYSTEM_PROMPT = `You are a coding agent with access to a document repository and the ability to execute JavaScript.

You can execute code by writing it inside <script> tags. Add a data-description attribute to briefly describe what the code does:

<script data-description="Describe what you're doing">
const handle = await repo.find("automerge:...")
handle.change(doc => { doc.foo = "bar" })
</script>

Available APIs in your execution context:

  repo.find(url)    — find a document by URL (async, returns a handle)
  repo.create()     — create a new empty document

  handle.url        — the document URL
  handle.doc()      — get the current document state
  handle.change(fn) — mutate the document (throws if document is read-only)
  handle.heads()    — get the current heads

  loadSkill(name)   — load a skill module by name
  console.log(...)  — output text (captured and shown to you)
  return value      — return a value from the script (shown to you as output)

After each <script> block you will see the console output, return value, or any errors.
Use this to inspect results and decide your next steps.

Write text outside of script tags to explain your reasoning.
Keep your code concise and focused on the task.`

function formatDocEntry(entry: DocEntry): string {
  const label = [entry.title, entry.type ? `(${entry.type})` : ''].filter(Boolean).join(' ')
  return label ? `${label} — ${entry.url}` : entry.url
}

function buildMessages(
  prompt: string,
  output: OutputBlock[],
  context: RunContext,
): ChatMessage[] {
  const messages: ChatMessage[] = []

  let systemPrompt = SYSTEM_PROMPT

  if (context.skills.length > 0) {
    const skillList = context.skills.map(s => `- ${s.name}: ${s.description}`).join('\n')
    systemPrompt += `\n\n---\nAvailable skills (load with loadSkill(name) to get full documentation and code):\n\n${skillList}`
  }

  if (context.readDocs.length > 0) {
    const entries = context.readDocs.map(formatDocEntry).join('\n\n')
    systemPrompt += `\n\n---\nRead-only documents:\n\n${entries}`
  }

  if (context.writeDocs.length > 0) {
    const entries = context.writeDocs.map(formatDocEntry).join('\n\n')
    systemPrompt += `\n\n---\nWritable documents (use handle.change(fn) to mutate):\n\n${entries}`
  }

  messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })

  if (output.length > 0) {
    let assistantParts: string[] = []
    for (const block of output) {
      if (block.type === 'text') {
        assistantParts.push(block.content)
      } else {
        const tag = block.description
          ? `<script data-description="${block.description}">`
          : `<script>`
        assistantParts.push(`${tag}\n${block.code}\n</script>`)

        if (block.output !== undefined) {
          if (assistantParts.length > 0) {
            messages.push({ role: 'assistant', content: assistantParts.join('\n') })
            assistantParts = []
          }
          const resultText = block.error
            ? `[Error: ${block.error}]`
            : block.output
              ? `[Output: ${block.output}]`
              : '[Done]'
          messages.push({ role: 'user', content: resultText })
        }
      }
    }
    if (assistantParts.length > 0) {
      messages.push({ role: 'assistant', content: assistantParts.join('\n') })
    }
  }

  return messages
}

// ============================================================================
// LLM streaming
// ============================================================================

async function* streamChatCompletion(
  apiUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const url = `${apiUrl.replace(/\/$/, '')}/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`LLM API error (${response.status}): ${text}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') return
      try {
        const parsed = JSON.parse(data)
        const content = parsed.choices?.[0]?.delta?.content
        if (content) yield content
      } catch {
        // skip malformed SSE line
      }
    }
  }
}

// ============================================================================
// Script eval
// ============================================================================

async function evalScript(
  code: string,
  capturedConsole: ReturnType<typeof createCapturedConsole>,
): Promise<{ output?: string; error?: string }> {
  capturedConsole.flush()
  ;(globalThis as any).__llmCapturedConsole = capturedConsole

  try {
    const wrapped = `(async () => { const console = globalThis.__llmCapturedConsole;\n${code}\n})()`
    const returnValue = await eval(wrapped)
    const consoleOutput = capturedConsole.flush()
    const parts: string[] = []
    if (consoleOutput) parts.push(consoleOutput)
    if (returnValue !== undefined) parts.push(stringifyArg(returnValue))
    return parts.length > 0 ? { output: parts.join('\n') } : {}
  } catch (err: any) {
    const consoleOutput = capturedConsole.flush()
    const result: { output?: string; error?: string } = {
      error: err.message ?? String(err),
    }
    if (consoleOutput) result.output = consoleOutput
    return result
  }
}

// ============================================================================
// Shared helpers
// ============================================================================

async function fetchDocEntry(repo: Repo, url: AutomergeUrl): Promise<DocEntry> {
  try {
    const handle = await repo.find(url)
    const title = await resolveDocTitle(handle as DocHandle<Record<string, unknown>>)
    const doc = handle.doc() as any
    const type = (doc?.['@patchwork']?.type as string) ?? ''
    return { url, title, type }
  } catch {
    return { url, title: '', type: '' }
  }
}

async function buildContext(repo: Repo, readDocUrls: AutomergeUrl[], writeDocUrls: AutomergeUrl[]): Promise<RunContext> {
  const { skills, sourceUrls } = await discoverSkills(repo, readDocUrls)
  const plainReadUrls = readDocUrls.filter(u => !sourceUrls.has(u))
  const [readDocs, writeDocs] = await Promise.all([
    Promise.all(plainReadUrls.map(url => fetchDocEntry(repo, url))),
    Promise.all(writeDocUrls.map(url => fetchDocEntry(repo, url))),
  ])
  return { skills, readDocs, writeDocs }
}

export async function buildSystemPromptPreview(repo: Repo, doc: LLMlinDoc): Promise<string> {
  const context = await buildContext(repo, doc.readDocUrls ?? [], doc.writeDocUrls ?? [])
  const messages = buildMessages('', [], context)
  return messages[0]?.content ?? ''
}

// ============================================================================
// Main entry point
// ============================================================================

export type RunLLMlinOptions = {
  /** Called for each incremental output update during the run. */
  onOutput: (blocks: OutputBlock[]) => void
}

/**
 * Run the LLMlin engine for one prompt.
 *
 * @param repo     - Raw Automerge repo
 * @param doc      - Current snapshot of the LLMlinDoc
 * @param signal   - AbortSignal for cancellation
 * @param options  - Callbacks
 */
export async function runLLMlin(
  repo: Repo,
  doc: LLMlinDoc,
  signal?: AbortSignal,
  options?: RunLLMlinOptions,
): Promise<void> {
  const { apiUrl, model, prompt, readDocUrls, writeDocUrls } = doc
  const apiKey = import.meta.env.VITE_LLM_API_KEY ?? ''

  if (!prompt?.trim()) throw new Error('No prompt to run')
  if (!apiUrl)         throw new Error('No API URL configured')

  const llmlinRepo      = createLLMlinRepo(repo, readDocUrls, writeDocUrls)
  const capturedConsole = createCapturedConsole()
  const context         = await buildContext(repo, readDocUrls, writeDocUrls)
  const { skills }      = context

  const loadSkill = async (name: string) => {
    const skill = skills.find(s => s.name === name)
    if (!skill) {
      const available = skills.map(s => s.name).join(', ')
      throw new Error(`Skill not found: "${name}". Available: [${available}]`)
    }
    return import(/* @vite-ignore */ skill.importUrl)
  }

  ;(globalThis as any).repo           = llmlinRepo
  ;(globalThis as any).loadSkill      = loadSkill
  ;(globalThis as any).__llmCapturedConsole = capturedConsole

  const MAX_ITERATIONS = 20
  const output: OutputBlock[] = []

  const emit = () => options?.onOutput([...output])

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) break

    const messages = buildMessages(prompt, output, context)
    const stream = streamChatCompletion(apiUrl, apiKey, model, messages, signal)

    let foundScript = false

    for await (const block of parseScriptBlocks(stream)) {
      if (signal?.aborted) break

      if (block.type === 'text' && block.content.trim().length > 0) {
        const last = output[output.length - 1]
        if (last && last.type === 'text') {
          last.content += block.content
        } else {
          output.push({ type: 'text', content: block.content })
        }
        emit()
      }

      if (block.type === 'script') {
        const last = output[output.length - 1]
        if (last && last.type === 'script' && last.output === undefined) {
          last.code = block.code
        } else {
          output.push({ type: 'script', code: block.code, description: block.description })
        }
        emit()

        if (block.complete) {
          foundScript = true
          const result = await evalScript(block.code, capturedConsole)
          const scriptBlock = output[output.length - 1]
          if (scriptBlock.type === 'script') {
            scriptBlock.output = result.output ?? ''
            if (result.error) scriptBlock.error = result.error
          }
          emit()
          break
        }
      }
    }

    if (!foundScript) break
  }
}
