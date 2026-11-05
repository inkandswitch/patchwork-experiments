#!/usr/bin/env node
/** Thin wrapper — prefer `node pwm/live.mjs …`. */
import { evalInChrome } from './liveLib.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

const HELLO = `(() => {
  let t = new TextMorph(rect(60, 60, 320, 48), 'Hello from PWM chromeEval!');
  Lively.addMorph(t);
  return t;
})()`;

const docHint = arg('--doc') || '6NiLqYed';
let code = arg('--code');
if (process.argv.includes('--hello')) code = HELLO;
else if (process.argv.includes('--session-ping') || !code) {
  code = `sessionLog('agent', 'PWM chromeEval OK at ' + new Date().toLocaleTimeString())`;
}

const r = evalInChrome(docHint, code);
console.log(r.raw);
process.exit(r.ok ? 0 : 1);
