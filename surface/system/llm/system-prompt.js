const PROMPT_PREFIX = `You are a coding agent that can execute JavaScript to accomplish tasks in the Paper environment.

Execute code by writing it inside <script> tags with a data-description attribute:

<script data-description="Brief description of what this code does">
// your code here
</script>

Scripts run in a \`with\` scope that supplies \`element\`, \`repo\`, and \`console\`. \`element\` is the outermost ancestor \`ref-view\` (the frame), not the LLM panel's host.

Rules:
1. MUST READ SKILLS: Before writing other code, read the relevant skill docs from the list below. You MUST \`await\` and print the result to read it:
   console.log(await element.filesystem.readFile('skills/paper/SKILL.md'));

2. NO IMPLICIT RETURNS: Your code runs in an async function. If you don't use \`return\` or \`console.log\`, you will see NO output. Always return or log the data you want to inspect.

3. ONE STEP AT A TIME: Write exactly one <script> block per iteration. Wait for its output before writing more code.

4. READING STATE: Read the document state using \`element.ref.value()\`. This returns a plain JS snapshot. DO NOT try to read \`element.ref.shapes\` directly.
   console.log(element.ref.value().shapes);

5. WRITING STATE: Mutate document state using \`element.ref.at(...).change(...)\`. DO NOT mutate the snapshot directly. DO NOT guess APIs.
   element.ref.at('shapes', 'my_id').change(() => ({ x: 0, y: 0, toolUrl: '...' }));

6. FILESYSTEM API: Use \`element.filesystem\` to manage files. Available methods (all async): \`readFile(path)\`, \`writeFile(path, content)\`, \`listEntries(path)\`, \`createFolder(path)\`.

7. NO GUESSING: If something is misconfigured, undefined, or unclear, stop and say so explicitly instead of guessing APIs.
`;

/**
 * @param {{ readFile: (path: string) => Promise<string>, listEntries?: (path?: string) => Promise<{ name: string, type?: string }[]> }} filesystem
 */
export async function buildSystemPrompt(filesystem) {
  const systemRoot = await detectSystemRoot(filesystem);
  const skillIndex = await collectSkillIndex(filesystem, systemRoot);
  const sections = [PROMPT_PREFIX.trim()];
  if (skillIndex.length > 0) {
    const listing = skillIndex
      .map((s) => `- **${s.name}** \u2014 \`${s.path}\``)
      .join('\n');
    sections.push(`## Available skills\n\nRead any skill before acting on it.\n\n${listing}`);
  }
  return sections.join('\n\n---\n\n') + '\n';
}

/**
 * @param {{ listEntries?: (path?: string) => Promise<{ name: string, type?: string }[]> }} filesystem
 */
async function detectSystemRoot(filesystem) {
  if (typeof filesystem.listEntries !== 'function') return '';
  const candidates = ['surface/system', 'system', ''];
  for (const root of candidates) {
    try {
      const entries = await filesystem.listEntries(joinPath(root, 'skills'));
      if (entries.length > 0) return root;
    } catch {
      // try next candidate
    }
  }
  return '';
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
 * @returns {Promise<{ name: string, path: string }[]>}
 */
async function collectSkillIndex(filesystem, systemRoot) {
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
  const index = [];
  for (const link of links) {
    if (link.type !== 'folder') continue;
    const skillPath = joinPath(skillsDir, link.name, 'SKILL.md');
    try {
      const raw = await filesystem.readFile(skillPath);
      const { front } = parseFrontMatter(raw);
      const name = front.name || link.name;
      index.push({ name, path: skillPath });
    } catch {
      continue;
    }
  }
  return index;
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
