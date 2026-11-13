/**
 * Talk & Draw for all of Patchwork.
 *
 * Registered as an unlisted "*" title-bar tool (id `talk-and-draw`: add it under
 * Settings → Doc titlebar in patchwork-frame) and as a `patchwork:component` tagged
 * "system-tray" (id `talk-and-draw-tray`; the tiling frame mounts those itself) — the
 * universal-dnd pattern, with distinct ids since the registry is keyed by id. Being mounted anywhere
 * imports this module, and importing it installs Talk & Draw once for the whole page:
 * a full-viewport ink overlay, the badge + drawer, ctrl-space / cmd-space to start a
 * session, Esc to finish.
 *
 * Preloading, so the first question doesn't wait: the mic permission and the Whisper
 * model are requested as soon as this loads; the tab capture (screenshots) on the
 * first click or keypress, since Chrome only allows it from a user gesture.
 *
 * When Patchwork reloads this module (its folder doc changed — e.g. Talk & Draw fixed
 * itself), the new version replaces the old install, keeping the running tab capture.
 */
import { startAssist, type AssistHandle } from './session';
import { Screen } from './screen';
import { loadWhisper } from './transcribe';
import { loadNotesDoc, notesUrl, setNotesUrl } from './notes';
import { tad, evaluate } from './tad';

interface Install {
  screen: Screen;
  handle: AssistHandle;
  root: HTMLElement;
  whisper: string;
  mic: string;
  listeners: Set<() => void>;
  dispose(keepScreen?: boolean): void;
}

const KEY = '__patchworkTalkAndDraw';

function changed(inst: Install): void {
  for (const fn of inst.listeners) fn();
}

function preloadMic(inst: Install): void {
  if (!navigator.mediaDevices?.getUserMedia) {
    inst.mic = 'unavailable';
    return;
  }
  inst.mic = 'asking';
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      // Permission is what we wanted; don't keep the mic open.
      stream.getTracks().forEach((t) => t.stop());
      inst.mic = 'ok';
      changed(inst);
    })
    .catch((err) => {
      inst.mic = `refused (${err?.message ?? err})`;
      changed(inst);
    });
}

function preloadWhisper(inst: Install): void {
  inst.whisper = 'loading';
  loadWhisper((p) => {
    inst.whisper = p;
    changed(inst);
  })
    .then(({ device }) => {
      inst.whisper = `ready (${device})`;
      changed(inst);
    })
    .catch((err) => {
      inst.whisper = `failed: ${err?.message ?? err}`;
      console.warn('Talk & Draw: Whisper preload failed', err);
      changed(inst);
    });
}

function install(): Install {
  const w = window as any;
  const prev: Install | undefined = w[KEY];
  // A reload of this module: take over from the old version, keeping its capture.
  const screen = prev?.screen && typeof prev.screen.draw === 'function' ? prev.screen : new Screen();
  prev?.dispose(true);

  const root = document.createElement('div');
  root.dataset.pwTad = '';
  root.className = 'pw-tad-root';
  Object.assign(root.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '2147483600' });
  document.body.appendChild(root);

  const handle = startAssist(screen, root);
  const inst: Install = {
    screen,
    handle,
    root,
    whisper: 'idle',
    mic: 'idle',
    listeners: prev?.listeners ?? new Set(),
    dispose(keepScreen = false) {
      offScreen();
      handle.dispose();
      root.remove();
      if (!keepScreen) screen.dispose();
      if (w[KEY] === inst) delete w[KEY];
    },
  };
  const offScreen = screen.onChange(() => changed(inst));
  handle.ui.onStatus(() => changed(inst));
  w[KEY] = inst;

  // Console conveniences.
  w.tad = tad;
  w.talkAndDraw = Object.assign(handle, {
    eval: evaluate,
    screen,
    notesUrl,
    setNotesUrl,
  });

  if (!screen.isLive()) screen.armOnFirstGesture();
  preloadMic(inst);
  preloadWhisper(inst);
  void loadNotesDoc().catch((err) => console.warn('Talk & Draw: notes doc', err));
  console.info('[talk-and-draw] installed — ctrl-space (or cmd-space) to talk & draw, Esc to finish');
  changed(inst);
  return inst;
}

function ensureInstalled(): Install | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const w = window as any;
  if (w[KEY]?.version === VERSION) return w[KEY];
  const inst = install();
  (inst as any).version = VERSION;
  return inst;
}

/** Bumped by every build (module identity is enough: a reload is a new evaluation). */
const VERSION = Symbol('talk-and-draw');

ensureInstalled();

// ---- the tray button ---------------------------------------------------------------

type Cleanup = () => void;

