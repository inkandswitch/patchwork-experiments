function registry() {
  const ids = new Map(), targets = [null];
  return {
    targets,
    id(binding) {
      const key = JSON.stringify(binding);
      if (!ids.has(key)) {
        ids.set(key, targets.length);
        targets.push(binding);
      }
      return ids.get(key);
    }
  };
}

function createLookPass(w, h, requested, bindings = registry()) {
  const wantsTarget = requested.has('target'), wantsMask = requested.has('mask');
  if (!wantsTarget && !wantsMask) return null;
  const size = w * h;
  const target = wantsTarget ? new Uint32Array(size) : null;
  const score = wantsTarget ? new Float32Array(size) : null;
  const mask = wantsMask ? new Float32Array(size) : null;
  const entries = new WeakMap(), mark = { id: 0, weight: 0, mask: 0 };
  let post = -1;

  function id(rule, stage, settings, scoped) {
    if (!target) return 0;
    let stages = entries.get(rule);
    if (!stages) entries.set(rule, stages = new Map());
    if (!stages.has(stage)) stages.set(stage, bindings.id({
      stage, asset: rule.assetId ?? (rule.id === 'lookAsset' ? settings?.lookAssetId : undefined) ?? null,
      select: rule.select ?? null, ...(rule.id && { layer: rule.id }),
      ...(rule.stack?.name || rule.stackName ? { stack: rule.stack?.name ?? rule.stackName } : {}),
      ...(rule.order !== undefined && { order: rule.order }),
      scope: rule.scope === 'surface' || settings ? 'surface' : scoped ? 'target' : 'scene'
    }));
    return stages.get(stage);
  }

  function note(rule, value, amount, stage, settings) {
    if (!(amount > 0)) return;
    const scoped = Boolean(rule.select || rule.mask || rule.scope === 'surface' || settings);
    const binding = id(rule, stage, settings, scoped);
    if (post >= 0) {
      if (binding && (scoped || !target[post] || bindings.targets[target[post]].scope === 'scene')) {
        target[post] = binding;
        score[post] = amount;
      }
      if (mask && value != null) mask[post] = Math.max(value, mask[post]);
      return;
    }
    if (binding && (scoped || !mark.id || bindings.targets[mark.id].scope === 'scene')) {
      mark.id = binding;
      mark.weight = amount;
    }
    if (value != null) mark.mask = Math.max(mark.mask, value);
  }
  const stage = (rule, value, amount) => note(rule, value, amount, rule.name);
  const optics = (rule, value, amount) => note(rule, value, amount, 'optics');
  const palette = (rule, value, amount) => note(rule, value, amount, 'palette');
  const surface = (layer, value, amount, settings) => note(layer, value, amount, 'lit', settings);
  const top = pixel => (h - 1 - Math.floor(pixel / w)) * w + pixel % w;
  function begin(previous) {
    post = -1;
    mark.id = previous?.id ?? 0;
    mark.weight = previous?.weight ?? 0;
    mark.mask = previous?.mask ?? 0;
  }
  function fragment(pixel, alpha, current, replace = false) {
    const p = top(pixel);
    if (mask) mask[p] = (current?.mask ?? 0) * alpha + mask[p] * (replace ? 1 : 1 - alpha);
    if (!target) return;
    score[p] *= replace ? 1 : 1 - alpha;
    const weight = (current?.weight ?? 0) * alpha;
    if (weight > 0 && weight >= score[p]) {
      target[p] = current.id;
      score[p] = weight;
    } else if (score[p] < .004) {
      target[p] = 0;
      score[p] = 0;
    }
  }
  return {
    mark, begin, stage, optics, palette, surface, fragment,
    post(pixel) { post = pixel; return stage; },
    local(pixel, rule, weight = null) {
      post = top(pixel);
      palette(rule, weight, weight ?? 1);
    },
    finish(other) {
      return { w, h, ...other, ...(target && { target, targets: bindings.targets }), ...(mask && { mask }) };
    }
  };
}

module.exports = { createLookPass, registry };
