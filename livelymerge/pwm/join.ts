/**
 * PWM agent join CLI — open a Patchwork/Automerge world and eval LM source.
 *
 * Usage:
 *   PWM_DOC_URL=automerge:... PWM_SYNC_URL=wss://host pnpm pwm:hello
 *   pnpm pwm:eval --url automerge:... --sync wss://host --code '1+1'
 *   pnpm pwm:eval --url automerge:... --file pwm/moveHello.js
 *   pnpm pwm:eval --url automerge:... --replace WorldMorph --fragment pwm/fragments/….js
 *   pnpm pwm:eval --url automerge:... --inbox
 *
 * The live world should already have Morphic loaded (Dan's tab). Prefer arming
 * Lively.$pwm first (see worldSide.js) when using --inbox.
 *
 * --replace uses the runtime's replaceMethod (transpile class fragment → live
 * prototype), the same path as the Morphic system browser.
 */
// MUST run before @automerge/automerge-repo: slim WASM is uninitialized until the
// node entry's initSync. Same wasm module instance is shared with /slim.
import '@automerge/automerge-subduction';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Repo } from '@automerge/automerge-repo';
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { createLivelymergeRuntime } from '../src/livelymergeRuntime.ts';

const HELLO_SOURCE = `(() => {
  let t = new TextMorph(rect(60, 60, 320, 48), 'Hello from Grok 4.5!');
  Lively.addMorph(t);
  return t;
})()`;

const INBOX_HELLO_SOURCE = `Lively.pwmInbox = Lively.pwmInbox || []; Lively.pwmInbox.push(${JSON.stringify(HELLO_SOURCE)}); 'queued';`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function installBrowserStubs() {
  const g = globalThis as any;
  if (g.canvas) return;

  /** Rough text metrics so MenuMorph.setList / TextBox layout aren't pinned to ~96px. */
  function stubMeasureText(text: unknown) {
    const s = text == null ? '' : String(text);
    // ~sans 14px average advance; good enough for shared menu width sync from headless peers.
    return { width: Math.max(1, s.length * 8) };
  }
  function stubCtx() {
    return {
      font: '14px sans-serif',
      measureText: stubMeasureText,
      save() {},
      restore() {},
      beginPath() {},
      closePath() {},
      fillText() {},
      fillRect() {},
      strokeRect() {},
      clearRect() {},
    };
  }

  g.window = globalThis;
  g.canvas = {
    width: 800,
    height: 600,
    style: {},
    getContext: () => stubCtx(),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
    }),
    addEventListener() {},
    removeEventListener() {},
  };
  g.document = {
    createElement: () => ({
      style: {},
      setAttribute() {},
      appendChild() {},
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      getContext: () => stubCtx(),
    }),
    body: {},
    documentElement: {},
    querySelector: () => g.canvas,
  };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = () => {};
  g.AbortController = class {
    abort() {}
  };
  g.Automerge = g.Automerge || { getActorId: () => 'pwm-agent' };
  g.HTMLImageElement = class {};
  g.HTMLCanvasElement = class {};
  g.Image = class {
    width = 0;
    height = 0;
    set src(_v: string) {}
  };
  g.OffscreenCanvas = class {
    width = 0;
    height = 0;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return stubCtx();
    }
  };
}

