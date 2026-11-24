// Convert Ink's rest-to-pose matrices into glTF skinning and sampled local transforms.
function rigWriter(doc, model, { V, M }) {
  const rest = [], parents = [], jointNodes = [], frames = [], jointNames = new Set();
  const transform = (r = M.id(), t = [0, 0, 0]) => ({ r, t });
  const multiply = (a, b) => transform(M.mul(a.r, b.r), V.add(M.app(a.r, b.t), a.t));
  const inverse = ({ r, t }) => {
    if (Math.abs(M.det(r)) < 1e-12) throw new Error('Singular joint transform');
    const q = M.inv(r);
    return transform(q, M.app(q, V.mul(t, -1)));
  };
  const columns = r => [[r[0], r[3], r[6]], [r[1], r[4], r[7]], [r[2], r[5], r[8]]];
  const vector = (value, n) => Array.isArray(value) && value.length === n && value.every(Number.isFinite);
  const matrix = ({ r, t }) => [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, ...t, 1];

  function quaternion(r) {
    const trace = r[0] + r[4] + r[8];
    if (trace > 0) {
      const q = 2 * Math.sqrt(trace + 1);
      return [(r[7] - r[5]) / q, (r[2] - r[6]) / q, (r[3] - r[1]) / q, q / 4];
    }
    const i = r[0] > r[4] && r[0] > r[8] ? 0 : r[4] > r[8] ? 1 : 2, j = (i + 1) % 3, k = (i + 2) % 3;
    const q = 2 * Math.sqrt(1 + r[4 * i] - r[4 * j] - r[4 * k]), out = [0, 0, 0, (r[k * 3 + j] - r[j * 3 + k]) / q];
    out[i] = q / 4;
    out[j] = (r[i * 3 + j] + r[j * 3 + i]) / q;
    out[k] = (r[i * 3 + k] + r[k * 3 + i]) / q;
    return out;
  }
  function decompose({ r, t }) {
    const axes = columns(r), scale = axes.map(V.len);
    if (scale.some(s => s < 1e-8)) throw new Error('A joint scale is too close to zero');
    if (M.det(r) < 0) scale[0] *= -1;
    const basis = axes.map((axis, i) => V.mul(axis, 1 / scale[i]));
    const shear = Math.max(Math.abs(V.dot(basis[0], basis[1])), Math.abs(V.dot(basis[0], basis[2])),
      Math.abs(V.dot(basis[1], basis[2])));
    return { translation: t, rotation: quaternion(M.tr(basis.flat())), scale, shear };
  }
  function nodeTRS(value) {
    const { translation, rotation, scale } = decompose(value);
    return { translation, rotation, scale };
  }

  // Orthogonalize the columns by two-sided plane rotations. Splitting the
  // result across two nodes preserves shear while both channels use legal TRS.
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  function factor({ r, t }, previous) {
    const right = columns(previous || M.id()), left = right.map(v => M.app(r, v));
    for (let sweep = 0; sweep < 12; sweep++) {
      let changed = false;
      for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
        const a = V.dot(left[i], left[i]), b = V.dot(left[j], left[j]), c = V.dot(left[i], left[j]);
        if (Math.abs(c) < 1e-10 * Math.sqrt(a * b)) continue;
        let angle = Math.atan2(2 * c, b - a) / 2;
        if (angle > Math.PI / 4) angle -= Math.PI / 2;
        if (angle < -Math.PI / 4) angle += Math.PI / 2;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        for (const axes of [left, right]) {
          const x = axes[i], y = axes[j];
          axes[i] = V.mad(V.mul(x, cos), y, -sin);
          axes[j] = V.mad(V.mul(y, cos), x, sin);
        }
        changed = true;
      }
      if (!changed) break;
    }
    const old = columns(previous || M.id());
    const best = permutations.reduce((best, order) => {
      const score = order.reduce((s, j, i) => s + Math.abs(V.dot(right[j], old[i])), 0);
      return score > best.score ? { order, score } : best;
    }, { score: -1 }).order;
    const aligned = best.map((j, i) => V.dot(right[j], old[i]) < 0 ? -1 : 1);
    const align = axes => best.map((j, i) => V.mul(axes[j], aligned[i]));
    let R = align(right), A = align(left);
    if (M.det(R.flat()) < 0) {
      R[2] = V.mul(R[2], -1);
      A[2] = V.mul(A[2], -1);
    }
    return { left: nodeTRS(transform(M.tr(A.flat()), t)), right: nodeTRS(transform(R.flat())),
      basis: M.tr(R.flat()) };
  }

  const joints = model.joints || [];
  for (const [i, joint] of joints.entries()) {
    const { name, head, tail, parent = null } = joint;
    if (typeof name !== 'string' || !name || jointNames.has(name)) throw new Error('Joint names must be present and unique');
    if (!vector(head, 3) || !vector(tail, 3) || V.dist(head, tail) < 1e-6)
      throw new Error('Invalid bind position for joint ' + name);
    if (parent !== null && (!Number.isInteger(parent) || parent < 0 || parent >= i))
      throw new Error('A joint parent must precede its children');
    jointNames.add(name);
    const up = V.norm(V.sub(tail, head)), right = V.perp(up);
    rest.push(transform(M.tr([...right, ...up, ...V.cross(right, up)]), head));
    parents.push(parent);
  }
  const bindInverse = rest.map(inverse);
  const split = joints.map(() => false), labels = new Set();
  for (const clip of model.animations || []) {
    if (!joints.length) throw new Error('Animation clips require joints');
    if (typeof clip.name !== 'string' || !clip.name || labels.has(clip.name) || clip.frames?.length < 2 ||
        clip.frames?.[0]?.time !== 0) throw new Error('Clips need a unique name and at least two frames beginning at zero');
    labels.add(clip.name);
    let last = -1;
    const sampled = clip.frames.map(frame => {
      if (!Number.isFinite(frame.time) || Math.fround(frame.time) <= Math.fround(last) || frame.matrices?.length !== joints.length)
        throw new Error('Animation times must increase and every frame needs a matrix per joint');
      last = frame.time;
      const world = frame.matrices.map((m, i) => {
        if (!vector(m, 12)) throw new Error('Expected nine matrix components followed by translation');
        return multiply(transform(m.slice(0, 9), m.slice(9)), rest[i]);
      });
      const local = world.map((m, i) => {
        const parent = parents[i], value = parent === null ? m : multiply(inverse(world[parent]), m);
        split[i] ||= decompose(value).shear > 0.00001;
        return value;
      });
      return { time: frame.time, local };
    });
    frames.push({ name: clip.name, sampled });
  }

  const driver = [];
  const skeleton = joints.length ? doc.add('nodes', { name: model.rigName || 'Skeleton', children: [] }) : null;
  if (skeleton !== null) doc.gltf.scenes[0].nodes.push(skeleton);
  function attach(parent, child) {
    (doc.gltf.nodes[parent ?? skeleton].children ||= []).push(child);
  }
  for (let i = 0; i < joints.length; i++) {
    const parent = parents[i], parentNode = parent === null ? null : jointNodes[parent];
    const local = parent === null ? rest[i] : multiply(bindInverse[parent], rest[i]);
    if (split[i]) {
      driver[i] = doc.add('nodes', { name: joints[i].name + ' · affine', ...nodeTRS(local) });
      attach(parentNode, driver[i]);
      jointNodes[i] = doc.add('nodes', { name: joints[i].name });
      attach(driver[i], jointNodes[i]);
    } else {
      jointNodes[i] = driver[i] = doc.add('nodes', { name: joints[i].name, ...nodeTRS(local) });
      attach(parentNode, jointNodes[i]);
    }
  }
  for (const { name, sampled } of frames) {
    const input = doc.accessor(Float32Array.from(sampled, f => f.time), 'SCALAR', { bounds: true });
    const animation = { name, channels: [], samplers: [] };
    function channels(node, poses) {
      for (const [path, type] of [['translation', 'VEC3'], ['rotation', 'VEC4'], ['scale', 'VEC3']]) {
        let previous;
        const values = poses.flatMap(pose => {
          let value = pose[path];
          if (path === 'rotation') {
            const len = Math.hypot(...value);
            value = value.map(q => q / len);
            if (previous && previous.reduce((s, v, j) => s + v * value[j], 0) < 0) value = value.map(q => -q);
            previous = value;
          }
          return value;
        });
        const output = doc.accessor(Float32Array.from(values), type);
        animation.channels.push({ sampler: animation.samplers.length, target: { node, path } });
        animation.samplers.push({ input, output, interpolation: 'LINEAR' });
      }
    }
    for (let i = 0; i < joints.length; i++) {
      if (split[i]) {
        let prior;
        const poses = sampled.map(frame => {
          const result = factor(frame.local[i], prior);
          prior = result.basis;
          return result;
        });
        channels(driver[i], poses.map(p => p.left));
        channels(jointNodes[i], poses.map(p => p.right));
      } else channels(jointNodes[i], sampled.map(frame => nodeTRS(frame.local[i])));
    }
    doc.add('animations', animation);
  }

  let skin;
  return {
    size: joints.length,
    skin() {
      if (skin === undefined) {
        const inverseBindMatrices = doc.accessor(Float32Array.from(bindInverse.flatMap(matrix)), 'MAT4');
        skin = doc.add('skins', { joints: jointNodes, skeleton, inverseBindMatrices });
      }
      return skin;
    }
  };
}

module.exports = rigWriter;
