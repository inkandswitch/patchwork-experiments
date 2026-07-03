import { Source, apply as applyOp } from "./opstreams.js";
import { snapshot, isSnapshot } from "./ops.js";

export function fmtValue(v) {
  if (v === undefined) return "∅";
  if (typeof v === "number" && Number.isNaN(v)) return "NaN";
  return String(v);
}

export function mountTransformSurface(spec, { element, inlets = {}, setOutlet, config = {}, setConfig }) {
  const src = inlets[spec.inlet || "in"];
  const out = new Source(undefined, spec.schema ? { schema: spec.schema } : undefined);
  if (setOutlet) setOutlet(spec.outlet || "out", out);

  let cfg = spec.normalize ? spec.normalize(config) : { ...config };
  const root = document.createElement("div");
  root.className = `${spec.className || "ns-transform"} ns-source`;

  const fields = spec.fields || [];
  const controls = {};
  const grid = fields.length > 1 ? document.createElement("div") : null;
  if (grid) grid.className = `${spec.className || "ns-transform"}-grid`;

  const persist = () => { if (setConfig) setConfig({ ...cfg }); };
  let recompute = () => {};
  const setField = (key, value) => {
    cfg = spec.normalize ? spec.normalize({ ...cfg, [key]: value }) : { ...cfg, [key]: value };
    persist();
    recompute();
  };

  for (const f of fields) {
    const wrap = document.createElement("label");
    wrap.className = `${spec.className || "ns-transform"}-field`;
    const label = document.createElement("span");
    label.className = `${spec.className || "ns-transform"}-label`;
    label.textContent = f.label || f.key;
    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      for (const optDef of f.options || []) {
        const opt = document.createElement("option");
        opt.value = optDef.name;
        opt.textContent = optDef.label || optDef.name;
        input.append(opt);
      }
      input.onchange = () => setField(f.key, input.value);
    } else {
      input = document.createElement("input");
      input.type = f.type === "checkbox" ? "checkbox" : "number";
      if (f.min != null) input.min = String(f.min);
      if (f.step != null) input.step = String(f.step);
      input.oninput = () => setField(f.key, f.type === "checkbox" ? !!input.checked : input.value);
    }
    input.className = `ns-text ${spec.className || "ns-transform"}-input`;
    controls[f.key] = input;
    if (f.type === "checkbox") {
      input.checked = !!cfg[f.key];
      wrap.append(input, label);
    } else {
      input.value = String(cfg[f.key]);
      wrap.append(label, input);
    }
    (grid || root).append(wrap);
  }
  if (grid) root.append(grid);

  const status = document.createElement("div");
  status.className = `${spec.className || "ns-transform"}-readout ns-source-status`;
  root.append(status);
  element.append(root);

  recompute = () => {
    const x = src ? src.value : undefined;
    const y = spec.compute(x, cfg);
    out.push(y);
    status.textContent = spec.status ? spec.status(x, y, cfg) : fmtValue(y);
  };

  if (src && typeof src.apply === "function" && typeof spec.invert === "function") {
    out.apply = (op) => {
      const next = isSnapshot(op) ? op.value : applyOp(out.value, op);
      const back = spec.invert(next, cfg);
      if (back !== undefined) src.apply(snapshot(back));
    };
  }

  const off = src && src.connect ? src.connect(recompute) : null;
  recompute();

  return () => { if (off) off(); root.remove(); };
}

