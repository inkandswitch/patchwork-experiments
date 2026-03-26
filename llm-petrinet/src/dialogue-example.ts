import type { DatatypeImplementation, ToolRender } from '@inkandswitch/patchwork-plugins';
import type { Repo, DocHandle } from '@automerge/automerge-repo';
import type { LLMPetriNetDoc } from './types';
import { DEFAULT_OPTIMIZER_SYSTEM_PROMPT, DEFAULT_EVALUATOR_SYSTEM_PROMPT } from './net';

// ─── Character prompts ────────────────────────────────────────────────────────

const ELEANOR_PROMPT = `Eleanor Voss. Retired intelligence analyst, now owns the bookshop where this scene takes place.

Motivation: Recover a ledger hidden inside the shop that names every asset her old agency burned — including herself.

Secret: She has dashcam footage from the night of Dante's restaurant fire that proves he did not start it. She has been sitting on it for two years.

What you can offer the others: The ability to make certain problems disappear with a single phone call, and access to the shop and everything hidden in it.

What you need: Mira must not deliver the archive photographs to her employer — one of them shows Eleanor at a meeting she was never supposed to attend.

How to write: Eleanor's dialog is measured, almost warm, with something permanently withheld. She never wastes a word. Every sentence carries a second meaning.`;

const DANTE_PROMPT = `Dante Reyes. Disgraced sous-chef, runs a food truck, owes a serious debt to a collector named Falk.

Motivation: Clear the debt before Falk moves against his sister, who co-signed.

Secret: The night of his restaurant fire he saw someone matching Mira's description photographing documents in the office. He never told anyone and has been trying to work out what it meant.

What you can offer the others: He knows Falk personally and can buy time — possibly more.

What you need: Eleanor has the footage that would clear his name and he has finally worked out that she has it.

How to write: Dante's dialog is generous and quick, papering over a low-level panic he has been carrying for two years. He swings between warmth and self-sabotage.`;

const MIRA_PROMPT = `Mira Salas. Junior archivist employed by Falk.

Motivation: Her younger brother owes Falk a debt that just became dangerous. She was told that retrieving a specific envelope from this shop tonight would cancel it.

Secret: She has been passing document photographs to a journalist for three months. One of them shows Eleanor.

What you can offer the others: She is the only one who knows what Falk actually wants and why the envelope matters — it is not what Eleanor thinks it is.

What you need: Someone to extract her brother from Falk's arrangement without her having to surrender the photographs.

How to write: Mira's dialog is precise and very slightly too calm for someone who is frightened. She observes more than she reveals.`;

const EVALUATOR_PROMPT = `Story editor looking for the continuation that most tightens the negotiation or surfaces something a character did not intend to reveal. Prefer lines that create obligation, expose a vulnerability, or shift the power dynamic between the three characters. The best continuation is the one that makes the next moment harder for everyone.`;

// ─── Opening scene ────────────────────────────────────────────────────────────

const OPENING_SCENE = `# The Bookshop

The street is empty at 2 a.m. The bookshop window is dark.

Dante has been here longest. He arrived twenty minutes ago and has been watching the corner from a doorway across the street, hands in his jacket pockets, running the numbers on a debt that stopped being theoretical three days ago.

Eleanor comes from the north. She has a key but she has not taken it out yet. She stops at the door, looks at Dante, and does not seem surprised to find him there.

Mira arrives last. She is carrying a small envelope. She looks at both of them and says nothing.

`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function createMarkdownDoc(repo: Repo, content: string): string {
  const h = repo.create<Record<string, unknown>>();
  h.change((d: Record<string, unknown>) => {
    d['@patchwork'] = { type: 'markdown' };
    d.content = content;
  });
  return h.url as string;
}

// ─── Template datatype ────────────────────────────────────────────────────────

export const LLMPetriNetDialogueExampleDatatype: DatatypeImplementation<LLMPetriNetDoc> = {
  init(doc, repo) {
    doc.tokens = {
      problems: [
        { id: makeId(), state: { type: 'problem', documentUrl: createMarkdownDoc(repo, OPENING_SCENE) } },
      ],
      optimizer_idle: [
        { id: makeId(), state: { type: 'optimizer', documentUrl: createMarkdownDoc(repo, ELEANOR_PROMPT) } },
        { id: makeId(), state: { type: 'optimizer', documentUrl: createMarkdownDoc(repo, DANTE_PROMPT) } },
        { id: makeId(), state: { type: 'optimizer', documentUrl: createMarkdownDoc(repo, MIRA_PROMPT) } },
      ],
      optimizer_running: [],
      solutions: [],
      evaluator_idle: [
        { id: makeId(), state: { type: 'evaluator', documentUrl: createMarkdownDoc(repo, EVALUATOR_PROMPT) } },
      ],
      evaluator_running: [],
    };

    doc.systemPromptUrls = {
      optimizer: createMarkdownDoc(repo, DEFAULT_OPTIMIZER_SYSTEM_PROMPT),
      evaluator: createMarkdownDoc(repo, DEFAULT_EVALUATOR_SYSTEM_PROMPT),
    };
  },

  getTitle() {
    return 'LLM Petri Net';
  },
};

// ─── Rewrite tool ─────────────────────────────────────────────────────────────
// Once loaded, rewrites @patchwork.type to llm-petrinet so the real tools take over.

export const LLMPetriNetDialogueExampleTool: ToolRender = (handle, _element) => {
  (handle as DocHandle<LLMPetriNetDoc>).change((d) => {
    d['@patchwork'] = { type: 'llm-petrinet' };
  });
  return () => {};
};
