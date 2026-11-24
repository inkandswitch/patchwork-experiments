/**
 * The always-visible Talk & Draw badge (bottom right) and the drawer it opens: model
 * picker, API key, editable system prompt, and a transcript of the exchange with the
 * model. Plain DOM + injected CSS; the drawer takes the right third of the tool at
 * full height. The badge is DOM rather than canvas-drawn so it stays clickable while
 * the overlay is ignoring the pointer.
 */
import type { AgentEvent } from './agent';
import type { Note } from './notes';
import { DEFAULT_SYSTEM_PROMPT } from './prompt';

export type BadgeState = 'idle' | 'listening' | 'working' | 'error';

export interface UiHooks {
  models: string[];
  getModel(): string;
  setModel(model: string | null): void;
  getSystemPrompt(): string;
  setSystemPrompt(prompt: string | null): void;
  hasApiKey(): boolean;
  askApiKey(): void;
  clearApiKey(): void;
  resend(): void;
  cancel(): void;
  /** Skip ahead through the current response (speech cut, animations finished). */
  fastForward(): void;
  getMaxTurns(): number;
  setMaxTurns(n: number | null): void;
  efforts: string[];
  getEffort(): string;
  setEffort(e: string | null): void;
  getNotes(): Note[];
  forgetNote(topic: string): void;
  voice: {
    enabled(): boolean;
    setEnabled(on: boolean): void;
    modes: string[];
    hasKey(): boolean;
    /** Ask for the key only if there is none. */
    ensureKey(): void;
    getMode(): string;
    setMode(m: string): void;
    status(): string;
    statusDetail(): { summary: string; detail: string | null; kind: 'ok' | 'note' | 'off' };
    getVoiceName(): string;
    setVoiceName(name: string | null): void;
    models: string[];
    getModel(): string;
    setModel(m: string | null): void;
    getSettings(): { stability?: number; similarity_boost?: number; style?: number };
    setSettings(v: { stability?: number; similarity_boost?: number; style?: number }): void;
    askKey(): void;
    clearKey(): void;
  };
}

const COLLAPSE_STORAGE = 'talkAndDraw.drawerCollapsed';

function collapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_STORAGE) ?? '{}');
  } catch {
    return {};
  }
}

function setCollapsed(key: string, value: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_STORAGE, JSON.stringify({ ...collapsed(), [key]: value }));
  } catch {
    /* ignore */
  }
}

const IDLE_TEXT = 'Talk & Draw';

