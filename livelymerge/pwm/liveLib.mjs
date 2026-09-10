/**
 * Shared Chrome → main-world → runtime.eval helper for PWM live tools.
 */
import { spawnSync } from 'node:child_process';

export function asQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * @param {string} docHint last chars of automerge id or unique URL fragment
 * @param {string} code LM source for runtime.eval
 * @returns {{ ok: boolean, shown?: string, error?: string, raw: string }}
 */
export function evalInChrome(docHint, code) {
  const attr = 'data-pwm-eval-' + Date.now().toString(36);
  const codeJson = JSON.stringify(code);
  const pageJs =
    '(function(){var out;try{if(!window.runtime||typeof window.runtime.eval!=="function"){out={ok:false,error:"no runtime.eval"};}else{var r=window.runtime.eval(' +
    codeJson +
    ');var shown=typeof window.runtime.formatEvalResult==="function"?window.runtime.formatEvalResult(r):String(r);out={ok:true,shown:String(shown)};}}catch(e){out={ok:false,error:String(e&&e.message?e.message:e)};}document.documentElement.setAttribute("' +
    attr +
    '",JSON.stringify(out));})();';

  const injected =
    '(function(){document.documentElement.removeAttribute("' +
    attr +
    '");var s=document.createElement("script");s.textContent=' +
    JSON.stringify(pageJs) +
    ';document.documentElement.appendChild(s);s.remove();return "started";})()';

  const readBack =
    '(function(){return document.documentElement.getAttribute("' + attr + '")||"";})()';

  const hint = docHint || 'livelymerge';
  const script = `
tell application "Google Chrome"
  repeat with wi from 1 to (count of windows)
    set w to window wi
    repeat with ti from 1 to (count of tabs of w)
      set t to tab ti of w
      set u to URL of t
      if u contains "patchwork" and u contains ${asQuote(hint)} then
        execute t javascript ${asQuote(injected)}
        delay 1.0
        set r to execute t javascript ${asQuote(readBack)}
        return r
      end if
    end repeat
  end repeat
  return "NO_PATCHWORK_TAB"
end tell
`;

  const out = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
  if (out.status !== 0) {
    const err = (out.stderr || out.stdout || '').trim();
    if (/Allow JavaScript from Apple Events/i.test(err)) {
      return {
        ok: false,
        error:
          'Enable Chrome → View → Developer → Allow JavaScript from Apple Events',
        raw: err,
      };
    }
    return { ok: false, error: err || 'osascript failed', raw: err };
  }
  const raw = (out.stdout || '').trim();
  if (raw === 'NO_PATCHWORK_TAB' || raw === '') {
    return { ok: false, error: 'NO_PATCHWORK_TAB', raw };
  }
  try {
    const parsed = JSON.parse(raw);
    return { ...parsed, raw };
  } catch {
    return { ok: false, error: 'bad JSON from page', raw };
  }
}

export function readSessionLog(docHint) {
  return evalInChrome(docHint, 'String(Lively.sessionLogText || "")');
}

export function sessionLogAgent(docHint, msg) {
  const src = `sessionLog('agent', ${JSON.stringify(msg)})`;
  return evalInChrome(docHint, src);
}

export function openSessionLog(docHint) {
  return evalInChrome(docHint, 'openSessionLog()');
}

/** Last non-empty line roles: Dan / agent / system / pwm / other */
export function parseLogLines(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter(Boolean);
  return lines.map((line) => {
    const m = line.match(/^\[[^\]]+\]\s+([^:]+):\s*(.*)$/);
    if (!m) return { role: 'other', text: line, line };
    return { role: m[1], text: m[2], line };
  });
}

export function lastHumanPrompt(text) {
  const parsed = parseLogLines(text);
  for (let i = parsed.length - 1; i >= 0; i--) {
    const role = parsed[i].role;
    if (role === 'Dan' || role === 'dan' || role === 'user' || role === 'human') {
      // Unanswered if no agent line after it
      const after = parsed.slice(i + 1);
      const answered = after.some((p) => p.role === 'agent');
      return { ...parsed[i], answered, index: i };
    }
  }
  return null;
}
