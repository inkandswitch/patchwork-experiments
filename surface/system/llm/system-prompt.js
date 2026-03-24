const PROMPT_PREFIX = `You are a coding agent that can execute JavaScript to accomplish tasks in the Paper environment.

The chat uses the OpenRouter API (OpenAI-compatible \`/v1/chat/completions\`). Model IDs follow OpenRouter’s format (e.g. \`openai/gpt-4o-mini\`, \`anthropic/claude-3.5-sonnet\`).

Execute code by writing it inside <script> tags with a data-description attribute:

<script data-description="Brief description of what this code does">
// your code here
</script>

Rules:
- Before writing other code, read the bundled documentation using \`await readDoc('user-guide.md')\` and \`await readDoc('builder-guide.md')\`. Paths are always single filenames under docs/.
- Write one <script> block per iteration; wait for its output before continuing.
- Use \`return\` to inspect values and \`console.log\` for intermediate output.
- Use \`element.ref\` to read or change the frame document (shapes, selectedTool, etc.). \`element\` is the outermost ancestor \`ref-view\` (the frame), not the LLM panel’s host; scripts run in a \`with\` scope that supplies \`element\`, \`readDoc\`, \`repo\`, and \`console\`.
- If something is misconfigured or unclear, say so explicitly instead of guessing.
`;

/**
 * @param {{ readFile: (path: string) => Promise<string>, listEntries?: (path?: string) => Promise<{ name: string, type?: string }[]> }} filesystem
 */
export async function buildSystemPrompt(filesystem) {
  const systemRoot = await detectSystemRoot(filesystem);
  const rootReadme = await filesystem.readFile(joinPath(systemRoot, 'README.md'));
  const skillBodies = await collectSkillBodies(filesystem, systemRoot);
  const readmeBlock = rootReadme.trim() ? `${rootReadme.trim()}\n` : '';
  const skillsBlock = skillBodies.length > 0 ? skillBodies.join('\n') + '\n' : '';
  return `${PROMPT_PREFIX}${readmeBlock}${skillsBlock}`;
}

/**
 * @param {{ readFile: (path: string) => Promise<string> }} filesystem
 */
async function detectSystemRoot(filesystem) {
  const candidates = ['surface/system', 'system', ''];
  for (const root of candidates) {
    try {
      await filesystem.readFile(joinPath(root, 'README.md'));
      return root;
    } catch {
      // try next candidate
    }
  }
  throw new Error('Could not locate system README.md (tried surface/system, system, and repo root)');
}

function joinPath(...parts) {
  return parts
    .flatMap((p) => String(p).split('/'))
    .filter((s) => s.length > 0)
    .join('/');
}

/**
 * @param {{ readFile: (path: string) => Promise<string>, listEntries?: (path?: string) => Promise<{ name: string, type?: string }[]> }} filesystem
 * @param {string} systemRoot
 */
async function collectSkillBodies(filesystem, systemRoot) {
  if (typeof filesystem.listEntries !== 'function') {
    return [];
  }
  const skillsDir = joinPath(systemRoot, 'skills');
  let links;
  try {
    links = await filesystem.listEntries(skillsDir);
  } catch {
    return [];
  }
  const bodies = [];
  for (const link of links) {
    if (link.type !== 'folder') continue;
    const skillPath = joinPath(skillsDir, link.name, 'SKILL.md');
    let raw;
    try {
      raw = await filesystem.readFile(skillPath);
    } catch {
      continue;
    }
    const { body } = parseFrontMatter(raw);
    if (body.trim()) {
      bodies.push(body.trim());
    }
  }
  return bodies;
}

/**
 * @param {string} markdown
 */
function parseFrontMatter(markdown) {
  const text = String(markdown);
  if (!text.startsWith('---')) {
    return { front: {}, body: text };
  }
  const nl = text.indexOf('\n');
  if (nl === -1) return { front: {}, body: text };
  const rest = text.slice(nl + 1);
  const end = rest.indexOf('\n---');
  if (end === -1) return { front: {}, body: text };
  const raw = rest.slice(0, end);
  let body = rest.slice(end + 4);
  if (body.startsWith('\r')) body = body.slice(1);
  if (body.startsWith('\n')) body = body.slice(1);
  /** @type {Record<string, string>} */
  const front = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    front[match[1]] = value;
  }
  return { front, body };
}