const CSS = `
.lm-assist-badge{position:absolute;right:12px;bottom:12px;z-index:31;display:flex;align-items:center;gap:8px;
  height:26px;padding:0 10px;border-radius:13px;border:1px solid #b400ff;background:rgba(255,255,255,.94);
  color:#222;font:12px system-ui,sans-serif;cursor:pointer;user-select:none;box-shadow:0 1px 4px rgba(0,0,0,.08);
  transition:right .25s cubic-bezier(.32,.72,0,1)}
.lm-assist-badge:hover{background:#fff}
.lm-assist-badge .dot{width:8px;height:8px;border-radius:50%;background:#aaa}
.lm-assist-ff{position:absolute;bottom:12px;z-index:31;height:26px;padding:0 10px;border-radius:13px;border:1px solid #ff6a00;
  background:rgba(255,255,255,.94);color:#ff6a00;font:13px system-ui,sans-serif;cursor:pointer;user-select:none;
  box-shadow:0 1px 4px rgba(0,0,0,.08);transition:right .25s cubic-bezier(.32,.72,0,1)}
.lm-assist-ff:hover{background:#fff}
.lm-assist-ff[hidden]{display:none}
.lm-assist-ff.on{background:#ff6a00;color:#fff}
.lm-assist-badge[data-state=listening] .dot{background:#b400ff;animation:lm-assist-pulse 1.2s ease-in-out infinite}
.lm-assist-badge[data-state=working]{border-color:#ff6a00}
.lm-assist-badge[data-state=working] .dot{background:#ff6a00;animation:lm-assist-pulse 1.2s ease-in-out infinite}
.lm-assist-badge[data-state=error] .dot{background:#d33}
@keyframes lm-assist-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.lm-assist-drawer{position:absolute;top:0;right:0;bottom:0;width:33.333%;min-width:340px;z-index:40;display:flex;
  flex-direction:column;background:#fff;border-left:1px solid #ddd;box-shadow:-4px 0 24px rgba(0,0,0,.08);
  font:12px system-ui,sans-serif;color:#222}
.lm-assist-drawer[hidden]{display:none}
.lm-assist-drawer .hd{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #e5e5e5}
.lm-assist-drawer .hd h2{margin:0;font-size:13px;font-weight:600;flex:1}
.lm-assist-drawer button{font:11px system-ui,sans-serif;padding:3px 8px;border:1px solid #ccc;border-radius:6px;
  background:#fafafa;color:#222;cursor:pointer}
.lm-assist-drawer button:hover{background:#f0f0f0}
.lm-assist-drawer button.x{border:none;background:none;font-size:16px;line-height:1;padding:0 4px}
.lm-assist-drawer .row{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #eee}
.lm-assist-drawer .row label{width:72px;color:#666}
.lm-assist-drawer select{font:12px system-ui,sans-serif;padding:2px 4px;flex:1}
.lm-assist-drawer input[type=number]{font:12px system-ui,sans-serif;padding:2px 4px;width:64px}
.lm-assist-drawer .notes{max-height:170px;overflow:auto;padding:2px 10px 6px;border-bottom:1px solid #eee}
.lm-assist-drawer .note{display:flex;gap:6px;align-items:flex-start;padding:3px 0;border-top:1px solid #f0f0f0}
.lm-assist-drawer .note:first-child{border-top:none}
.lm-assist-drawer .note .body{flex:1;overflow-wrap:anywhere}
.lm-assist-drawer .note b{color:#444}
.lm-assist-drawer .note .meta{color:#999;font-size:10px}
.lm-assist-drawer .note button.x{font-size:13px;color:#999}
.lm-assist-drawer .notes .empty{color:#999;padding:4px 0}
.lm-assist-drawer .sec{display:flex;align-items:center;gap:8px;padding:6px 10px 2px;color:#666}
.lm-assist-drawer .sec span{flex:1}
.lm-assist-drawer .sec em{font-style:normal;color:#999}
.lm-assist-drawer .sec .tog{cursor:pointer;user-select:none}
.lm-assist-drawer .sec .tog::before{content:'▾ ';color:#999}
.lm-assist-drawer .sec.closed .tog::before{content:'▸ '}
.lm-assist-drawer .row input[type=text]{font:12px system-ui,sans-serif;padding:2px 4px;width:90px}
.lm-assist-drawer .vstatus{margin:4px 10px 8px;border-radius:8px;padding:5px 8px;font-size:11px;line-height:15px;
  background:#f5f5f5;border:1px solid #e5e5e5;color:#555;user-select:text;-webkit-user-select:text}
.lm-assist-drawer .vstatus.note{background:#fff2e8;border-color:#ffd2b3}
.lm-assist-drawer .vstatus summary{cursor:pointer;list-style:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-assist-drawer .vstatus summary::-webkit-details-marker{display:none}
.lm-assist-drawer .vstatus summary::before{content:'▸ ';color:#999}
.lm-assist-drawer .vstatus[open] summary::before{content:'▾ '}
.lm-assist-drawer .vstatus summary.plain{cursor:default}
.lm-assist-drawer .vstatus summary.plain::before{content:''}
.lm-assist-drawer .vstatus .body{margin-top:4px;overflow-wrap:anywhere;color:#444}
.lm-assist-drawer .row input.num{font:12px system-ui,sans-serif;padding:2px 4px;width:44px}
.lm-assist-drawer .row .lbl{color:#666}
.lm-assist-drawer textarea{margin:4px 10px 8px;height:170px;resize:vertical;font:11px ui-monospace,Menlo,monospace;
  padding:6px;border:1px solid #ddd;border-radius:6px;line-height:1.4}
.lm-assist-drawer .log{flex:1;overflow:auto;padding:4px 10px 12px;border-top:1px solid #eee;display:flex;
  flex-direction:column;gap:6px}
.lm-assist-drawer .e{border-radius:8px;padding:6px 8px;max-width:100%;overflow-wrap:anywhere}
.lm-assist-drawer .e.user{background:#f6ecff;border:1px solid #e3c8ff;align-self:flex-start}
.lm-assist-drawer .e.model{background:#fff2e8;border:1px solid #ffd2b3;align-self:flex-end}
.lm-assist-drawer .e.tool{background:#f5f5f5;border:1px solid #e5e5e5}
.lm-assist-drawer .e.err{background:#fde8e8;border:1px solid #f5b5b5;color:#922}
.lm-assist-drawer .e.meta{color:#999;font-size:11px;padding:0 2px}
.lm-assist-drawer .e .who{font-weight:600;margin-bottom:2px;color:#555}
.lm-assist-drawer .e pre{margin:4px 0 0;white-space:pre-wrap;font:11px ui-monospace,Menlo,monospace;max-height:260px;overflow:auto}
.lm-assist-drawer .e img{display:block;max-width:100%;max-height:200px;width:auto;border:1px solid #ddd;border-radius:4px;margin-top:4px}
.lm-assist-drawer details summary{cursor:pointer;color:#555}
`;

