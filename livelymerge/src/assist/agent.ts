/**
 * The model loop (M4): the session's message goes to Claude with the images, the
 * timeline, and the tools; each `perform` tool call runs through the executor and
 * its results (plus a screenshot) go back, until the model stops.
 *
 * The browser calls the Anthropic API directly (the SDK allows it with
 * `dangerouslyAllowBrowser`). The API key is asked for the first time it is needed
 * and kept in localStorage for this origin — never in the document.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Executor, Step } from './executor';
import type { TalkAndDrawMessage } from './message';
import { formatHeader } from './message';
import { forgetNote, formatNotes, readNotes, rememberNote, type Note } from './notes';
import { DEFAULT_SYSTEM_PROMPT, TOOLS } from './prompt';

export const API_KEY_STORAGE = 'talkAndDraw.anthropicApiKey';
export const MODEL_STORAGE = 'talkAndDraw.model';
export const SYSTEM_PROMPT_STORAGE = 'talkAndDraw.systemPrompt';
export const DEFAULT_MODEL = 'claude-opus-5-5';
/** What the drawer offers. */
export const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'];
export const MAX_TURNS_STORAGE = 'talkAndDraw.maxTurns';
export const DEFAULT_MAX_TURNS = 24;

/** What the agent reports as it goes (console + drawer transcript). */
export type AgentEvent =
  | { kind: 'start'; model: string; message: TalkAndDrawMessage; notes: Note[] }
  | { kind: 'request'; turn: number }
  | { kind: 'response'; turn: number; stopReason: string | null; inputTokens: number; outputTokens: number; servedBy?: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; name: string; input: unknown }
  | { kind: 'tool_result'; name: string; text: string; images: string[]; isError?: boolean }
  | { kind: 'error'; text: string }
  | { kind: 'done'; reason: 'end' | 'canceled' | 'refusal' | 'error' | 'max_turns' | 'no_key' };

type Content = Anthropic.Beta.BetaContentBlockParam[];

/** The API's stand-in text for a progress update cut off by max_tokens; never spoken. */
const INTERRUPTED_SENTINEL = 'This part of the response was interrupted before it finished.';
/** What gets spoken when the model stops: at most this many characters, whole sentences. */
export const CLOSING_SPEECH_MAX = 220;