export async function joinWorld(opts: {
  docUrl: string;
  syncUrl: string;
  source: string;
  mode?: 'websocket' | 'subduction';
  /** Ms to wait after eval so Subduction can flush ops before we disconnect. */
  flushMs?: number;
}): Promise<{ shown: string }> {
  installBrowserStubs();
  const mode = opts.mode || 'subduction';
  const flushMs = opts.flushMs ?? 8000;
  const repo =
    mode === 'subduction'
      ? new Repo({
          // Keep peer non-ephemeral while connected so local writes are normal
          // Automerge doc ops peers expect to sync (still no disk persistence here).
          isEphemeral: false,
          sharePolicy: async () => true,
          // Patchwork / Ink&Switch default relay
          subductionWebsocketEndpoints: [opts.syncUrl],
        } as any)
      : new Repo({
          network: [new WebSocketClientAdapter(opts.syncUrl)],
          isEphemeral: false,
          sharePolicy: async () => true,
        });

  const handle = await repo.find(opts.docUrl as any);
  if (typeof (handle as any).whenReady === 'function') {
    await (handle as any).whenReady();
  }
  // Extra settle after sync has delivered the doc, before we mutate.
  await new Promise((r) => setTimeout(r, 1500));

  const g = globalThis as any;
  g.handle = handle;
  const rt = createLivelymergeRuntime(handle as any);
  g.runtime = rt;

  // Probe Morphic presence before Hello.
  let livelyOk = false;
  try {
    livelyOk = !!rt.eval(`typeof Lively !== 'undefined' && Lively != null && !!Lively.addMorph`);
  } catch (_) {
    livelyOk = false;
  }
  if (!livelyOk) {
    throw new Error(
      'PWM: joined the doc but Lively/Morphic is not in the heap yet. On your Patchwork tab, eval initUI(); initLively(); (or open Livelymerge so Morphic loads), then retry.',
    );
  }

  // All live authorship must go through runtime.eval (transpile + proxies + change()).
  const result = rt.eval(opts.source);
  const shown =
    typeof (rt as any).formatEvalResult === 'function'
      ? (rt as any).formatEvalResult(result)
      : String(result);

  // Flush: give the network time to push our Automerge ops before tearing down.
  await new Promise((r) => setTimeout(r, flushMs));
  if (typeof (repo as any).flush === 'function') {
    try {
      await (repo as any).flush();
    } catch (_) {
      /* optional */
    }
  }
  if (typeof (repo as any).shutdown === 'function') await (repo as any).shutdown();
  return { shown };
}

function stripLeadingComments(src: string): string {
  const lines = src.split('\n');
  while (lines.length && (lines[0].trim() === '' || lines[0].trim().startsWith('//'))) {
    lines.shift();
  }
  return lines.join('\n').trim();
}

async function main() {
  const docUrl = arg('--url') || process.env.PWM_DOC_URL;
  const syncUrl =
    arg('--sync') || process.env.PWM_SYNC_URL || 'wss://subduction.sync.inkandswitch.com';
  const mode = (arg('--mode') as 'websocket' | 'subduction' | undefined) || 'subduction';
  const flushRaw = arg('--flush-ms');
  const flushMs = flushRaw ? Number(flushRaw) : undefined;
  if (!docUrl) {
    console.error(
      'PWM join needs --url automerge:… (or PWM_DOC_URL).\nOptional: --sync wss://… (default subduction.sync.inkandswitch.com), --mode subduction|websocket, --flush-ms N.',
    );
    process.exit(2);
  }

  let source = arg('--code');
  if (hasFlag('--hello')) source = HELLO_SOURCE;
  if (hasFlag('--inbox')) source = INBOX_HELLO_SOURCE;
  const filePath = arg('--file');
  if (filePath) source = readFileSync(resolve(filePath), 'utf8');

  const replaceClass = arg('--replace');
  const fragmentPath = arg('--fragment');
  if (replaceClass || fragmentPath) {
    if (!replaceClass || !fragmentPath) {
      console.error('PWM --replace needs both --replace ClassName and --fragment path/to/method.js');
      process.exit(2);
    }
    const fragment = stripLeadingComments(readFileSync(resolve(fragmentPath), 'utf8'));
    source = `replaceMethod(${JSON.stringify(replaceClass)}, ${JSON.stringify(fragment)})`;
  }

  if (!source) {
    console.error(
      'Provide --hello, --inbox, --code "…", --file path, or --replace Class --fragment path',
    );
    process.exit(2);
  }

  console.log(`PWM joining ${docUrl} via ${syncUrl} (${mode}) …`);
  try {
    const { shown } = await joinWorld({ docUrl, syncUrl, source, mode, flushMs });
    console.log('PWM eval result:', shown);
    process.exit(0);
  } catch (err) {
    console.error('PWM join failed:', err);
    process.exit(1);
  }
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (/pwm[/\\]join\.ts$/.test(process.argv[1]) || process.argv[1].includes('vite-node'));
if (isDirectRun) {
  main();
}
