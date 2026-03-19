import type { DocHandle, Repo } from '@automerge/automerge-repo';
import { getRegistry } from '@inkandswitch/patchwork-plugins';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createMarkdownCopy(repo: Repo, content: string): Promise<{ url: string }> {
  const { createDocOfDatatype2 } = await import('@inkandswitch/patchwork-plugins');
  const markdownDatatype = (await getRegistry('patchwork:datatype').load('markdown')) as any;
  const h = await createDocOfDatatype2(markdownDatatype, repo, (d: Record<string, unknown>) => {
    d.content = content;
  });
  return { url: h.url as string };
}
import type { NetDef, ReadonlyToken } from './lib';
import type { LLMPetriNetDoc } from './types';
import { runLLMProcessRaw } from '../../llm/src/llm-process';

// ─── Default prompt content ───────────────────────────────────────────────────

export const DEFAULT_OPTIMIZER_PROMPT = 'The nervous butler who discovered the body and is hiding something.';
export const DEFAULT_EVALUATOR_PROMPT = 'Favour the version that introduces the most chilling new revelation or casts suspicion onto a fresh suspect.';

// ─── Petri net script-execution system prompt (no skills, no workspace) ───────

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
  '- Use `updateText` from `@automerge/automerge-repo` for text content mutations',
].join('\n');

// ─── Default system prompt templates ──────────────────────────────────────────

export const DEFAULT_OPTIMIZER_SYSTEM_PROMPT = [
  'You are a suspect in a murder mystery. Here is your character:',
  '',
  '$PROMPT',
  '',
  '---',
  '',
  'The case file you are contributing to is at: $DOC_URL',
  '',
  "Your task: Read the current account, then append exactly ONE new beat — a single line of dialogue or action — that your character would say or do next. Think about what you know, what you're hiding, and what you might let slip.",
  '',
  'Step 1: Read the case file.',
  '```',
  'const handle = await repo.find("$DOC_URL")',
  'const doc = await handle.doc()',
  'const content = doc.content',
  'return content',
  '```',
  '',
  'Step 2: Decide what your character does next. Then append it.',
  '```',
  'const { updateText } = await import("@automerge/automerge-repo")',
  'const handle = await repo.find("$DOC_URL")',
  'const doc = await handle.doc()',
  'const myLine = "\\n[CharacterName]: [what they say or do]"',
  'handle.change(d => updateText(d, ["content"], doc.content + myLine))',
  '```',
  '',
  "Replace [CharacterName] with your character's name. Write only the single line — no stage directions, no narration, no explanation.",
].join('\n');

export const DEFAULT_EVALUATOR_SYSTEM_PROMPT = [
  'You are the lead detective sifting through witness accounts. Here is your approach:',
  '',
  '$PROMPT',
  '',
  '---',
  '',
  'Each suspect has contributed a line to the case file. Here are the resulting versions:',
  '',
  'Step 1: Read all versions.',
  '```',
  'const urls = $SOLUTION_URLS',
  'const reads = await Promise.all(urls.map(url =>',
  '  repo.find(url).then(h => h.doc()).then(d => ({ url, content: d?.content ?? "" }))',
  '))',
  'return reads.map(r => `--- ${r.url} ---\\n${r.content}`).join("\\n\\n")',
  '```',
  '',
  'Step 2: Identify which continuation best deepens the mystery or casts the most compelling suspicion.',
  'Respond with ONLY the URL of the winning solution — a single line, nothing else.',
].join('\n');

// ─── Net definition ───────────────────────────────────────────────────────────