/** The first sentence(s) of `text`, up to `max` chars — the part that is spoken aloud. */
export function capSpeech(text: string, max = CLOSING_SPEECH_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [t];
  let out = '';
  for (const sentence of sentences) {
    if (out && (out + sentence).trim().length > max) break;
    out += sentence;
    if (out.trim().length > max) break;
  }
  out = out.trim();
  return out.length > max ? out.slice(0, max - 1).trimEnd() + '…' : out;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getApiKey(ask = true): string | null {
  const s = storage();
  let key = s?.getItem(API_KEY_STORAGE) ?? null;
  if (!key && ask) {
    key = window.prompt('Talk & Draw needs an Anthropic API key (kept in this browser only):', '')?.trim() ?? null;
    if (key) s?.setItem(API_KEY_STORAGE, key);
  }
  return key || null;
}

export function clearApiKey(): void {
  storage()?.removeItem(API_KEY_STORAGE);
}

export function getModel(): string {
  return storage()?.getItem(MODEL_STORAGE) || DEFAULT_MODEL;
}

export function setModel(model: string | null): void {
  if (model) storage()?.setItem(MODEL_STORAGE, model);
  else storage()?.removeItem(MODEL_STORAGE);
}

export function getSystemPrompt(): string {
  return storage()?.getItem(SYSTEM_PROMPT_STORAGE) || DEFAULT_SYSTEM_PROMPT;
}

/** null restores the default. */
export function setSystemPrompt(prompt: string | null): void {
  if (prompt && prompt.trim() && prompt !== DEFAULT_SYSTEM_PROMPT) storage()?.setItem(SYSTEM_PROMPT_STORAGE, prompt);
  else storage()?.removeItem(SYSTEM_PROMPT_STORAGE);
}

export function getMaxTurns(): number {
  const n = Number(storage()?.getItem(MAX_TURNS_STORAGE));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_MAX_TURNS;
}

export function setMaxTurns(n: number | null): void {
  if (n && Number.isFinite(n) && n >= 1 && n !== DEFAULT_MAX_TURNS) storage()?.setItem(MAX_TURNS_STORAGE, String(Math.floor(n)));
  else storage()?.removeItem(MAX_TURNS_STORAGE);
}

export function hasApiKey(): boolean {
  return !!storage()?.getItem(API_KEY_STORAGE);
}

function imageBlock(dataUrl: string): Anthropic.Beta.BetaImageBlockParam {
  const comma = dataUrl.indexOf(',');
  const media = /^data:([^;]+);base64,/.exec(dataUrl)?.[1] ?? 'image/png';
  return {
    type: 'image',
    source: { type: 'base64', media_type: media as 'image/png', data: dataUrl.slice(comma + 1) },
  };
}

/** The session as the model's first user turn: header, transcript, timeline, images. */
export function buildUserContent(m: TalkAndDrawMessage, notes: readonly Note[] = []): Content {
  const content: Content = [];
  const transcript =
    m.transcriptStatus === 'whisper'
      ? `Transcript: "${m.transcriptText ?? ''}"`
      : `Transcript: unavailable (${m.transcriptStatus}${m.transcriptInfo ? `: ${m.transcriptInfo}` : ''}). Go by the drawing alone, and ask if it is not enough.`;
  content.push({
    type: 'text',
    text: `${formatHeader(m)}\nThe user drew ${m.strokes.length} stroke(s) in purple over ${(m.durationMs / 1000).toFixed(1)}s.\n${transcript}\n\n${m.timeline}`,
  });
  content.push({ type: 'text', text: formatNotes(notes) });
  for (const img of m.images) {
    content.push({ type: 'text', text: `Image "${img.label}" (${(img.t / 1000).toFixed(2)}s):` });
    content.push(imageBlock(img.dataUrl));
  }
  return content;
}

export interface AgentOptions {
  effort?: 'low' | 'medium' | 'high';
}

export class Agent {
  private canceled = false;
  private running = false;
  private listeners: ((e: AgentEvent) => void)[] = [];

  constructor(
    private readonly executor: Executor,
    private readonly setStatus: (text: string | null) => void,
  ) {}

  addListener(fn: (e: AgentEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  private emit(e: AgentEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error('Talk & Draw: listener failed', err);
      }
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  cancel(): void {
    if (!this.running) return;
    this.canceled = true;
    this.executor.cancel();
  }

  async run(m: TalkAndDrawMessage, opts: AgentOptions = {}): Promise<void> {
    if (this.running) this.cancel();
    while (this.running) await new Promise((r) => setTimeout(r, 20));
    const status = this.setStatus;
    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn('Talk & Draw: no API key; the message was logged but not sent.');
      this.emit({ kind: 'error', text: 'No API key: the message was logged but not sent.' });
      this.emit({ kind: 'done', reason: 'no_key' });
      return;
    }
    this.running = true;
    this.canceled = false;
    this.executor.fastForward = false;
    this.executor.holdFastForward = true;
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const model = getModel();
    const system = getSystemPrompt();
    let notes: Note[] = [];
    try {
      notes = readNotes();
    } catch (err) {
      console.warn('Talk & Draw: could not read shared notes', err);
    }
    const maxTurns = getMaxTurns();
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: buildUserContent(m, notes) }];
    const scale = m.image.scale;
    let reason: Extract<AgentEvent, { kind: 'done' }>['reason'] = 'end';
    console.group('%cTalk & Draw agent', 'color:#ff6a00;font-weight:bold');
    console.log(`model ${model}, ${m.images.length} images, scale ${scale.toFixed(3)}, ${notes.length} shared notes, max ${maxTurns} turns`);
    this.emit({ kind: 'start', model, message: m, notes });
    try {
      for (let turn = 0; turn < maxTurns && !this.canceled; turn++) {
        status('Talk & Draw — thinking…');
        this.emit({ kind: 'request', turn });
        let response: Anthropic.Beta.BetaMessage;
        try {
          const haiku = model.startsWith('claude-haiku');
          const betas: string[] = [];
          // Haiku has no server-side refusal fallback; the others get the default chain.
          const fallback = haiku ? {} : { fallbacks: 'default' as const };
          if (!haiku) betas.push('server-side-fallback-2026-07-01');
          // The notes the model writes between tool calls ("let me open its halo") come
          // back as progress-update thinking blocks, EMPTY unless we ask for them. They
          // are what the user hears while the model works.
          const thinking = haiku ? {} : { thinking: { type: 'adaptive' as const, display: 'updates' as const } };
          if (!haiku) betas.push('thinking-display-updates-2026-08-18');
          response = await client.beta.messages.create({
            model,
            max_tokens: 8000,
            system,
            tools: TOOLS,
            messages,
            output_config: { effort: opts.effort ?? 'medium' },
            ...thinking,
            ...fallback,
            ...(betas.length ? { betas } : {}),
          });
        } catch (err) {
          let text: string;
          if (err instanceof Anthropic.AuthenticationError) {
            clearApiKey();
            text = 'The API key was rejected and has been cleared; you will be asked again next time.';
          } else if (err instanceof Anthropic.RateLimitError) {
            text = `Rate limited; try again shortly. ${err.message}`;
          } else if (err instanceof Anthropic.APIError) {
            text = `API error ${err.status}: ${err.message}`;
          } else {
            text = `Request failed: ${err instanceof Error ? err.message : String(err)}`;
          }
          console.error('Talk & Draw:', text, err);
          this.emit({ kind: 'error', text });
          status('Talk & Draw — error (see console)');
          reason = 'error';
          await new Promise((r) => setTimeout(r, 2500));
          return;
        }
        if (this.canceled) {
          reason = 'canceled';
          return;
        }
        const servedBy = response.model !== model ? response.model : undefined;
        console.log(
          `turn ${turn + 1}: stop=${response.stop_reason}, in=${response.usage.input_tokens} out=${response.usage.output_tokens}` +
            (servedBy ? ` (served by ${servedBy})` : ''),
        );
        this.emit({
          kind: 'response',
          turn,
          stopReason: response.stop_reason,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          servedBy,
        });
        const texts: string[] = [];
        const toolUses: Anthropic.Beta.BetaToolUseBlock[] = [];
        for (const block of response.content) {
          if (block.type === 'thinking') {
            // Under display: "updates" a non-empty thinking block is a progress update.
            const t = (block.thinking ?? '').trim();
            if (t && t !== INTERRUPTED_SENTINEL) {
              texts.push(t);
              console.log('%cprogress:', 'color:#ff6a00', t);
              this.emit({ kind: 'text', text: t });
            }
          } else if (block.type === 'text') {
            texts.push(block.text);
            console.log('%csays:', 'color:#ff6a00', block.text);
            this.emit({ kind: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            toolUses.push(block);
            console.log(`%ctool ${block.name}:`, 'color:#ff6a00', block.input);
            this.emit({ kind: 'tool_use', name: block.name, input: block.input });
          }
        }
        if (response.stop_reason === 'refusal') {
          console.warn('Talk & Draw: the model declined this request.', response.stop_details);
          this.emit({ kind: 'error', text: `The model declined this request (${response.stop_details?.category ?? 'no category'}).` });
          await this.sayText("Sorry, I can't help with that one.");
          reason = 'refusal';
          return;
        }
        messages.push({ role: 'assistant', content: response.content });
        if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
          // The model is done: speak the gist (whole sentences, hard-capped), not the
          // essay — the full text stays in the transcript and the console.
          const closing = texts.join(' ').trim();
          if (closing) {
            const spoken = capSpeech(closing);
            if (spoken.length < closing.length) console.log('%cclosing (spoken part):', 'color:#ff6a00', spoken);
            await this.sayText(spoken);
          }
          return;
        }
        // Text alongside tool calls is narration: speak it while the tools run.
        const narration = texts.join(' ').trim();
        const narrating = narration ? this.executor.narrate(narration).catch(() => {}) : Promise.resolve();
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          if (this.canceled) {
            reason = 'canceled';
            return;
          }
          results.push(await this.runTool(tu, scale, status));
        }
        await narrating;
        messages.push({ role: 'user', content: results });
      }
      if (this.canceled) reason = 'canceled';
      else {
        reason = 'max_turns';
        console.warn(`Talk & Draw: stopped after ${maxTurns} turns (raise it in the drawer).`);
        this.emit({ kind: 'error', text: `Stopped after ${maxTurns} turns (raise the limit in the drawer).` });
      }
    } finally {
      this.running = false;
      this.executor.holdFastForward = false;
      this.executor.fastForward = false;
      status(null);
      console.groupEnd();
      this.emit({ kind: 'done', reason });
    }
  }

  private async sayText(text: string): Promise<void> {
    await this.executor.perform([{ type: 'say', text, bubble: true }]);
  }

  private async runTool(
    tu: Anthropic.Beta.BetaToolUseBlock,
    scale: number,
    status: (t: string | null) => void,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
    const input = (tu.input ?? {}) as Record<string, unknown>;
    try {
      switch (tu.name) {
        case 'perform': {
          const steps = Array.isArray(input.steps) ? (input.steps as Step[]) : [];
          status('Talk & Draw — performing…');
          // A narration field is spoken as the steps start (it takes the voice over
          // from any turn-level progress update still playing).
          const narration = typeof input.narration === 'string' ? input.narration.trim() : '';
          const narrating = narration ? this.executor.narrate(narration).catch(() => {}) : Promise.resolve();
          if (narration) this.emit({ kind: 'text', text: narration });
          const r = await this.executor.perform(steps, { scale });
          await narrating;
          const summary = r.steps.map((s) => ({
            index: s.index,
            type: s.type,
            ok: s.ok,
            ...(s.error ? { error: s.error } : {}),
            ...(s.value != null && s.type !== 'screenshot' ? { value: s.value } : {}),
          }));
          const text = `${r.canceled ? 'CANCELED by the user. ' : ''}Step results:\n${JSON.stringify(summary, null, 1)}\nScreenshot after the last step:`;
          const content: Anthropic.Beta.BetaToolResultBlockParam['content'] = [{ type: 'text', text }, imageBlock(r.screenshot.dataUrl)];
          for (const s of r.steps) {
            if (s.type === 'screenshot' && typeof s.value === 'string') {
              content.push({ type: 'text', text: `Screenshot from step ${s.index}:` }, imageBlock(s.value));
            }
          }
          this.emit({
            kind: 'tool_result',
            name: 'perform',
            text: text.replace(/\nScreenshot after the last step:$/, ''),
            images: [r.screenshot.dataUrl, ...r.steps.filter((s) => s.type === 'screenshot' && typeof s.value === 'string').map((s) => s.value as string)],
          });
          return { type: 'tool_result', tool_use_id: tu.id, content };
        }
        case 'screenshot': {
          const shot = await this.executor.captureScreenshot(scale, 'screenshot');
          this.emit({ kind: 'tool_result', name: 'screenshot', text: '', images: [shot.dataUrl] });
          return { type: 'tool_result', tool_use_id: tu.id, content: [imageBlock(shot.dataUrl)] };
        }
        case 'remember': {
          const topic = String(input.topic ?? '').trim();
          const text = String(input.text ?? '').trim();
          if (!topic || !text) throw new Error('remember needs a topic and a text');
          const author = (window as any)._lmUserName ? String((window as any)._lmUserName) : undefined;
          const count = rememberNote(topic, text, author);
          console.log('%cremember:', 'color:#ff6a00', topic, '—', text);
          this.emit({ kind: 'tool_result', name: 'remember', text: `${topic}: ${text}`, images: [] });
          return { type: 'tool_result', tool_use_id: tu.id, content: `saved (${count} notes now)` };
        }
        case 'forget': {
          const topic = String(input.topic ?? '').trim();
          const removed = forgetNote(topic);
          this.emit({ kind: 'tool_result', name: 'forget', text: removed ? `removed "${topic}"` : `no note "${topic}"`, images: [] });
          return { type: 'tool_result', tool_use_id: tu.id, content: removed ? 'removed' : 'no such note' };
        }
        case 'eval': {
          const rt = (window as any).runtime;
          if (!rt || typeof rt.printIt !== 'function') throw new Error('no runtime');
          const source = String(input.source ?? '');
          console.log('%ceval:', 'color:#ff6a00', source);
          const out = String(rt.printIt(source)).slice(0, 20000);
          this.emit({ kind: 'tool_result', name: 'eval', text: out, images: [] });
          return { type: 'tool_result', tool_use_id: tu.id, content: out };
        }
        default:
          this.emit({ kind: 'tool_result', name: tu.name, text: `unknown tool ${tu.name}`, images: [], isError: true });
          return { type: 'tool_result', tool_use_id: tu.id, content: `unknown tool ${tu.name}`, is_error: true };
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      this.emit({ kind: 'tool_result', name: tu.name, text, images: [], isError: true });
      return { type: 'tool_result', tool_use_id: tu.id, content: text, is_error: true };
    }
  }
}
