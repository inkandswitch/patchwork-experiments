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
import type { InkOverlay } from './overlay';
import { DEFAULT_VIBE, TOOLS, systemPrompt } from './prompt';

export const API_KEY_STORAGE = 'talkAndDraw.anthropicApiKey';
export const MODEL_STORAGE = 'talkAndDraw.model';
export const VIBE_STORAGE = 'talkAndDraw.vibe';
export const DEFAULT_MODEL = 'claude-fable-5-1';
const MAX_TURNS = 12;

type Content = Anthropic.Beta.BetaContentBlockParam[];

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

export function getVibe(): string {
  return storage()?.getItem(VIBE_STORAGE) || DEFAULT_VIBE;
}

export function setVibe(vibe: string | null): void {
  if (vibe) storage()?.setItem(VIBE_STORAGE, vibe);
  else storage()?.removeItem(VIBE_STORAGE);
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
export function buildUserContent(m: TalkAndDrawMessage): Content {
  const content: Content = [];
  const transcript =
    m.transcriptStatus === 'whisper'
      ? `Transcript: "${m.transcriptText ?? ''}"`
      : `Transcript: unavailable (${m.transcriptStatus}${m.transcriptInfo ? `: ${m.transcriptInfo}` : ''}). Go by the drawing alone, and ask if it is not enough.`;
  content.push({
    type: 'text',
    text: `${formatHeader(m)}\nThe user drew ${m.strokes.length} stroke(s) in purple over ${(m.durationMs / 1000).toFixed(1)}s.\n${transcript}\n\n${m.timeline}`,
  });
  for (const img of m.images) {
    content.push({ type: 'text', text: `Image "${img.label}" (${(img.t / 1000).toFixed(2)}s):` });
    content.push(imageBlock(img.dataUrl));
  }
  return content;
}

export interface AgentOptions {
  effort?: 'low' | 'medium' | 'high';
  onStatus?: (text: string | null) => void;
}

export class Agent {
  private canceled = false;
  private running = false;

  constructor(
    private readonly executor: Executor,
    private readonly overlay: InkOverlay,
  ) {}

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
    const status = (t: string | null) => {
      this.overlay.setStatus(t);
      opts.onStatus?.(t);
    };
    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn('Talk & Draw: no API key; the message was logged but not sent.');
      return;
    }
    this.running = true;
    this.canceled = false;
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const model = getModel();
    const system = systemPrompt(getVibe());
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: buildUserContent(m) }];
    const scale = m.image.scale;
    console.group('%cTalk & Draw agent', 'color:#ff6a00;font-weight:bold');
    console.log(`model ${model}, ${m.images.length} images, scale ${scale.toFixed(3)}`);
    try {
      for (let turn = 0; turn < MAX_TURNS && !this.canceled; turn++) {
        status('Talk & Draw — thinking…');
        let response: Anthropic.Beta.BetaMessage;
        try {
          response = await client.beta.messages.create({
            model,
            max_tokens: 8000,
            system,
            tools: TOOLS,
            messages,
            output_config: { effort: opts.effort ?? 'medium' },
            // Fable's safety classifiers may decline; the default fallback chain reruns
            // the request on another model inside the same call.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          });
        } catch (err) {
          if (err instanceof Anthropic.AuthenticationError) {
            clearApiKey();
            console.error('Talk & Draw: the API key was rejected and has been cleared; you will be asked again next time.');
          } else if (err instanceof Anthropic.RateLimitError) {
            console.error('Talk & Draw: rate limited; try again shortly.', err.message);
          } else if (err instanceof Anthropic.APIError) {
            console.error(`Talk & Draw: API error ${err.status}:`, err.message);
          } else {
            console.error('Talk & Draw: request failed', err);
          }
          status('Talk & Draw — error (see console)');
          await new Promise((r) => setTimeout(r, 2500));
          return;
        }
        if (this.canceled) return;
        console.log(
          `turn ${turn + 1}: stop=${response.stop_reason}, in=${response.usage.input_tokens} out=${response.usage.output_tokens}` +
            (response.model !== model ? ` (served by ${response.model})` : ''),
        );
        const texts: string[] = [];
        const toolUses: Anthropic.Beta.BetaToolUseBlock[] = [];
        for (const block of response.content) {
          if (block.type === 'text') {
            texts.push(block.text);
            console.log('%csays:', 'color:#ff6a00', block.text);
          } else if (block.type === 'tool_use') {
            toolUses.push(block);
            console.log(`%ctool ${block.name}:`, 'color:#ff6a00', block.input);
          }
        }
        if (response.stop_reason === 'refusal') {
          console.warn('Talk & Draw: the model declined this request.', response.stop_details);
          await this.sayText("Sorry, I can't help with that one.");
          return;
        }
        messages.push({ role: 'assistant', content: response.content });
        if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
          // Plain text at the end is the model talking to the user: say it.
          const closing = texts.join(' ').trim();
          if (closing) await this.sayText(closing);
          return;
        }
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          if (this.canceled) return;
          results.push(await this.runTool(tu, scale, status));
        }
        messages.push({ role: 'user', content: results });
      }
      if (!this.canceled) console.warn(`Talk & Draw: stopped after ${MAX_TURNS} turns.`);
    } finally {
      this.running = false;
      status(null);
      console.groupEnd();
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
          const r = await this.executor.perform(steps, { scale });
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
          return { type: 'tool_result', tool_use_id: tu.id, content };
        }
        case 'screenshot': {
          const shot = this.executor.takeScreenshot(scale, 'screenshot');
          return { type: 'tool_result', tool_use_id: tu.id, content: [imageBlock(shot.dataUrl)] };
        }
        case 'eval': {
          const rt = (window as any).runtime;
          if (!rt || typeof rt.printIt !== 'function') throw new Error('no runtime');
          const source = String(input.source ?? '');
          console.log('%ceval:', 'color:#ff6a00', source);
          const out = String(rt.printIt(source));
          return { type: 'tool_result', tool_use_id: tu.id, content: out.slice(0, 20000) };
        }
        default:
          return { type: 'tool_result', tool_use_id: tu.id, content: `unknown tool ${tu.name}`, is_error: true };
      }
    } catch (err) {
      return {
        type: 'tool_result',
        tool_use_id: tu.id,
        content: err instanceof Error ? err.message : String(err),
        is_error: true,
      };
    }
  }
}
