/* A sloped step, a railing, and a lantern beyond the courier's assisted reach. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'scene-contacts', name: 'Courier on the sloped step', seed: 22,
  build(seed, { controls = {} } = {}) {
    const { V, M } = K, B = makeBuilder(seed, [
      0x14212c, 0x152e38, 0x235360, 0x318683, 0x69b3a3, 0x352b47, 0x59516a, 0x817b90, 0xb6aeb0,
      0x6d3a28, 0xa06435, 0xdc9a49, 0xffcc73, 0xffedb6
    ]);
    const S = K.sculpt(makeSculpt(B)), tags = K.deform.tags(S);
    const cloth = { r: [1, 2, 3, 4] }, steel = { r: [5, 6, 7, 8] }, brass = { r: [9, 10, 11, 12] };
    const glow = { r: [10, 11, 12, 13], em: true };
    const parts = {};
    function part(id, pivot, parent) {
      parts[id] = { ids: [], pivot, parent };
      return (center, half, material = cloth, rd = 0.06) => S.box(center, half, material, { tag: id, rd, res: 0.05 });
    }
    part('hips', [0, 1.22, 0])([0, 1.27, 0], [0.40, 0.14, 0.20], brass);
    const chest = part('chest', [0, 1.42, 0], 'hips');
    chest([0, 1.71, 0], [0.43, 0.32, 0.24], cloth, 0.13);
    chest([0, 1.71, -0.25], [0.28, 0.22, 0.13], steel);
    const head = part('hood', [0, 2.06, 0], 'chest');
    head([0, 2.31, 0], [0.34, 0.31, 0.29], cloth, 0.16);
    head([0, 2.34, 0.26], [0.27, 0.082, 0.062], steel);
    for (const x of [-0.11, 0.11]) head([x, 2.34, 0.31], [0.042, 0.033, 0.023], glow, 0.019);

    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      const x = 0.25 * sign, arm = 0.54 * sign;
      part(side+'Thigh', [x, 1.22, 0], 'hips')([x, 0.99, 0], [0.135, 0.25, 0.14]);
      part(side+'Shin', [x, 0.72, 0], side+'Thigh')([x, 0.46, 0], [0.12, 0.27, 0.13], steel);
      part(side+'Boot', [x, 0.18, 0], side+'Shin')([x, 0.09, 0.075], [0.16, 0.09, 0.22], brass);
      part(side+'Shoulder', [sign*0.23, 1.93, -0.02], 'chest')([arm, 1.96, 0], [0.17, 0.16, 0.16], brass);
      part(side+'Arm', [arm, 1.99, 0], side+'Shoulder')([arm, 1.78, 0], [0.12, 0.24, 0.12]);
      part(side+'Forearm', [arm, 1.51, 0], side+'Arm')([arm, 1.28, 0], [0.11, 0.245, 0.115], steel);
      part(side+'Palm', [arm, 1.02, 0], side+'Forearm')([arm, 0.99, 0.03], [0.122, 0.113, 0.10], brass);
    }

    const step = { id: 'sloped-step', center: [-0.28, 0.075, 0.18], half: [0.38, 0.13, 0.44],
      pose: M.rot([1, 0, 0], Math.PI / 9) };
    const rail = { id: 'rail', center: [0.98, 1.42, 0.97], half: [0.45, 0.075, 0.07], pose: M.id() };
    const positions = [], groups = [];
    function surfaceBox(box, axis, sign, material) {
      const { id, center, half, pose } = box;
      const axes = [[1,0,0], [0,1,0], [0,0,1]].map(p => M.app(pose, p));
      S.box(center, half, material, { ax: axes, res: 0.054 });
      const [u,v] = [0,1,2].filter(i => i !== axis);
      const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b]) => {
        const point = [0,0,0];
        point[axis] = sign * half[axis];
        point[u] = a * half[u];
        point[v] = b * half[v];
        return V.add(center, M.app(pose, point));
      });
      groups.push({ start: positions.length / 3, count: 6, owner: id, surface: id });
      positions.push(...[0,1,2,0,2,3].flatMap(i => corners[i]));
    }
    surfaceBox(step, 1, 1, steel);
    surfaceBox(rail, 2, -1, brass);
    for (const x of [0.62, 1.34]) S.box([x, 0.70, 0.99], [0.06, 0.70, 0.061], steel, { rd: 0.025, res: 0.058 });

    const grip = [0.80, 1.37, 1.37];
    const lantern = part('lantern', grip);
    lantern(grip, [0.08, 0.027, 0.043], brass, 0.019);
    lantern([grip[0], 1.19, grip[2]], [0.10, 0.12, 0.091], glow, 0.04);
    for (const y of [1.07, 1.29]) lantern([grip[0], y, grip[2]], [0.14, 0.03, 0.12], brass, 0.023);
    S.box([grip[0], 0.49, grip[2]], [0.19, 0.49, 0.15], steel, { rd: 0.046, res: 0.065 });
    S.box([0.35, -0.13, 0.55], [1.75, 0.09, 1.25], steel, { rd: 0.07, res: 0.095 });

    S.bake();
    for (const [id, entry] of Object.entries(parts)) entry.ids = tags[id];
    const world = B.finish({ cam: { target: [0.34, 1.19, 0.58], yaw: 1.19, pitch: 0.19, dist: 6.55 },
      radius: 3, detail: 22, dither: 0.14 });
    const puppet = K.puppet(world, { parts });
    const index = K.procedural.contacts.index({ positions, groups });
    const sole = [-0.25, 0, 0.12], fingers = [0.54, 0.95, 0.11];
    const stepAnchor = K.anim.contacts.project(index, { origin: [-0.25, 0.8, 0.22], distance: 1, label: 'Top of the step' });
    const railAnchor = K.anim.contacts.project(index, {
      origin: [0.70, 1.42, 0.38], direction: [0, 0, 1], distance: 0.6, label: 'Inner face of the railing'
    });
    const options = controls.assist === false ? [] : [{ part: 'chest', maxDegrees: 13 }, { part: 'rightShoulder', maxDegrees: 23 }];
    const duration = 3.2, clip = K.anim.clip({ dur: duration, tracks: {
      'chest.rot': [[0,[0,0,0]], [1,[1,0,0]], [2.4,[0,0,0]], [3.2,[0,0,0]]],
      'hood.rot': [[0,[0,0,0]], [1,[9,16,0]], [2.40,[13,24,0]], [3.2,[0,10,0]]],
      'leftArm.rot': [[0,[0,0,6]], [1,[0,0,15]], [3.2,[0,0,6]]]
    } });
    world.animationTimeline = K.anim.timeline.create({ world, puppet, clip,
      sprite: { width: 128, height: 104, fps: 12 },
      contacts: {
        height: 2.65, sockets: {
          pedestal: { point: grip }, grip: { part: 'rightPalm', point: fingers, rotation: [-85, 0, 0] }
        },
        contacts: [
          { id: 'plant-on-step', part: 'leftBoot', upper: 'leftThigh', lower: 'leftShin', point: sole,
            target: stepAnchor, align: true, start: 0.14, end: 3.06, fadeIn: 0.33, fadeOut: 0.25, pole: [0, 0, 1] },
          { id: 'palm-on-rail', part: 'rightPalm', upper: 'rightArm', lower: 'rightForearm', point: fingers,
            target: railAnchor, align: { normal: [0, 0, -1] }, assist: options,
            start: 0.67, end: 1.55, fadeIn: 0.25, fadeOut: 0.22, pole: [0, -1, 0] }
        ],
        prop: { part: 'lantern', socket: 'pedestal', keys: [{ id: 'far-grip', time: 2.42, to: 'grip', settle: 0.46,
          reach: { upper: 'rightArm', lower: 'rightForearm', pole: [0, -1, 0], lead: 0.55, assist: options } }] }
      }
    });
    world.animationTimeline.set({ stage: 'spline' });
    return world;
  }
});