export class AssistUI {
  readonly badge: HTMLButtonElement;
  readonly ff: HTMLButtonElement;
  readonly drawer: HTMLDivElement;
  private readonly badgeText: HTMLSpanElement;
  private readonly log: HTMLDivElement;
  private readonly promptArea: HTMLTextAreaElement;
  private readonly promptNote: HTMLElement;
  private readonly keyNote: HTMLElement;
  private readonly modelSelect: HTMLSelectElement;
  private readonly turnsInput: HTMLInputElement;
  private readonly effortSelect: HTMLSelectElement;
  private readonly voiceMode: HTMLSelectElement;
  private readonly voiceName: HTMLInputElement;
  private readonly voiceStatus: HTMLDetailsElement;
  private readonly voiceStatusSummary: HTMLElement;
  private readonly voiceStatusBody: HTMLElement;
  private readonly voiceModel: HTMLSelectElement;
  private settingInputs: Map<string, HTMLInputElement> = new Map();
  private readonly notesEl: HTMLDivElement;
  private saveTimer: number | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly hooks: UiHooks,
  ) {
    if (!document.getElementById('lm-assist-style')) {
      const style = document.createElement('style');
      style.id = 'lm-assist-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.badge = el('button', 'lm-assist-badge');
    this.badge.type = 'button';
    this.badge.title = 'Talk & Draw: open the drawer';
    this.badge.dataset.state = 'idle';
    this.badge.appendChild(el('span', 'dot'));
    this.badgeText = el('span', 'text');
    this.badgeText.textContent = IDLE_TEXT;
    this.badge.appendChild(this.badgeText);
    this.badge.addEventListener('click', () => this.toggleDrawer());
    container.appendChild(this.badge);

    this.ff = el('button', 'lm-assist-ff');
    this.ff.type = 'button';
    this.ff.textContent = '⏩';
    this.ff.title = 'Skip ahead: cut the speech, finish the animations';
    this.ff.hidden = true;
    this.ff.addEventListener('click', () => {
      hooks.fastForward();
      this.ff.classList.add('on');
    });
    container.appendChild(this.ff);

    const d = (this.drawer = el('div', 'lm-assist-drawer'));
    d.hidden = true;

    const hd = el('div', 'hd');
    const h2 = document.createElement('h2');
    h2.textContent = 'Talk & Draw';
    hd.appendChild(h2);
    hd.appendChild(button('Re-send last', () => hooks.resend()));
    hd.appendChild(button('Cancel', () => hooks.cancel()));
    const x = button('×', () => this.toggleDrawer(false));
    x.className = 'x';
    hd.appendChild(x);
    d.appendChild(hd);

    const modelRow = el('div', 'row');
    const ml = document.createElement('label');
    ml.textContent = 'Model';
    modelRow.appendChild(ml);
    this.modelSelect = document.createElement('select');
    for (const m of hooks.models) {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m;
      this.modelSelect.appendChild(o);
    }
    this.modelSelect.addEventListener('change', () => hooks.setModel(this.modelSelect.value));
    modelRow.appendChild(this.modelSelect);
    d.appendChild(modelRow);

    const effortRow = el('div', 'row');
    const el0 = document.createElement('label');
    el0.textContent = 'Effort';
    effortRow.appendChild(el0);
    this.effortSelect = document.createElement('select');
    for (const e of hooks.efforts) {
      const o = document.createElement('option');
      o.value = e;
      o.textContent = e;
      this.effortSelect.appendChild(o);
    }
    this.effortSelect.addEventListener('change', () => hooks.setEffort(this.effortSelect.value));
    effortRow.appendChild(this.effortSelect);
    const enote = el('span', '');
    enote.style.color = '#999';
    enote.textContent = 'low = quickest replies';
    effortRow.appendChild(enote);
    d.appendChild(effortRow);

    const turnsRow = el('div', 'row');
    const tl0 = document.createElement('label');
    tl0.textContent = 'Max turns';
    turnsRow.appendChild(tl0);
    this.turnsInput = document.createElement('input');
    this.turnsInput.type = 'number';
    this.turnsInput.min = '1';
    this.turnsInput.max = '200';
    this.turnsInput.addEventListener('change', () => {
      hooks.setMaxTurns(Number(this.turnsInput.value) || null);
      this.turnsInput.value = String(hooks.getMaxTurns());
    });
    turnsRow.appendChild(this.turnsInput);
    const tnote = el('span', '');
    tnote.style.color = '#999';
    tnote.textContent = 'model calls per request';
    turnsRow.appendChild(tnote);
    d.appendChild(turnsRow);

    const keyRow = el('div', 'row');
    const kl = document.createElement('label');
    kl.textContent = 'API key';
    keyRow.appendChild(kl);
    this.keyNote = el('span', '');
    this.keyNote.style.flex = '1';
    keyRow.appendChild(this.keyNote);
    keyRow.appendChild(
      button('Set…', () => {
        hooks.askApiKey();
        this.refresh();
      }),
    );
    keyRow.appendChild(
      button('Clear', () => {
        hooks.clearApiKey();
        this.refresh();
      }),
    );
    d.appendChild(keyRow);

    const voiceRow = el('div', 'row');
    const vl = document.createElement('label');
    vl.textContent = 'Voice';
    voiceRow.appendChild(vl);
    this.voiceMode = document.createElement('select');
    this.voiceMode.style.flex = '0 0 auto';
    this.voiceMode.title = 'ElevenLabs (browser voice as fallback), the browser voice, or mute — muted, speech shows as bubbles';
    const modeLabels: Record<string, string> = { elevenlabs: 'ElevenLabs', browser: 'browser voice', mute: 'mute (bubbles)' };
    for (const m of hooks.voice.modes) {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = modeLabels[m] ?? m;
      this.voiceMode.appendChild(o);
    }
    this.voiceMode.addEventListener('change', () => {
      hooks.voice.setMode(this.voiceMode.value);
      if (this.voiceMode.value === 'elevenlabs' && !hooks.voice.hasKey()) hooks.voice.ensureKey();
      this.refresh();
    });
    voiceRow.appendChild(this.voiceMode);
    this.voiceName = document.createElement('input');
    this.voiceName.type = 'text';
    this.voiceName.placeholder = 'voice name or ID';
    this.voiceName.title = 'A premade ElevenLabs voice (rachel, sarah, laura, charlie, george, callum, river, liam, alice, matilda, will, jessica, eric, chris, brian, daniel, lily, bill), a voice in your My Voices, or a voice ID. Library voices like Hope need a paid plan.';
    this.voiceName.addEventListener('change', () => {
      hooks.voice.setVoiceName(this.voiceName.value);
      this.refresh();
    });
    voiceRow.appendChild(this.voiceName);
    this.voiceModel = document.createElement('select');
    this.voiceModel.title = 'ElevenLabs model: flash = fastest; turbo = same price, better; multilingual v2 = best, twice the price';
    for (const m of hooks.voice.models) {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m.replace('eleven_', '').replace(/_/g, ' ');
      this.voiceModel.appendChild(o);
    }
    this.voiceModel.style.flex = '0 0 auto';
    this.voiceModel.addEventListener('change', () => {
      hooks.voice.setModel(this.voiceModel.value);
      this.refresh();
    });
    voiceRow.appendChild(this.voiceModel);
    voiceRow.appendChild(
      button('Key…', () => {
        hooks.voice.askKey();
        this.refresh();
      }),
    );
    d.appendChild(voiceRow);
    // Stability / similarity / style, like the website's sliders; blank = the voice's default.
    const setRow = el('div', 'row');
    const sl = document.createElement('label');
    sl.textContent = 'Voice tuning';
    setRow.appendChild(sl);
    const fields: [keyof ReturnType<typeof hooks.voice.getSettings>, string][] = [
      ['stability', 'stability'],
      ['similarity_boost', 'similarity'],
      ['style', 'style'],
    ];
    const inputs = new Map<string, HTMLInputElement>();
    for (const [key, label] of fields) {
      const l = el('span', 'lbl');
      l.textContent = label;
      setRow.appendChild(l);
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'num';
      inp.min = '0';
      inp.max = '1';
      inp.step = '0.05';
      inp.title = `${label}, 0 to 1 (website defaults: stability 0.5, similarity 0.75, style 0); blank restores the default`;
      inp.addEventListener('change', () => {
        const v: Record<string, number | undefined> = {};
        for (const [k] of fields) {
          const raw = inputs.get(k)!.value.trim();
          v[k] = raw === '' ? undefined : Number(raw);
        }
        hooks.voice.setSettings(v);
      });
      inputs.set(key, inp);
      setRow.appendChild(inp);
    }
    setRow.appendChild(
      button('Restore defaults', () => {
        hooks.voice.setSettings({});
        this.refresh();
      }),
    );
    d.appendChild(setRow);
    this.settingInputs = inputs;
    // The voice's state: one line, expandable when there is something to explain.
    this.voiceStatus = document.createElement('details');
    this.voiceStatus.className = 'vstatus';
    this.voiceStatusSummary = document.createElement('summary');
    this.voiceStatus.appendChild(this.voiceStatusSummary);
    this.voiceStatusBody = el('div', 'body');
    this.voiceStatus.appendChild(this.voiceStatusBody);
    d.appendChild(this.voiceStatus);
    this.voiceStatusSummary.addEventListener('click', (e) => {
      if (this.voiceStatusSummary.classList.contains('plain')) e.preventDefault();
    });

    const ps = el('div', 'sec');
    const pl = document.createElement('span');
    const ptog = el('span', 'tog');
    ptog.textContent = 'System prompt ';
    pl.appendChild(ptog);
    this.promptNote = document.createElement('em');
    pl.appendChild(this.promptNote);
    ps.appendChild(pl);
    ps.appendChild(
      button('Restore default', () => {
        hooks.setSystemPrompt(null);
        this.refresh();
      }),
    );
    d.appendChild(ps);
    this.promptArea = document.createElement('textarea');
    this.promptArea.spellcheck = false;
    this.promptArea.addEventListener('input', () => {
      if (this.saveTimer != null) clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => {
        hooks.setSystemPrompt(this.promptArea.value);
        this.updatePromptNote();
      }, 300);
    });
    d.appendChild(this.promptArea);
    makeCollapsible('prompt', ps, ptog, [this.promptArea], true);

    const ns = el('div', 'sec');
    const nl = document.createElement('span');
    const ntog = el('span', 'tog');
    ntog.textContent = 'Shared notes ';
    nl.appendChild(ntog);
    const nnote = document.createElement('em');
    nnote.textContent = '(aiNotes in the document)';
    nl.appendChild(nnote);
    ns.appendChild(nl);
    ns.appendChild(button('Refresh', () => this.renderNotes()));
    d.appendChild(ns);
    this.notesEl = el('div', 'notes');
    d.appendChild(this.notesEl);
    makeCollapsible('notes', ns, ntog, [this.notesEl], false);

    const ts = el('div', 'sec');
    const tl = document.createElement('span');
    tl.textContent = 'Transcript';
    ts.appendChild(tl);
    ts.appendChild(button('Clear', () => (this.log.textContent = '')));
    d.appendChild(ts);
    this.log = el('div', 'log');
    d.appendChild(this.log);

    container.appendChild(d);
    this.refresh();
  }

  /** Re-read model, key and prompt from the hooks (after any change). */
  refresh(): void {
    this.modelSelect.value = this.hooks.getModel();
    this.keyNote.textContent = this.hooks.hasApiKey() ? 'set (kept in this browser)' : 'not set — asked for on first use';
    if (document.activeElement !== this.promptArea) this.promptArea.value = this.hooks.getSystemPrompt();
    this.updatePromptNote();
    this.turnsInput.value = String(this.hooks.getMaxTurns());
    this.effortSelect.value = this.hooks.getEffort();
    this.voiceMode.value = this.hooks.voice.getMode();
    if (document.activeElement !== this.voiceName) this.voiceName.value = this.hooks.voice.getVoiceName();
    this.voiceModel.value = this.hooks.voice.getModel();
    const st = this.hooks.voice.getSettings() as Record<string, number | undefined>;
    for (const [k, inp] of this.settingInputs) if (document.activeElement !== inp) inp.value = String(st[k] ?? '');
    const vs = this.hooks.voice.statusDetail();
    this.voiceStatusSummary.textContent = vs.summary;
    this.voiceStatusSummary.title = vs.detail ?? vs.summary;
    this.voiceStatusSummary.classList.toggle('plain', !vs.detail);
    this.voiceStatusBody.textContent = vs.detail ?? '';
    this.voiceStatusBody.hidden = !vs.detail;
    if (!vs.detail) this.voiceStatus.open = false;
    this.voiceStatus.classList.toggle('note', vs.kind === 'note');
    this.renderNotes();
  }

  renderNotes(): void {
    let notes: Note[] = [];
    try {
      notes = this.hooks.getNotes();
    } catch {
      notes = [];
    }
    this.notesEl.textContent = '';
    if (notes.length === 0) {
      const e = el('div', 'empty');
      e.textContent = 'None yet — agents add notes as they learn the UI.';
      this.notesEl.appendChild(e);
      return;
    }
    for (const n of notes) {
      const row = el('div', 'note');
      const body = el('div', 'body');
      const b = document.createElement('b');
      b.textContent = n.topic + ': ';
      body.appendChild(b);
      body.appendChild(document.createTextNode(n.text));
      if (n.author || n.when) {
        const meta = el('div', 'meta');
        meta.textContent = [n.author, n.when?.slice(0, 10)].filter(Boolean).join(' · ');
        body.appendChild(meta);
      }
      row.appendChild(body);
      const x = button('×', () => {
        this.hooks.forgetNote(n.topic);
        this.renderNotes();
      });
      x.className = 'x';
      x.title = 'Forget this note';
      row.appendChild(x);
      this.notesEl.appendChild(row);
    }
  }

  private updatePromptNote(): void {
    this.promptNote.textContent = this.hooks.getSystemPrompt() === DEFAULT_SYSTEM_PROMPT ? '(default)' : '(edited, saved in this browser)';
  }

  setStatus(text: string | null, state: BadgeState = text ? 'working' : 'idle'): void {
    this.badgeText.textContent = text ?? IDLE_TEXT;
    this.badge.dataset.state = state;
    // The skip-ahead button only exists while the model's response is playing.
    this.ff.hidden = state !== 'working';
    if (state !== 'working') this.ff.classList.remove('on');
    this.placeButtons();
  }

  private placeButtons(): void {
    const open = !this.drawer.hidden;
    const base = open ? Math.round(this.drawer.getBoundingClientRect().width) + 12 : 12;
    this.badge.style.right = open ? `${base}px` : '';
    this.ff.style.right = `${base + Math.round(this.badge.getBoundingClientRect().width) + 8}px`;
  }

  toggleDrawer(open?: boolean): void {
    const show = open ?? this.drawer.hidden;
    this.drawer.hidden = !show;
    this.badge.classList.toggle('drawer-open', show);
    // Tell the rest of the tool (the Workspace drawer and button) how much of the
    // right side is ours: the same width rule as the drawer's CSS, so it tracks resizes.
    this.container.style.setProperty('--lm-assist-drawer-w', show ? 'max(33.333%, 340px)' : '0px');
    // Keep the badge (and the skip button) just left of the drawer, whatever width it got.
    this.placeButtons();
    if (show) this.refresh();
  }

  isDrawerOpen(): boolean {
    return !this.drawer.hidden;
  }

  // ---- transcript ------------------------------------------------------------

  logEvent(e: AgentEvent): void {
    // Follow new entries only when the reader is already at the bottom; otherwise
    // leave them where they are reading.
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
    switch (e.kind) {
      case 'start': {
        const m = e.message;
        const n = this.entry('user', 'You');
        const lines = [
          `model ${e.model} · canvas ${m.canvas.width}x${m.canvas.height} → ${m.image.width}x${m.image.height}`,
          m.transcriptStatus === 'whisper' ? `“${m.transcriptText ?? ''}”` : `transcript ${m.transcriptStatus}`,
        ];
        n.appendChild(text(lines.join('\n')));
        n.appendChild(pre(m.timeline));
        const det = document.createElement('details');
        const sum = document.createElement('summary');
        sum.textContent = `${e.notes.length} shared note(s) sent`;
        det.appendChild(sum);
        det.appendChild(pre(e.notes.length ? e.notes.map((x) => `- ${x.topic}: ${x.text}`).join('\n') : '(none)'));
        n.appendChild(det);
        for (const img of m.images) n.appendChild(thumb(img.dataUrl, img.label));
        break;
      }
      case 'request':
        this.meta(`turn ${e.turn + 1} → model…`);
        break;
      case 'response':
        this.meta(
          `← ${e.stopReason ?? '?'} · ${(e.ms / 1000).toFixed(1)}s · ${e.inputTokens} in (+${e.cachedTokens} cached) / ${e.outputTokens} out` +
            (e.servedBy ? ` · served by ${e.servedBy}` : ''),
        );
        break;
      case 'text': {
        const n = this.entry('model', 'Claude');
        n.appendChild(text(e.text));
        break;
      }
      case 'tool_use': {
        const n = this.entry('tool', '');
        const det = document.createElement('details');
        const sum = document.createElement('summary');
        const input = (e.input ?? {}) as Record<string, unknown>;
        let label = `tool ${e.name}`;
        if (e.name === 'perform' && Array.isArray(input.steps)) label += ` · ${input.steps.length} steps`;
        if (e.name === 'eval' && typeof input.source === 'string') label += ` · ${input.source.slice(0, 60)}`;
        sum.textContent = label;
        det.appendChild(sum);
        det.appendChild(pre(e.name === 'eval' && typeof input.source === 'string' ? input.source : JSON.stringify(input, null, 1)));
        n.appendChild(det);
        break;
      }
      case 'tool_result': {
        const n = this.entry(e.isError ? 'err' : 'tool', '');
        const det = document.createElement('details');
        const sum = document.createElement('summary');
        sum.textContent = `${e.isError ? 'error from' : 'result of'} ${e.name}`;
        det.appendChild(sum);
        if (e.text) det.appendChild(pre(e.text.length > 4000 ? e.text.slice(0, 4000) + '…' : e.text));
        for (const img of e.images) det.appendChild(thumb(img, 'screenshot'));
        if (e.name === 'eval' || e.isError) det.open = true;
        n.appendChild(det);
        if (e.name !== 'eval' && !e.isError && e.images[0]) n.appendChild(thumb(e.images[0], 'screenshot'));
        break;
      }
      case 'error': {
        const n = this.entry('err', 'Error');
        n.appendChild(text(e.text));
        break;
      }
      case 'done':
        this.meta(`done (${e.reason})`);
        this.renderNotes();
        break;
    }
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
    while (this.log.childElementCount > 400) this.log.firstElementChild?.remove();
  }

  private entry(cls: string, who: string): HTMLDivElement {
    const n = el('div', `e ${cls}`);
    if (who) {
      const w = el('div', 'who');
      w.textContent = who;
      n.appendChild(w);
    }
    this.log.appendChild(n);
    return n;
  }

  private meta(s: string): void {
    const n = el('div', 'e meta');
    n.textContent = s;
    this.log.appendChild(n);
  }

  dispose(): void {
    if (this.saveTimer != null) clearTimeout(this.saveTimer);
    this.container.style.removeProperty('--lm-assist-drawer-w');
    this.badge.remove();
    this.ff.remove();
    this.drawer.remove();
  }
}

/** Clicking `toggle` hides/shows `body`; the state is remembered per browser. */
function makeCollapsible(key: string, header: HTMLElement, toggle: HTMLElement, body: HTMLElement[], defaultClosed: boolean): void {
  const apply = (closed: boolean) => {
    header.classList.toggle('closed', closed);
    for (const b of body) b.hidden = closed;
  };
  apply(collapsed()[key] ?? defaultClosed);
  toggle.addEventListener('click', () => {
    const closed = !header.classList.contains('closed');
    setCollapsed(key, closed);
    apply(closed);
  });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function text(s: string): HTMLDivElement {
  const n = document.createElement('div');
  n.style.whiteSpace = 'pre-wrap';
  n.textContent = s;
  return n;
}

function pre(s: string): HTMLPreElement {
  const n = document.createElement('pre');
  n.textContent = s;
  return n;
}

function thumb(dataUrl: string, alt: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = alt;
  img.title = alt;
  img.loading = 'lazy';
  return img;
}
