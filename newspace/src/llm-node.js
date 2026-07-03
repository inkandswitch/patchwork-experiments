// An LLM surface (powered by @chee/patchwork-llm). It turns its `in` value into its
// `out` value, guided by a PROMPT. The prompt is a param: editable in the UI AND
// wireable via the optional `prompt` inlet (a wired prompt wins). With no `in` it
// just generates from the prompt (a source). Model/provider/key come from the
// account doc (configure via the chat/duet tools' settings).
//
//   in ──▶ [ LLM: <prompt> ] ──▶ out      (transform)
//          [ LLM: <prompt> ] ──▶ out      (source / generator, no `in`)
import { Source, apply as applyOp } from "./opstreams.js";
import { snapshot, isSnapshot, describeBinary, binarySafeReplacer } from "./ops.js";
import { generate, popup } from "@chee/patchwork-llm";
import { VAR_RE, promptVars, llmInlets, promptOutlets, llmOutlets, parseOutletBlocks, clampOutletBlocks, outletConsumers, schemaSpec, schemaRule, validationPlan } from "./llm-inlets.js";
import { listEditors, inletDefsFor } from "./surfaces.js";
export { promptVars, llmInlets, promptOutlets, llmOutlets, parseOutletBlocks };

function stringify(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  const d = describeBinary(v); if (d) return d; // a frame/buffer → a short tag, never megabytes
  try { return JSON.stringify(v, binarySafeReplacer, 2); } catch { return String(v); }
}
// the system rule that keeps `out` clean — only the result flows out
const OUTPUT_RULE =
  "Output ONLY the result. No preamble, no explanation, no commentary, no markdown " +
  "code fences. Do not narrate your reasoning. If the result is JSON, output ONLY " +
  "valid JSON and nothing else.";

// CODE mode: the model writes a transform FUNCTION once; that function then runs on
// the live source every change (fast, local) — so a high-frequency source (a camera)
// doesn't drag the LLM into its loop.
const CODE_RULE =
  "Output ONLY a single JavaScript arrow-function expression of the form " +
  "`(input) => result`. No explanation, no markdown fences, no statements outside the " +
  "function. It is called with the wired input value; its return value is the output.";
const capStr = (s, n = 4000) => (s.length > n ? s.slice(0, n) + "\n…[truncated]" : s);

// MULTI-OUTLET mode: ask for labelled blocks, one per declared outlet (plus `out`)
const multiRule = (names) =>
  "Produce your answer as labelled blocks. Begin each block with a line `[[outlet:NAME]]` " +
  "on its own, then that block's content. Use ONLY these outlet names: " +
  ["out", ...names].join(", ") + ". Put the primary result in `out`. " +
  "Output ONLY blocks — no preamble, no markdown fences.";

