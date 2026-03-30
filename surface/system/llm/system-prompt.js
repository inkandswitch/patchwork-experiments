/**
 * @param {{ readFile: (path: string) => Promise<string>, listEntries?: (path?: string) => Promise<{ name: string, type?: string }[]> }} filesystem
 */
export async function buildSystemPrompt(filesystem) {
  const systemRoot = await detectSystemRoot(filesystem);
  const guideDir = joinPath(systemRoot, 'guide');
  const promptText = await filesystem.readFile(joinPath(guideDir, 'README.md'));
  const skillIndex = await collectSkillIndex(filesystem, guideDir);
  const sections = [promptText.trim()];
  if (skillIndex.length > 0) {
    const listing = skillIndex
      .map((s) => `- **${s.name}** — ${s.description} — \`${s.path}\``)
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
      const entries = await filesystem.listEntries(joinPath(root, 'guide'));
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
 * @param {string} guideDir
 * @returns {Promise<{ name: string, description: string, path: string }[]>}
 */
async function collectSkillIndex(filesystem, guideDir) {
  if (typeof filesystem.listEntries !== 'function') {
    return [];
  }
  let links;
  try {
    links = await filesystem.listEntries(guideDir);
  } catch {
    return [];
  }
  const index = [];
  for (const link of links) {
    if (link.type !== 'folder') continue;
    const skillPath = joinPath(guideDir, link.name, 'SKILL.md');
    try {
      const raw = await filesystem.readFile(skillPath);
      const { front } = parseFrontMatter(raw);
      const name = front.name || link.name;
      const description = front.description || '';
      index.push({ name, description, path: skillPath });
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
