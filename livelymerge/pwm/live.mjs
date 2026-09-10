#!/usr/bin/env node
/**
 * PWM live collab CLI — one tool for session-log round trips.
 *
 * Setup (once per machine): Chrome → View → Developer → Allow JavaScript from Apple Events
 *
 * Typical session:
 *   node pwm/live.mjs watch --doc 6NiLqYed
 *     # leave running (one Cursor "Run" approval). Prints PWM_PENDING when Dan speaks.
 *     # Also drains pwm/.live-outbox (agent can Write replies there — no Chrome perms).
 *
 * One-shots (each needs Chrome permission unless watch is already handling outbox):
 *   node pwm/live.mjs pull --doc 6NiLqYed
 *   node pwm/live.mjs reply --doc 6NiLqYed --text 'hello'
 *   node pwm/live.mjs eval --doc 6NiLqYed --code '1+1'
 *   node pwm/live.mjs open --doc 6NiLqYed
 */
import { writeFileSync, readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evalInChrome,
  readSessionLog,
  sessionLogAgent,
  openSessionLog,
  lastHumanPrompt,
} from './liveLib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, '.live');
const LOG_FILE = resolve(STATE_DIR, 'session.log');
const PENDING_FILE = resolve(STATE_DIR, 'pending.txt');
const OUTBOX_FILE = resolve(STATE_DIR, 'outbox');
const STATE_FILE = resolve(STATE_DIR, 'state.json');

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function loadState() {
  ensureStateDir();
  if (!existsSync(STATE_FILE)) return { lastLog: '', lastPendingLine: '' };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastLog: '', lastPendingLine: '' };
  }
}

function saveState(st) {
  ensureStateDir();
  writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
}

function cmdPull(doc) {
  const r = readSessionLog(doc);
  if (!r.ok) {
    console.error('pull failed:', r.error || r.raw);
    process.exit(1);
  }
  const text = r.shown || '';
  ensureStateDir();
  writeFileSync(LOG_FILE, text);
  const pending = lastHumanPrompt(text);
  console.log(text);
  if (pending && !pending.answered) {
    writeFileSync(PENDING_FILE, pending.line + '\n');
    console.error('\nPWM_PENDING:', pending.text);
  } else if (existsSync(PENDING_FILE)) {
    writeFileSync(PENDING_FILE, '');
  }
  return { text, pending };
}

function cmdReply(doc, text) {
  if (!text) {
    console.error('Need --text "…"');
    process.exit(2);
  }
  const r = sessionLogAgent(doc, text);
  console.log(r.raw);
  process.exit(r.ok ? 0 : 1);
}

function cmdEval(doc, code) {
  if (!code) {
    console.error('Need --code "…"');
    process.exit(2);
  }
  const r = evalInChrome(doc, code);
  console.log(r.raw);
  process.exit(r.ok ? 0 : 1);
}

function cmdOpen(doc) {
  const r = openSessionLog(doc);
  console.log(r.raw);
  process.exit(r.ok ? 0 : 1);
}

function drainOutbox(doc) {
  if (!existsSync(OUTBOX_FILE)) return;
  const body = readFileSync(OUTBOX_FILE, 'utf8');
  if (!body.trim()) return;
  // Clear first to avoid double-send on crash mid-send.
  writeFileSync(OUTBOX_FILE, '');
  const chunks = body.split(/\n---\n/).map((s) => s.replace(/\s+$/, '')).filter(Boolean);
  for (const chunk of chunks) {
    if (chunk.startsWith('EVAL\n')) {
      const code = chunk.slice(5);
      const r = evalInChrome(doc, code);
      console.log('PWM_OUTBOX_EVAL', r.ok ? 'ok' : r.error, (r.shown || '').slice(0, 120));
    } else {
      const r = sessionLogAgent(doc, chunk);
      console.log('PWM_OUTBOX_REPLY', r.ok ? 'ok' : r.error, (r.shown || '').slice(0, 120));
    }
  }
}

async function cmdWatch(doc, intervalMs) {
  ensureStateDir();
  console.log('PWM live watch doc=' + doc + ' every ' + intervalMs + 'ms');
  console.log('  session mirror:', LOG_FILE);
  console.log('  pending:', PENDING_FILE);
  console.log('  outbox (Write replies here):', OUTBOX_FILE);
  console.log('PWM_WATCH_READY');

  let st = loadState();
  for (;;) {
    try {
      drainOutbox(doc);
      const r = readSessionLog(doc);
      if (!r.ok) {
        console.error('PWM_WATCH_ERR', r.error || r.raw);
      } else {
        const text = r.shown || '';
        if (text !== st.lastLog) {
          writeFileSync(LOG_FILE, text);
          st.lastLog = text;
          const pending = lastHumanPrompt(text);
          if (pending && !pending.answered && pending.line !== st.lastPendingLine) {
            st.lastPendingLine = pending.line;
            writeFileSync(PENDING_FILE, pending.line + '\n');
            console.log('PWM_PENDING:', pending.text);
          }
          saveState(st);
        }
      }
    } catch (e) {
      console.error('PWM_WATCH_ERR', e);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

function usage() {
  console.log(`Usage:
  node pwm/live.mjs watch --doc <hint> [--ms 2000]
  node pwm/live.mjs pull  --doc <hint>
  node pwm/live.mjs reply --doc <hint> --text '…'
  node pwm/live.mjs eval  --doc <hint> --code '…'
  node pwm/live.mjs open  --doc <hint>

Agent reply without Chrome permission: append text to pwm/.live/outbox
(separate messages with a line containing only ---). Prefix with EVAL\\n for runtime.eval.
`);
}

async function main() {
  const cmd = process.argv[2];
  const doc = arg('--doc') || process.env.PWM_DOC || '6NiLqYed';
  const ms = Number(arg('--ms') || 2000);

  if (!cmd || cmd === 'help' || cmd === '-h') {
    usage();
    process.exit(0);
  }
  if (cmd === 'watch') return cmdWatch(doc, ms);
  if (cmd === 'pull') {
    cmdPull(doc);
    return;
  }
  if (cmd === 'reply') return cmdReply(doc, arg('--text'));
  if (cmd === 'eval') return cmdEval(doc, arg('--code'));
  if (cmd === 'open') return cmdOpen(doc);
  console.error('Unknown command', cmd);
  usage();
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
