import '@automerge/automerge-subduction';
import { Repo } from '@automerge/automerge-repo';
import { createLivelymergeRuntime } from '../src/livelymergeRuntime.ts';

const g = globalThis as any;
g.window = globalThis;
g.canvas = {
  width: 800,
  height: 600,
  style: {},
  getContext: () => ({ measureText: () => ({ width: 10 }), save() {}, restore() {}, beginPath() {}, closePath() {}, fillText() {}, fillRect() {}, strokeRect() {}, clearRect() {} }),
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  addEventListener() {},
  removeEventListener() {},
};
g.document = {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, removeEventListener() {}, focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), getContext: () => g.canvas.getContext() }),
  body: {},
  documentElement: {},
  querySelector: () => g.canvas,
};
g.requestAnimationFrame = () => 1;
g.cancelAnimationFrame = () => {};
g.AbortController = class { abort() {} };
g.Automerge = g.Automerge || { getActorId: () => 'pwm-agent' };
g.HTMLImageElement = class {};
g.HTMLCanvasElement = class {};
g.Image = class { width = 0; height = 0; set src(_v: string) {} };
g.OffscreenCanvas = class {
  width = 0; height = 0;
  constructor(w: number, h: number) { this.width = w; this.height = h; }
  getContext() { return { measureText: () => ({ width: 10 }) }; }
};

async function main() {
  console.log('repo...');
  const repo = new Repo({
    isEphemeral: true,
    sharePolicy: async () => true,
    subductionWebsocketEndpoints: ['wss://subduction.sync.inkandswitch.com'],
  } as any);
  console.log('find...');
  const handle = await repo.find('automerge:HopzoSj1dygjvnnALRARUyCe6ro' as any);
  console.log('whenReady...');
  await (handle as any).whenReady();
  const doc = handle.doc() as any;
  console.log('doc top keys', doc ? Object.keys(doc).slice(0, 30) : null);
  if (doc?.objectTable) console.log('objectTable size', Object.keys(doc.objectTable).length);
  try {
    console.log('createRuntime...');
    const rt = createLivelymergeRuntime(handle as any);
    console.log('eval probe...');
    console.log(rt.eval('1+1'));
    console.log('Lively?', rt.eval(`typeof Lively`));
  } catch (e) {
    console.error('FAILED', e);
  }
  process.exit(0);
}
main();