// strip ```fences``` the model may add despite instructions. Robust: pull the FIRST
// fenced block from anywhere (models often add prose around it), else strip stray
// leading/trailing fence lines (a half-fence that would otherwise break eval).
function stripFences(text) {
  let t = (text || "").trim();
  const block = t.match(/```[a-zA-Z0-9]*\s*\n?([\s\S]*?)```/);
  if (block) return block[1].trim();
  return t.replace(/^```[a-zA-Z0-9]*\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

// if the model returned JSON, surface it as a value (so `out` can match a json inlet)
function coerceOut(text) {
  const t = (text || "").trim();
  if (t[0] === "{" || t[0] === "[") { try { return JSON.parse(t); } catch {} }
  return text;
}

export function mountLlm({ element, inlets = {}, setOutlet, config = {}, setConfig, onConfig, itemId, api, context }) {
  let prompt = typeof config.prompt === "string" ? config.prompt : "";
  // REAL schema→schema: the Standard Schema of the inlet our `out` outlet FEEDS.
  // Scan the live board for consumers wired {node: itemId, outlet: "out"} and take
  // the first wired inlet's declared schema (dynamic inlets included). Guarded —
  // with no canvas context / consumer / schema the plain best-effort path runs.
  const outSchema = () => {
    try {
      const board = (context && context.board) || (api && api.context && api.context.board);
      const items = board && board.value;
      if (!items || !itemId) return null;
      const eds = listEditors();
      for (const c of outletConsumers(items, itemId, "out")) {
        const d = eds.find((e) => e.id === c.item.editorId);
        if (!d) continue;
        const def = inletDefsFor(d, c.item).find((i) => i.name === c.inlet);
        const schema = def && (def.schema || def.accepts);
        if (schema && schema["~standard"]) return schema;
      }
    } catch {}
    return null;
  };
  // OUTLETS, created lazily and cached. `out` = clean final result; `think` = live
  // tokens / reasoning (so `out` never carries half-streamed text); plus one per
  // `@out name` line in the prompt. Ports re-render from llmOutlets reactively; here
  // we just keep the matching Source for each declared name alive.
  const streams = {};
  const outletFor = (name, init) => { let s = streams[name]; if (!s) { s = streams[name] = new Source(init); if (setOutlet) setOutlet(name, s); } return s; };
  const out = outletFor("out", "last" in config ? config.last : undefined);
  const think = outletFor("think", undefined);
  // the generated λ code as a BIDI text outlet (wire it to codemirror to edit it)
  const codeOut = outletFor("code", typeof config.codeText === "string" ? config.codeText : "");
  const syncOutlets = () => { for (const n of promptOutlets(prompt)) outletFor(n); };
  syncOutlets();
  const inStream = inlets.in;
  const promptStream = inlets.prompt; // wired prompt overrides the UI field

  let reversePrompt = typeof config.reversePrompt === "string" ? config.reversePrompt : "";
  let bidi = !!config.bidi; // LIVE: the always-installed out.apply gates on this, so toggling works without a remount
  let running = false, rerun = false; // rerun: a run requested mid-flight re-runs once with the latest inputs

  const root = document.createElement("div"); root.className = "ns-llm ns-source";
  const ta = document.createElement("textarea");
  ta.className = "ns-text ns-llm-prompt";
  ta.placeholder = "prompt — how to transform the input (or what to generate)";
  ta.value = prompt; ta.rows = 3;
  // a wired prompt drives the field (inlets are always-present proxies → check .wired)
  const syncPromptDisabled = () => { ta.disabled = !!(promptStream && promptStream.wired); };
  syncPromptDisabled();
  // BIDI: editing `out` reverse-generates (via the reverse prompt) and writes `in`
  const revTa = document.createElement("textarea");
  revTa.className = "ns-text ns-llm-prompt";
  revTa.placeholder = "reverse prompt — turn an edited output back into the input";
  revTa.value = reversePrompt; revTa.rows = 2;
  revTa.style.display = config.bidi ? "" : "none";
  revTa.oninput = () => { reversePrompt = revTa.value; if (setConfig) setConfig({ reversePrompt }); };
  const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:8px;align-items:center;";
  const runBtn = document.createElement("button"); runBtn.className = "ns-source-enable"; runBtn.textContent = "Run";
  const autoLabel = document.createElement("label"); autoLabel.style.cssText = "font:10px ui-monospace,monospace;display:flex;gap:3px;align-items:center;cursor:pointer;";
  const autoCb = document.createElement("input"); autoCb.type = "checkbox"; autoCb.checked = !!config.auto;
  autoLabel.append(autoCb, document.createTextNode("auto"));
  const bidiLabel = document.createElement("label"); bidiLabel.style.cssText = "font:10px ui-monospace,monospace;display:flex;gap:3px;align-items:center;cursor:pointer;";
  const bidiCb = document.createElement("input"); bidiCb.type = "checkbox"; bidiCb.checked = !!config.bidi;
  bidiCb.onchange = () => { bidi = bidiCb.checked; revTa.style.display = bidi ? "" : "none"; if (setConfig) setConfig({ bidi }); };
  bidiLabel.append(bidiCb, document.createTextNode("⇄ bidi"));
  // CODE mode: Run once → the model writes a function; that function runs live on the
  // input (so a fast source like a camera isn't fed to the LLM every frame).
  const codeLabel = document.createElement("label"); codeLabel.style.cssText = "font:10px ui-monospace,monospace;display:flex;gap:3px;align-items:center;cursor:pointer;";
  const codeCb = document.createElement("input"); codeCb.type = "checkbox"; codeCb.checked = !!config.code;
  codeCb.onchange = () => { if (setConfig) setConfig({ code: codeCb.checked }); codeTa.style.display = codeCb.checked ? "" : "none"; };
  codeLabel.append(codeCb, document.createTextNode("λ code"));
  const cfgBtn = document.createElement("button"); cfgBtn.className = "ns-source-enable"; cfgBtn.textContent = "⚙"; cfgBtn.title = "model / provider settings";
  cfgBtn.onclick = () => { try { const el = popup(); document.body.append(el); if (el.showPopover) el.showPopover(); } catch (e) { status.textContent = `⚠ ${(e && e.message) || e}`; } };
  const status = document.createElement("div"); status.className = "ns-source-status";
  // the generated transform — VISIBLE so you can read it, and EDITABLE so you can tweak
  // it by hand (recompiles + re-runs live on the input). Only shown in λ code mode.
  const codeTa = document.createElement("textarea");
  codeTa.className = "ns-text ns-llm-code"; codeTa.spellcheck = false; codeTa.rows = 4;
  codeTa.placeholder = "(input) => result — the generated transform (editable)";
  codeTa.value = typeof config.codeText === "string" ? config.codeText : "";
  codeTa.style.display = codeCb.checked ? "" : "none";
  bar.append(runBtn, autoLabel, bidiLabel, codeLabel, cfgBtn);
  root.append(ta, revTa, bar, codeTa, status); element.append(root);

  // a wired prompt (proxy backing set) drives the field
  const promptWired = () => !!(promptStream && promptStream.wired);
  const inWired = () => !!(inStream && inStream.wired);
  // fill {{var}} holes from their wired inlets
  const fillVars = (p) => (p || "").replace(VAR_RE, (m, n) => { const s = inlets[n]; return s && s.wired ? stringify(s.value) : m; });
  const currentPrompt = () => fillVars(promptWired() ? stringify(promptStream.value) : prompt);

  // BIDI write-back: when something edits `out`, reverse-generate (reverse prompt) and
  // write the result to the input source — a real two-way lens. Always installed and
  // gated on the LIVE bidi flag (not the mount-time config — mounts persist across the
  // toggle); it no-ops until bidi is on AND `in` is wired + writable.
  {
    let reversing = false;
    out.apply = async (op) => {
      if (!bidi || reversing || !inWired() || typeof inStream.apply !== "function") return;
      const edited = isSnapshot(op) ? op.value : applyOp(out.value, op);
      reversing = true; status.textContent = "reversing…";
      try {
        const sys = [OUTPUT_RULE, reversePrompt].filter(Boolean).join("\n\n");
        const { text } = await generate([{ role: "system", content: sys }, { role: "user", content: stringify(edited) }]);
        inStream.apply(snapshot(coerceOut(stripFences(text))));
        status.textContent = "reversed";
      } catch (e) { status.textContent = `⚠ ${(e && e.message) || e}`; }
      reversing = false;
    };
  }

  // ── CODE mode: a compiled (input)=>output function applied live to the source ──
  let fn = null;
  const compile = (code) => {
    try { const f = (0, eval)("(" + stripFences(code) + ")"); return typeof f === "function" ? f : null; } // eslint-disable-line no-eval
    catch (e) { status.textContent = `⚠ ${e.message}`; return null; }
  };
  const applyFn = () => { if (!fn) return; try { out.push(fn(inStream ? inStream.value : undefined)); status.textContent = "λ"; } catch (e) { status.textContent = `⚠ ${e.message}`; } };
  // the ONE place code changes flow through: persist, recompile, re-run, and mirror to
  // the textarea + the bidi `code` outlet. Idempotent so the outlet write-back can't loop.
  const applyCode = (code, { echoTextarea = true } = {}) => {
    code = typeof code === "string" ? code : stringify(code);
    if (code === codeOut.value) return;
    if (echoTextarea) codeTa.value = code;
    if (setConfig) setConfig({ codeText: code });
    fn = compile(code); applyFn();
    codeOut.push(code);
  };
  if (codeCb.checked && typeof config.codeText === "string") { fn = compile(config.codeText); applyFn(); } // restore the transform
  // hand-edit the inline textarea → recompile + re-run (don't clobber the caret)
  codeTa.oninput = () => applyCode(codeTa.value, { echoTextarea: false });
  // a wired editor (codemirror) writing the `code` outlet → recompile + re-run
  codeOut.apply = (op) => { const next = isSnapshot(op) ? op.value : applyOp(codeOut.value, op); applyCode(next); };

  const run = async () => {
    if (running) { rerun = true; return; } // don't drop an input change that lands mid-generation
    running = true;
    let acc = "";
    try {
      if (codeCb.checked) {
        status.textContent = "writing code…";
        const sys = [CODE_RULE, currentPrompt()].filter(Boolean).join("\n\n");
        const example = inWired() ? "Example input value:\n" + capStr(stringify(inStream.value)) : "";
        const { text } = await generate([{ role: "system", content: sys }, { role: "user", content: example }], { onToken: (d) => { acc += d; status.textContent = `… ${acc.length}`; } });
        const code = stripFences(text != null ? text : acc);
        applyCode(code); // persist + show + compile + run + push to the bidi `code` outlet
        status.textContent = fn ? "code ready" : "⚠ not a function";
      } else {
        status.textContent = "running…";
        const names = promptOutlets(prompt); // extra @out outlets → multi-block mode
        const rule = names.length ? multiRule(names) : OUTPUT_RULE;
        // REAL schema→schema (single-out mode only): when `out` feeds an inlet that
        // declares a Standard Schema with a derivable spec, ask for the shape in the
        // prompt and VALIDATE the parsed result before emitting. No schema (or no
        // derivable constraint, e.g. anySchema) ⇒ exactly the old best-effort path.
        const schema = names.length ? null : outSchema();
        const spec = schema ? schemaSpec(schema) : null;
        const shape = spec ? schemaRule(spec) : "";
        const genOnce = async (appendix) => {
          acc = "";
          const sys = [rule, shape, currentPrompt(), appendix].filter(Boolean).join("\n\n");
          const messages = inWired()
            ? [{ role: "system", content: sys }, { role: "user", content: capStr(stringify(inStream.value), 16000) }] // cap so a huge frame can't degenerate the run
            : [{ role: "system", content: [rule, shape, appendix].filter(Boolean).join("\n\n") }, { role: "user", content: currentPrompt() || "" }];
          // stream into `think` so `out` only ever holds a finished, clean value
          const { text } = await generate(messages, { onToken: (d) => { acc += d; think.push(acc); status.textContent = `… ${acc.length} chars`; } });
          const raw = text != null ? text : acc;
          think.push(raw);
          return raw;
        };
        const raw = await genOnce("");
        if (names.length) {
          // clamped to the DECLARED outlets — a model-invented block name must not mint
          // a phantom live port; it folds into `out` instead (see clampOutletBlocks)
          const blocks = clampOutletBlocks(parseOutletBlocks(raw), names); // { out, think?, <named>… }
          for (const [k, v] of Object.entries(blocks)) outletFor(k).push(coerceOut(stripFences(v)));
          if (setConfig) setConfig({ last: blocks.out != null ? coerceOut(stripFences(blocks.out)) : null });
        } else if (!spec) {
          const result = coerceOut(stripFences(raw));
          out.push(result);
          if (setConfig) setConfig({ last: result });
        } else {
          // validate → retry once with the issues → error op (never emit garbage)
          let result = coerceOut(stripFences(raw));
          let plan = validationPlan(schema, result, 0);
          if (plan.action === "retry") {
            status.textContent = "shape mismatch — retrying…";
            result = coerceOut(stripFences(await genOnce(plan.appendix)));
            plan = validationPlan(schema, result, 1);
          }
          if (plan.action !== "emit") throw new Error(plan.message); // → catch: ⚠ status + an error op
          out.push(plan.value);
          if (setConfig) setConfig({ last: plan.value });
        }
        status.textContent = "done";
      }
    } catch (e) { status.textContent = `⚠ ${(e && e.message) || e}`; out.pushError(e); }
    running = false;
    if (rerun) { rerun = false; run(); } // once, with the latest inputs
  };

  ta.oninput = () => { prompt = ta.value; if (setConfig) setConfig({ prompt }); syncOutlets(); }; // new @out/{{var}} → new ports
  autoCb.onchange = () => { if (setConfig) setConfig({ auto: autoCb.checked }); };
  runBtn.onclick = run;

  // input change: in CODE mode just re-run the compiled fn (cheap); otherwise auto-run
  // the LLM, DEBOUNCED so a fast source doesn't pile up calls.
  let debounce = null;
  const onInput = () => {
    if (codeCb.checked) { applyFn(); return; }
    if (autoCb.checked) { clearTimeout(debounce); debounce = setTimeout(run, 600); }
  };
  const offs = [];
  if (inStream && inStream.connect) offs.push(inStream.connect(onInput));
  // a wired prompt flows through the SAME state as typing: the local `prompt` (so
  // promptOutlets/@out blocks see it), config.prompt (so {{var}} inlets regenerate),
  // and the new-port sync — not just the textarea display.
  if (promptStream && promptStream.connect) offs.push(promptStream.connect(() => { syncPromptDisabled(); if (promptWired()) { prompt = stringify(promptStream.value); ta.value = prompt; if (setConfig) setConfig({ prompt }); syncOutlets(); onInput(); } }));
  // a wired {{var}} changing re-runs (or re-applies the code), like any input
  for (const [k, s] of Object.entries(inlets)) { if (k === "in" || k === "prompt" || k === "bang") continue; if (s && s.connect) offs.push(s.connect(onInput)); }
  // a BANG on the trigger inlet runs it (skip the initial connect snapshot)
  if (inlets.bang && inlets.bang.connect) { let first = true; offs.push(inlets.bang.connect(() => { if (first) { first = false; return; } run(); })); }
  // the bidi flag can flip in CONFIG from elsewhere (another viewer's checkbox) — track it live
  if (onConfig) onConfig((c) => { const b = !!c.bidi; if (b === bidi) return; bidi = b; bidiCb.checked = b; revTa.style.display = b ? "" : "none"; });

  return () => { clearTimeout(debounce); offs.forEach((o) => o && o()); root.remove(); };
}
