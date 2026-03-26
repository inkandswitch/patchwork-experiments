// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

async function createDoc(repo, content) {
  const handle = repo.create();
  handle.change((d) => {
    d['@patchwork'] = { type: 'markdown' };
    d.content = content;
  });
  return handle.url;
}

async function readDocContent(repo, url) {
  if (!url) return '';
  const handle = await repo.find(url);
  const doc = await handle.doc();
  return doc?.content ?? '';
}

async function getNetDoc(repo, netUrl) {
  const handle = await repo.find(netUrl);
  const doc = await handle.doc();
  if (!doc) throw new Error('Net document not found');
  return { handle, doc };
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function createNet(repo) {
  const handle = repo.create();
  handle.change((d) => {
    d['@patchwork'] = { type: 'llm-petrinet' };
    d.tokens = { problems: [], optimizer_idle: [], optimizer_running: [], solutions: [], evaluator_idle: [], evaluator_running: [] };
  });
  return handle.url;
}

// ─── Writers ──────────────────────────────────────────────────────────────────

export async function setOptimizerSystemPrompt(repo, netUrl, promptText) {
  const url = await createDoc(repo, promptText);
  const { handle } = await getNetDoc(repo, netUrl);
  handle.change((d) => {
    if (!d.systemPromptUrls) d.systemPromptUrls = {};
    d.systemPromptUrls.optimizer = url;
  });
  return url;
}

export async function setEvaluatorSystemPrompt(repo, netUrl, promptText) {
  const url = await createDoc(repo, promptText);
  const { handle } = await getNetDoc(repo, netUrl);
  handle.change((d) => {
    if (!d.systemPromptUrls) d.systemPromptUrls = {};
    d.systemPromptUrls.evaluator = url;
  });
  return url;
}

export async function addOptimizer(repo, netUrl, promptText) {
  const url = await createDoc(repo, promptText);
  const { handle } = await getNetDoc(repo, netUrl);
  handle.change((d) => {
    if (!d.tokens.optimizer_idle) d.tokens.optimizer_idle = [];
    d.tokens.optimizer_idle.push({ id: makeId(), state: { type: 'optimizer', documentUrl: url } });
  });
  return url;
}

export async function addEvaluator(repo, netUrl, criteriaText) {
  const url = await createDoc(repo, criteriaText);
  const { handle } = await getNetDoc(repo, netUrl);
  handle.change((d) => {
    if (!d.tokens.evaluator_idle) d.tokens.evaluator_idle = [];
    d.tokens.evaluator_idle.push({ id: makeId(), state: { type: 'evaluator', documentUrl: url } });
  });
  return url;
}

export async function addProblem(repo, netUrl, docUrl) {
  const { handle } = await getNetDoc(repo, netUrl);
  handle.change((d) => {
    if (!d.tokens.problems) d.tokens.problems = [];
    d.tokens.problems.push({ id: makeId(), state: { type: 'problem', documentUrl: docUrl } });
  });
}

// ─── Readers ──────────────────────────────────────────────────────────────────

export async function getOptimizerSystemPrompt(repo, netUrl) {
  const { doc } = await getNetDoc(repo, netUrl);
  return readDocContent(repo, doc.systemPromptUrls?.optimizer);
}

export async function getEvaluatorSystemPrompt(repo, netUrl) {
  const { doc } = await getNetDoc(repo, netUrl);
  return readDocContent(repo, doc.systemPromptUrls?.evaluator);
}

export async function getOptimizers(repo, netUrl) {
  const { doc } = await getNetDoc(repo, netUrl);
  const tokens = doc.tokens?.optimizer_idle ?? [];
  return Promise.all(tokens.map(async (t) => ({
    id: t.id,
    prompt: await readDocContent(repo, t.state.documentUrl),
  })));
}

export async function getEvaluators(repo, netUrl) {
  const { doc } = await getNetDoc(repo, netUrl);
  const tokens = doc.tokens?.evaluator_idle ?? [];
  return Promise.all(tokens.map(async (t) => ({
    id: t.id,
    prompt: await readDocContent(repo, t.state.documentUrl),
  })));
}

export async function getProblems(repo, netUrl) {
  const { doc } = await getNetDoc(repo, netUrl);
  const tokens = doc.tokens?.problems ?? [];
  return tokens.map((t) => ({ id: t.id, docUrl: t.state.documentUrl }));
}
