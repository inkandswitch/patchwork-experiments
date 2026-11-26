// @vitest-environment node
//
// The Node executor with real worker threads, each running a stand-in for
// run-thread.mjs that does what its job's importUrl says. What is checked:
// `exit` is said once per thread whatever ends it, `terminate` ends a thread
// that never yields, no two live threads are given one slot directory, and
// `settled` reaches a thread after the job it is about.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeExecutor } from './executor';
import type { Job, WorkerEvents } from '../pool';

const dir = mkdtempSync(join(tmpdir(), 'tasks-executor-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const STAND_IN = `
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (m) => {
  if (m.type === 'settings') {
    parentPort.postMessage({ type: 'log', message: 'dir ' + m.settings.place.storageDir });
  } else if (m.type === 'job') {
    const what = m.job.importUrl;
    if (what === 'return') parentPort.postMessage({ type: 'done', result: m.task ? m.task.length : null });
    if (what === 'hold') parentPort.postMessage({ type: 'log', message: 'job ' + m.job.runId });
    if (what === 'spin') for (;;) {}
    if (what === 'crash') setTimeout(() => { throw new Error('escaped'); });
    if (what === 'exit') process.exit(3);
    if (what === 'grow') { const kept = []; for (;;) kept.push(new Array(1e5).fill(Math.random())); }
  } else if (m.type === 'abort') {
    parentPort.postMessage({ type: 'log', message: 'aborted ' + m.reason });
  } else if (m.type === 'settled') {
    parentPort.postMessage({ type: 'log', message: 'settled ' + m.run });
  }
});
`;
const script = (name: string, source: string) => {
  const file = join(dir, name);
  writeFileSync(file, source);
  return pathToFileURL(file);
};
const standIn = script('stand-in.mjs', STAND_IN);
const throwsAtStart = script('throws.mjs', "throw new Error('cannot start');");

const job = (importUrl: string): Job => ({
  taskUrl: 'automerge:2KYqboWHPS5rvWsheoLnHgFvE7ou' as Job['taskUrl'],
  runId: 'run-1',
  importUrl,
  input: null,
  key: 'k',
});

function executor(scriptUrl = standIn, maxHeapMb?: number, bytesAfterMs = 0) {
  return new NodeExecutor({
    script: scriptUrl,
    maxHeapMb,
    dataDir: dir,
    settings: { repoConfig: { syncServerUrl: 'wss://nowhere.invalid' }, place: {} },
    taskBytes: async () => {
      if (bytesAfterMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, bytesAfterMs));
      }
      return new Uint8Array([1, 2, 3]);
    },
  });
}

/** Events that record what was said, and resolve `exited` at the first `exit`. */
function recorder() {
  const said: string[] = [];
  let exits = 0;
  let exited!: () => void;
  const gone = new Promise<void>((resolve) => (exited = resolve));
  const events: WorkerEvents = {
    log: (message) => said.push(`log ${message}`),
    progress: (value) => said.push(`progress ${value}`),
    done: (result) => said.push(`done ${result}`),
    threw: (message) => said.push(`threw ${message}`),
    exit: () => {
      exits++;
      said.push('exit');
      exited();
    },
  };
  return { events, said, gone, exits: () => exits };
}

const until = async (test: () => boolean, ms = 5_000) => {
  const t0 = Date.now();
  while (!test()) {
    if (Date.now() - t0 > ms) {
      throw new Error('not in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const aMoment = () => new Promise((resolve) => setTimeout(resolve, 200));

describe('the Node executor', () => {
  it('hands a job over with the task, hears it end, and says exit once when terminated, twice over', async () => {
    const pool = executor();
    const r = recorder();
    const worker = pool.start(r.events);
    worker.run(job('return'));
    await until(() => r.said.includes('done 3'));
    worker.terminate();
    worker.terminate();
    await r.gone;
    await aMoment();
    expect(r.exits()).toBe(1);
    expect(pool.threads).toBe(0);
  });

  it('ends a thread that never yields, after passing on the abort in turn', async () => {
    const pool = executor();
    const r = recorder();
    const worker = pool.start(r.events);
    worker.run(job('spin'));
    worker.abort('cancelled'); // queued behind the job: the spinning thread never reads it
    await aMoment();
    const t0 = Date.now();
    worker.terminate();
    await r.gone;
    expect(Date.now() - t0).toBeLessThan(2_000);
    await aMoment();
    expect(r.exits()).toBe(1);
    expect(r.said.some((line) => line.startsWith('done') || line.startsWith('threw'))).toBe(false);
  });

  // A thread that ends by itself says why, if it can, and then exit, once.
  const endings: [string, string | null, RegExp | null][] = [
    ['an error escaping its code', 'crash', /its worker crashed: escaped/],
    ['its code calling process.exit', 'exit', null],
  ];
  for (const [what, importUrl, logged] of endings) {
    it(`says exit once for ${what}`, async () => {
      const pool = executor();
      const r = recorder();
      const worker = pool.start(r.events);
      worker.run(job(importUrl!));
      await r.gone;
      await aMoment();
      expect(r.exits()).toBe(1);
      if (logged) {
        expect(r.said.some((line) => logged.test(line))).toBe(true);
      }
      expect(r.said.at(-1)).toBe('exit');
      expect(pool.threads).toBe(0);
    });
  }

  it('ends only its own thread when a task outgrows the heap ceiling, and says exit once', async () => {
    const pool = executor(standIn, 64);
    const r = recorder();
    const worker = pool.start(r.events);
    worker.run(job('grow'));
    await r.gone;
    await aMoment();
    expect(r.exits()).toBe(1);
    expect(r.said.some((line) => /^log its worker crashed: .*memory/i.test(line))).toBe(true);
    expect(r.said.at(-1)).toBe('exit');
    expect(pool.threads).toBe(0);
    // this process is still here, and a thread started after it works
    const again = recorder();
    const next = pool.start(again.events);
    next.run(job('return'));
    await until(() => again.said.includes('done 3'));
    next.terminate();
    await again.gone;
  }, 30_000);

  it('says exit once for a thread whose script throws before it is up, or is not there', async () => {
    for (const url of [throwsAtStart, pathToFileURL(join(dir, 'missing.mjs'))]) {
      const pool = executor(url);
      const r = recorder();
      const worker = pool.start(r.events);
      worker.run(job('return'));
      await r.gone;
      worker.terminate();
      await aMoment();
      expect(r.exits()).toBe(1);
      expect(r.said[0]).toMatch(/^log its worker crashed/);
      expect(pool.threads).toBe(0);
    }
  });

  it('passes settled on after the job it is about, though the task takes a moment to read', async () => {
    // The task's document is read before the job is told: a settle said at
    // once would overtake the job were it not told in turn.
    const pool = executor(standIn, undefined, 200);
    const r = recorder();
    const worker = pool.start(r.events);
    worker.run(job('hold'));
    worker.settle('run-1');
    await until(() => r.said.includes('log settled run-1'));
    expect(r.said.filter((line) => /^log (job|settled) /.test(line))).toEqual(['log job run-1', 'log settled run-1']);
    worker.terminate();
    await r.gone;
  });

  it('never gives two live threads one directory: a replacement started before the old one has gone takes another', async () => {
    const pool = executor();
    const dirOf = (r: ReturnType<typeof recorder>) => r.said.find((line) => line.startsWith('log dir '))?.slice('log dir '.length);
    const a = recorder();
    const first = pool.start(a.events);
    first.run(job('spin'));
    await until(() => !!dirOf(a));
    // the pool's stop path: terminate, and start the next at once
    first.terminate();
    const b = recorder();
    const second = pool.start(b.events);
    await until(() => !!dirOf(b));
    expect(dirOf(a)).toBe(join(dir, 'slots', '0'));
    expect(dirOf(b)).toBe(join(dir, 'slots', '1'));
    await a.gone;
    // once the first has gone, its directory is the lowest free one again
    const c = recorder();
    const third = pool.start(c.events);
    await until(() => !!dirOf(c));
    expect(dirOf(c)).toBe(join(dir, 'slots', '0'));
    second.terminate();
    third.terminate();
    await Promise.all([b.gone, c.gone]);
    expect(pool.threads).toBe(0);
  });
});
