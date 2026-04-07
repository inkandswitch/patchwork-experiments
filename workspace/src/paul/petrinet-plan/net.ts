import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import { runLLMProcessRaw } from '../../../../llm/src/llm-process';
import { evaluateSolution } from './evaluate';
import type { NetDef, ReadonlyToken, TokenState } from './lib';
import type { CandidateDoc, PetriNetPlanDoc } from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

type FolderDoc = {
  '@patchwork'?: { type: string };
  title?: string;
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

type SpecDoc = {
  spec?: {
    goal?: string;
    subSpecUrls?: string[];
    verificationUrls?: string[];
    filesFolderUrl?: string;
  };
};

// ─── Default prompt content ─────────────────────────────────────────────────

export const DEFAULT_OPTIMIZER_PROMPT = 'TODO: describe the optimizer approach';

// ─── System prompt: script-execution environment ────────────────────────────

export const PETRINET_SYSTEM_PROMPT = [
  'You are a coding agent that can execute JavaScript to accomplish tasks.',
  '',
  'Execute code by writing it inside <script> tags with a data-description attribute:',
  '',
  '<script data-description="Brief description of what this code does">',
  '// your code here',
  '</script>',
  '',
  'Rules:',
  '- Write one <script> block per iteration; wait for its output before continuing.',
  '- Use `return` to inspect values and `console.log` for intermediate output.',
  '',
  'Working with Automerge documents:',
  '- `repo.find(url)` is async — always `await` it',
  '- Read a document with `await handle.doc()`',
  '- Mutate documents with `handle.change()`',
  '',
  'Working with Datalog documents:',
  '- Datalog docs have `facts`, `rules`, and `constraints` arrays',
  '- Facts are `{ pred: string, args: (string|number)[] }`',
  '- Add facts with `handle.change(d => d.facts.push({ pred: "name", args: [...] }))`',
  '- Remove facts by filtering the array',
].join('\n');

// ─── Default optimizer system prompt template ───────────────────────────────

export const DEFAULT_OPTIMIZER_SYSTEM_PROMPT = [
  'Task: $PROMPT',
  '',
  'Specification: $SPEC_URL',
  '',
  'Documents to modify:',
  '$DOC_LIST',
  '',
  'Step 1: Read the specification to understand the goal and constraints.',
  '<script data-description="Read spec">',
  'const specHandle = await repo.find("$SPEC_URL")',
  'const specDoc = await specHandle.doc()',
  'return JSON.stringify(specDoc.spec, null, 2)',
  '</script>',
  '',
  'Step 2: Read any verification docs referenced by the spec.',
  '<script data-description="Read verification rules">',
  'const specHandle = await repo.find("$SPEC_URL")',
  'const specDoc = await specHandle.doc()',
  'const verificationUrls = specDoc.spec?.verificationUrls ?? []',
  'const results = await Promise.all(verificationUrls.map(async url => {',
  '  const h = await repo.find(url)',
  '  const d = await h.doc()',
  '  return { url, title: d.title, constraints: d.constraints, draftText: d.draftText }',
  '}))',
  'return JSON.stringify(results, null, 2)',
  '</script>',
  '',
  'Step 3: Read the current documents and understand their facts.',
  '<script data-description="Read current facts">',
  'const docs = $DOC_URLS',
  'const results = await Promise.all(docs.map(async ({ name, url }) => {',
  '  const h = await repo.find(url)',
  '  const d = await h.doc()',
  '  return { name, url, facts: d.facts ?? [] }',
  '}))',
  'return JSON.stringify(results, null, 2)',
  '</script>',
  '',
  'Step 4: Modify the documents to satisfy the constraints. Add or remove facts as needed.',
  'Example:',
  '<script data-description="Update facts">',
  'const handle = await repo.find("DOC_URL_HERE")',
  'handle.change(d => {',
  '  // Remove a fact by filtering',
  '  d.facts = d.facts.filter(f => !(f.pred === "rule" && f.args[2] === 3))',
  '  // Add a new fact',
  '  d.facts.push({ pred: "rule", args: ["machine_a", "input", 1, "accept", "0.0.0.0/0", "tcp", 80] })',
  '})',
  'return "Updated"',
  '</script>',
].join('\n');

// ─── Net definition ─────────────────────────────────────────────────────────

export function createNet(repo: Repo, planHandle: DocHandle<PetriNetPlanDoc>): NetDef {
  return {
    places: ['spec', 'candidates', 'running'],

    transitions: [
      {
        id: 'decompose',
        from: [],
        readFrom: ['spec', 'candidates', 'running'],
        to: ['running'],

        async guard(_tokens, _allTokens, repo, readTokens) {
          const specToken = readTokens.spec?.[0];
          if (!specToken) return false;
          const candidateTokens = readTokens.candidates ?? [];
          const runningTokens = readTokens.running ?? [];
          const unsolved = await getUnsolvedSubSpecs(repo, specToken, candidateTokens, runningTokens);
          return unsolved.length > 0;
        },

        async onConsumedTokens(_tokens, _allTokens, repo, readTokens) {
          const specToken = readTokens.spec![0];
          const candidateTokens = readTokens.candidates ?? [];
          const runningTokens = readTokens.running ?? [];
          const unsolved = await getUnsolvedSubSpecs(repo, specToken, candidateTokens, runningTokens);

          const doc = await planHandle.doc();
          const systemPromptUrl = doc?.systemPromptUrls?.optimizer;
          const systemTemplate = systemPromptUrl
            ? await readDocContent(repo, systemPromptUrl)
            : DEFAULT_OPTIMIZER_SYSTEM_PROMPT;

          const produce = [];
          for (const subSpecUrl of unsolved) {
            const { folderUrl, docEntries } = await cloneSpecFiles(repo, subSpecUrl);

            const prompt = buildOptimizerPrompt(systemTemplate, DEFAULT_OPTIMIZER_PROMPT, subSpecUrl, docEntries);

            const processHandle = repo.create<Record<string, unknown>>();
            processHandle.change((d) => {
              d['@patchwork'] = { type: 'llm' };
              d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' };
              d.systemPrompt = PETRINET_SYSTEM_PROMPT;
              d.prompt = prompt;
              d.output = [];
            });

            produce.push({
              state: {
                type: 'llm-process',
                documentUrl: processHandle.url as string,
                taskSpecUrl: subSpecUrl,
                taskFolderUrl: folderUrl,
              } as TokenState,
              toPlace: 'running',
            });
          }

          return { produce };
        },

        onProducedToken(token, _handle, repo) {
          if (token.placeId === 'running') {
            runLLMProcessRaw(repo, token.state.documentUrl as unknown as AutomergeUrl)
              .catch((e) => console.error('[petrinet-plan] runLLMProcess error', e));
          }
        },
      },

      {
        id: 'finish',
        from: ['running'],
        to: ['candidates'],

        async guard({ running }, _allTokens, repo) {
          const h = await repo.find(running.state.documentUrl as AutomergeUrl);
          const doc = await h.doc() as { done?: boolean } | null;
          return doc?.done === true;
        },

        async onConsumedTokens({ running }, _allTokens, repo) {
          const taskSpecUrl = (running.state.taskSpecUrl ?? '') as string;
          const taskFolderUrl = (running.state.taskFolderUrl ?? '') as string;

          const candidateHandle = repo.create<CandidateDoc>();
          candidateHandle.change((d) => {
            d['@patchwork'] = { type: 'candidate' };
            d.specUrl = taskSpecUrl;
            d.documentsFolderUrl = taskFolderUrl;
          });

          return {
            produce: [
              {
                state: {
                  type: 'candidate',
                  documentUrl: candidateHandle.url as string,
                } as TokenState,
                toPlace: 'candidates',
              },
            ],
          };
        },
      },
    ],

    tokenTypes: [
      {
        id: 'spec',
        label: 'Spec',
        color: '#059669',
        create: () => ({ type: 'spec', documentUrl: '', specUrl: '' }),
      },
      {
        id: 'candidate',
        label: 'Candidate',
        color: '#7c3aed',
        create: () => ({ type: 'candidate', documentUrl: '' }),
      },
      {
        id: 'llm-process',
        label: 'LLM Process',
        color: '#f59e0b',
        create: () => ({ type: 'llm-process', documentUrl: '' }),
      },
    ],

    getColor(state) {
      if (state.type === 'spec') return '#059669';
      if (state.type === 'candidate') return '#7c3aed';
      if (state.type === 'llm-process') return '#f59e0b';
      return '#6b7280';
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getUnsolvedSubSpecs(
  repo: Repo,
  specToken: ReadonlyToken,
  candidateTokens: ReadonlyToken[],
  runningTokens: ReadonlyToken[],
): Promise<string[]> {
  const specDoc = await readSpecDoc(repo, specToken.state.specUrl);
  const subSpecUrls = specDoc?.subSpecUrls ?? [];
  if (subSpecUrls.length === 0) return [];

  const runningSpecUrls = new Set(
    runningTokens.map((t) => t.state.taskSpecUrl).filter(Boolean),
  );

  const candidatesBySpec = new Map<string, CandidateDoc[]>();
  for (const ct of candidateTokens) {
    if (!ct.state.documentUrl) continue;
    const handle = await repo.find<CandidateDoc>(ct.state.documentUrl as AutomergeUrl);
    const doc = await handle.doc();
    if (!doc?.specUrl) continue;
    const existing = candidatesBySpec.get(doc.specUrl) ?? [];
    existing.push(doc);
    candidatesBySpec.set(doc.specUrl, existing);
  }

  const unsolved: string[] = [];
  for (const url of subSpecUrls) {
    if (runningSpecUrls.has(url)) continue;

    const candidates = candidatesBySpec.get(url) ?? [];
    let foundValid = false;
    for (const candidate of candidates) {
      if (!candidate.documentsFolderUrl) continue;
      const result = await evaluateSolution(repo, url, candidate.documentsFolderUrl);
      if (result.valid) {
        foundValid = true;
        break;
      }
    }
    if (!foundValid) {
      unsolved.push(url);
    }
  }
  return unsolved;
}

async function readSpecDoc(repo: Repo, specUrl: string): Promise<SpecDoc['spec'] | null> {
  if (!specUrl) return null;
  const handle = await repo.find<SpecDoc>(specUrl as AutomergeUrl);
  const doc = await handle.doc();
  return doc?.spec ?? null;
}

async function readDocContent(repo: Repo, documentUrl: string): Promise<string> {
  if (!documentUrl) return '';
  const handle = await repo.find(documentUrl as AutomergeUrl);
  const doc = await handle.doc() as { content?: string } | null;
  return doc?.content ?? '';
}

type DocEntry = { name: string; url: string };

async function cloneSpecFiles(
  repo: Repo,
  specUrl: string,
): Promise<{ folderUrl: string; docEntries: DocEntry[] }> {
  const specDoc = await readSpecDoc(repo, specUrl);
  const filesFolderUrl = specDoc?.filesFolderUrl;

  const docEntries: DocEntry[] = [];
  const clonedEntries: FolderDoc['docs'] = [];

  if (filesFolderUrl) {
    const folderHandle = await repo.find<FolderDoc>(filesFolderUrl as AutomergeUrl);
    const folderDoc = await folderHandle.doc();

    if (folderDoc?.docs) {
      for (const entry of folderDoc.docs) {
        const originalHandle = await repo.find(entry.url);
        const clonedHandle = repo.clone(originalHandle);
        clonedEntries.push({
          type: entry.type,
          name: entry.name,
          url: clonedHandle.url,
        });
        docEntries.push({ name: entry.name, url: clonedHandle.url as string });
      }
    }
  }

  const newFolderHandle = repo.create<FolderDoc>();
  newFolderHandle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = 'Candidate Documents';
    d.docs = clonedEntries;
  });

  return { folderUrl: newFolderHandle.url as string, docEntries };
}

function buildOptimizerPrompt(
  systemPrompt: string,
  characterPrompt: string,
  specUrl: string,
  docEntries: DocEntry[],
): string {
  const docList = docEntries.length > 0
    ? docEntries.map((d) => `- ${d.name}: ${d.url}`).join('\n')
    : '(no documents)';

  const docUrls = JSON.stringify(docEntries.map((d) => ({ name: d.name, url: d.url })));

  return systemPrompt
    .replace(/\$PROMPT/g, characterPrompt)
    .replace(/\$SPEC_URL/g, specUrl)
    .replace(/\$DOC_LIST/g, docList)
    .replace(/\$DOC_URLS/g, docUrls);
}