export function createNet(repo: Repo, handle: DocHandle<LLMPetriNetDoc>): NetDef {
  return {
    places: ['problems', 'optimizer', 'solutions', 'evaluators'],

    transitions: [
      {
        id: 'optimizing',
        from: ['problems'],
        fromAll: ['optimizer'],
        to: ['solutions', 'optimizer'],

        async onConsumedTokens({ problems }, { optimizer }, repo) {
          const storyContent = await readDocContent(repo, problems.state.documentUrl);
          const doc = await handle.doc();
          const systemPromptUrl = doc?.systemPromptUrls?.optimizer;
          const systemTemplate = systemPromptUrl
            ? await readDocContent(repo, systemPromptUrl)
            : (doc?.systemPrompts?.optimizer ?? DEFAULT_OPTIMIZER_SYSTEM_PROMPT);
          const produce = [];
          const processUrls: string[] = [];

          console.log(`[llm-petrinet] optimizing: problem doc=${problems.state.documentUrl}, story length=${storyContent.length}, optimizers=${optimizer.length}`);

          for (const opt of optimizer) {
            const charPrompt = await readDocContent(repo, opt.state.documentUrl);
            const { copyUrl, processUrl } = await launchOptimizerRun(repo, storyContent, charPrompt, systemTemplate);
            console.log(`[llm-petrinet] optimizer ${opt.id}: charPrompt doc=${opt.state.documentUrl}, copyUrl=${copyUrl}, processUrl=${processUrl}`);
            produce.push({ state: { type: 'solution', documentUrl: copyUrl }, toPlace: 'solutions' });
            produce.push({ state: opt.state, toPlace: 'optimizer' });
            processUrls.push(processUrl);
          }

          for (const processUrl of processUrls) {
            runLLMProcessRaw(repo, processUrl as unknown as import('@automerge/automerge-repo').AutomergeUrl)
              .catch((e) => console.error('[llm-petrinet] optimizer runLLMProcess error', e));
          }

          return { produce };
        },
      },

      {
        id: 'evaluating',
        from: ['evaluators'],
        fromAll: ['solutions'],
        to: ['problems', 'evaluators'],

        async guard(_tokens, { solutions }) {
          return solutions.length > 0;
        },

        async onConsumedTokens({ evaluators }, { solutions }, repo) {
          const doc = await handle.doc();
          const systemPromptUrl = doc?.systemPromptUrls?.evaluator;
          const systemTemplate = systemPromptUrl
            ? await readDocContent(repo, systemPromptUrl)
            : (doc?.systemPrompts?.evaluator ?? DEFAULT_EVALUATOR_SYSTEM_PROMPT);
          const evalPrompt = await readDocContent(repo, evaluators.state.documentUrl);
          const solutionUrls = solutions.map((s) => s.state.documentUrl);
          console.log(`[llm-petrinet] evaluating: ${solutionUrls.length} solutions:`, solutionUrls);

          const { processUrl } = await launchEvaluatorRun(repo, solutions, evalPrompt, systemTemplate);
          console.log(`[llm-petrinet] evaluating: processUrl=${processUrl}`);

          await runLLMProcessRaw(repo, processUrl as unknown as import('@automerge/automerge-repo').AutomergeUrl)
            .catch((e) => console.error('[llm-petrinet] evaluator runLLMProcess error', e));

          const processHandle = await repo.find(processUrl as unknown as import('@automerge/automerge-repo').AutomergeUrl);
          const processDoc = await processHandle.doc() as { output?: Array<{ type: string; content?: string }> } | null;
          const outputText = (processDoc?.output ?? [])
            .filter((b) => b.type === 'text')
            .map((b) => b.content ?? '')
            .join('\n');

          console.log(`[llm-petrinet] evaluating: LLM output text:\n${outputText}`);

          const winnerUrl = solutionUrls.find((url) => outputText.includes(url)) ?? solutionUrls[0] ?? '';
          console.log(`[llm-petrinet] evaluating: winnerUrl=${winnerUrl} (fallback=${!solutionUrls.find((url) => outputText.includes(url))})`);

          return {
            produce: [
              { state: evaluators.state, toPlace: 'evaluators' },
              { state: { type: 'problem', documentUrl: winnerUrl }, toPlace: 'problems' },
              ...solutions
                .filter((s) => s.state.documentUrl !== winnerUrl)
                .map((s) => ({ state: s.state, toPlace: 'solutions' })),
            ],
          };
        },
      },
    ],

    tokenTypes: [
      {
        id: 'problem',
        label: 'Problem',
        color: '#7c3aed',
        async create() {
          const { url } = await createMarkdownCopy(repo, '# The Scene of the Crime\n\n');
          return { type: 'problem', documentUrl: url };
        },
      },
      {
        id: 'optimizer',
        label: 'Optimizer',
        color: '#0891b2',
        async create() {
          const { url } = await createMarkdownCopy(repo, DEFAULT_OPTIMIZER_PROMPT);
          return { type: 'optimizer', documentUrl: url };
        },
      },
      {
        id: 'evaluator',
        label: 'Evaluator',
        color: '#d97706',
        async create() {
          const { url } = await createMarkdownCopy(repo, DEFAULT_EVALUATOR_PROMPT);
          return { type: 'evaluator', documentUrl: url };
        },
      },
      {
        id: 'solution',
        label: 'Solution',
        color: '#16a34a',
        async create() {
          return { type: 'solution', documentUrl: '' };
        },
      },
    ],

    getColor(state) {
      if (state.type === 'problem') return '#7c3aed';
      if (state.type === 'optimizer') return '#0891b2';
      if (state.type === 'evaluator') return '#d97706';
      if (state.type === 'solution') return '#16a34a';
      return '#6b7280';
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readDocContent(repo: Repo, documentUrl: string): Promise<string> {
  if (!documentUrl) return '';
  const handle = await repo.find(documentUrl as import('@automerge/automerge-repo').AutomergeUrl);
  const doc = await handle.doc() as { content?: string } | null;
  return doc?.content ?? '';
}

async function launchOptimizerRun(
  repo: Repo,
  storyContent: string,
  charPrompt: string,
  systemTemplate: string,
): Promise<{ copyUrl: string; processUrl: string }> {
  const { url: copyUrl } = await createMarkdownCopy(repo, storyContent);
  console.log(`[llm-petrinet] launchOptimizerRun: created copy=${copyUrl}, storyContent length=${storyContent.length}`);
  const prompt = buildOptimizerPrompt(systemTemplate, charPrompt, copyUrl);

  const processHandle = repo.create<Record<string, unknown>>();
  processHandle.change((d) => {
    d['@patchwork'] = { type: 'llm' };
    d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' };
    d.systemPrompt = PETRINET_SYSTEM_PROMPT;
    d.prompt = prompt;
    d.output = [];
  });

  return { copyUrl, processUrl: processHandle.url as string };
}

async function launchEvaluatorRun(
  repo: Repo,
  solutions: ReadonlyToken[],
  evaluatorPrompt: string,
  systemTemplate: string,
): Promise<{ processUrl: string }> {
  const solutionUrls = solutions.map((s) => s.state.documentUrl).filter(Boolean);
  const prompt = buildEvaluatorPrompt(systemTemplate, evaluatorPrompt, solutionUrls);

  const processHandle = repo.create<Record<string, unknown>>();
  processHandle.change((d) => {
    d['@patchwork'] = { type: 'llm' };
    d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' };
    d.systemPrompt = PETRINET_SYSTEM_PROMPT;
    d.prompt = prompt;
    d.output = [];
  });

  return { processUrl: processHandle.url as string };
}

function buildOptimizerPrompt(systemPrompt: string, characterPrompt: string, docUrl: string): string {
  return systemPrompt
    .replace(/\$PROMPT/g, characterPrompt)
    .replace(/\$DOC_URL/g, docUrl);
}

function buildEvaluatorPrompt(
  systemPrompt: string,
  evaluatorPrompt: string,
  solutionUrls: string[],
): string {
  const urlsArray = JSON.stringify(solutionUrls, null, 2);
  return systemPrompt
    .replace(/\$PROMPT/g, evaluatorPrompt)
    .replace(/\$SOLUTION_URLS/g, urlsArray);
}