const CSS = `
.pw-tad-tray{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border-radius:12px;
  border:1px solid #b400ff55;background:#fff;color:#333;font:12px system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.pw-tad-tray:hover{background:#f6edff}
.pw-tad-tray .label{max-width:300px;overflow:hidden;text-overflow:ellipsis}
.pw-tad-wrap{display:inline-flex;align-items:center;gap:4px}
.pw-tad-skip,.pw-tad-stop{width:24px;height:24px;padding:0;border-radius:50%;border:1px solid #ff6a00;background:#fff;
  color:#ff6a00;font:11px system-ui,sans-serif;line-height:22px;text-align:center;cursor:pointer}
.pw-tad-skip:hover,.pw-tad-stop:hover{background:#fff2e8}
.pw-tad-skip.on{background:#ff6a00;color:#fff}
.pw-tad-stop{border-color:#d33;color:#d33}
.pw-tad-stop:hover{background:#fdecec}
.pw-tad-skip[hidden],.pw-tad-stop[hidden]{display:none}
.pw-tad-tray .dot{width:7px;height:7px;border-radius:50%;background:#aaa}
.pw-tad-tray[data-capture=live] .dot{background:#2a2}
.pw-tad-tray[data-capture=asking] .dot{background:#fa0}
.pw-tad-tray[data-capture=denied] .dot,.pw-tad-tray[data-capture=unsupported] .dot{background:#d33}
.pw-tad-tray[data-state=listening]{border-color:#b400ff}
.pw-tad-tray[data-state=listening] .dot{background:#b400ff;animation:pw-tad-tray-pulse 1.2s ease-in-out infinite}
.pw-tad-tray[data-state=working]{border-color:#ff6a00}
.pw-tad-tray[data-state=working] .dot{background:#ff6a00;animation:pw-tad-tray-pulse 1.2s ease-in-out infinite}
@keyframes pw-tad-tray-pulse{0%,100%{opacity:1}50%{opacity:.35}}
`;

/** Titlebar/tray buttons currently mounted (several panels may each have one). */
const mounted = new Set<HTMLElement>();

function mountTray(element: HTMLElement): Cleanup {
  const inst = ensureInstalled();
  if (!inst) return () => {};
  if (!document.getElementById('pw-tad-tray-style')) {
    const st = document.createElement('style');
    st.id = 'pw-tad-tray-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-tad-tray';
  btn.dataset.pwTad = '';
  btn.innerHTML = '<span class="dot"></span><span class="label">Talk &amp; Draw</span>';
  const label = btn.querySelector('.label') as HTMLElement;
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'pw-tad-skip';
  skip.dataset.pwTad = '';
  skip.textContent = '⏩';
  skip.title = 'Skip ahead: cut the speech, finish the animations';
  skip.hidden = true;
  skip.addEventListener('click', () => {
    const cur = (window as any)[KEY] as Install | undefined;
    if (cur) cur.handle.executor.fastForward = true;
    skip.classList.add('on');
  });
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'pw-tad-stop';
  stop.dataset.pwTad = '';
  stop.textContent = '■';
  stop.title = 'Stop: cancel what the agent is doing (or press Esc)';
  stop.hidden = true;
  stop.addEventListener('click', () => {
    ((window as any)[KEY] as Install | undefined)?.handle.cancel();
  });
  const wrap = document.createElement('span');
  wrap.className = 'pw-tad-wrap';
  wrap.dataset.pwTad = '';
  wrap.append(btn, skip, stop);
  // Styles injected into document.head don't reach a shadow root; inline the basics.
  const local = document.createElement('style');
  local.textContent = CSS;
  const render = () => {
    const cur = (window as any)[KEY] as Install | undefined;
    const s = cur?.screen;
    btn.dataset.capture = s?.state ?? 'idle';
    const state = cur?.handle.ui.state ?? 'idle';
    const text = cur?.handle.ui.statusText ?? null;
    btn.dataset.state = state;
    label.textContent = text ? text.replace(/^Talk & Draw — /, '') : 'Talk & Draw';
    skip.hidden = state !== 'working';
    stop.hidden = state !== 'working';
    if (skip.hidden) skip.classList.remove('on');
    cur?.handle.ui.setIdleHidden(mounted.size > 0);
    btn.title = [
      'Talk & Draw — ctrl-space (or cmd-space) to start, Esc to finish. Click for the drawer.',
      ...(text ? [text] : []),
      `Screen capture: ${s?.state ?? '?'}${s?.error ? ` (${s.error})` : ''}`,
      `Microphone: ${cur?.mic ?? '?'}`,
      `Whisper: ${cur?.whisper ?? '?'}`,
    ].join('\n');
  };
  btn.addEventListener('click', () => {
    const cur = (window as any)[KEY] as Install | undefined;
    if (!cur) return;
    if (!cur.screen.isLive()) void cur.screen.start();
    cur.handle.drawer();
  });
  inst.listeners.add(render);
  mounted.add(btn);
  render();
  element.appendChild(local);
  element.appendChild(wrap);
  return () => {
    inst.listeners.delete(render);
    mounted.delete(btn);
    ((window as any)[KEY] as Install | undefined)?.handle.ui.setIdleHidden(mounted.size > 0);
    wrap.remove();
    local.remove();
  };
}

const componentRender = (element: HTMLElement): Cleanup => mountTray(element);
const toolRender = (_handle: unknown, element: HTMLElement): Cleanup => {
  element.style.width = 'fit-content';
  return mountTray(element);
};

export const plugins = [
  {
    type: 'patchwork:component' as const,
    id: 'talk-and-draw-tray',
    name: 'Talk & Draw',
    icon: 'PenLine',
    tags: ['system-tray'] as const,
    load: async () => componentRender,
  },
  {
    type: 'patchwork:tool' as const,
    id: 'talk-and-draw',
    name: 'Talk & Draw',
    icon: 'PenLine',
    supportedDatatypes: '*' as const,
    unlisted: true,
    forTitleBar: true,
    tags: ['titlebar-tool'] as const,
    load: async () => toolRender,
  },
];
