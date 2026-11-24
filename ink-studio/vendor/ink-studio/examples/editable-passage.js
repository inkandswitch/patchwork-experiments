module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => {
  const id = 'editable-passage', seed = 17, owner = 'wall', rule = 'parts',
    A = K.authoring, P = K.procedural;
  const part = key => A.data.derivedId(owner, rule, key);
  const box = (position, half) => P.spatial.bounds({
    min: position.map((value, axis) => value - half[axis]),
    max: position.map((value, axis) => value + half[axis])
  });
  const check = (id, pass, message) => ({ id, pass, message });
  const inside = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  const wallSize = { width: 4.8, height: 2.55, depth: .4 };

  function authoring(seed, { snapshot } = {}) {
    const document = A.document(snapshot ?? { ...A.document().snapshot(), id, seed });
    const context = A.context(document);
    const dimensions = (value, limits) => Object.entries(limits).every(([key, range]) => inside(value[key], ...range));

    context.register('wall', {
      describe({ parameters: p }) {
        if (!dimensions(p, { width: [2, 7], height: [1, 4], depth: [.15, .65] }))
          throw new Error('Wall dimensions are outside the supported range');
        const face = P.surface.plane({ id: 'front', origin: [-p.width / 2, 0, -p.depth / 2],
          u: [p.width, 0, 0], v: [0, p.height, 0] });
        return { bounds: box([0, p.height / 2, 0], [p.width / 2, p.height / 2, p.depth / 2]), surfaces: [face] };
      }
    });

    context.register('doorway', {
      describe(entity, ctx) {
        const p = entity.parameters;
        if (!dimensions(p, { width: [.1, 6], height: [.2, 4] }) ||
            entity.anchor?.host !== owner || entity.anchor.surface !== 'front' || entity.anchor.uv?.[1] !== 0 ||
            entity.anchor.offset)
          throw new Error('Doorway needs bounded dimensions and an anchor at the foot of the wall');
        const [x] = ctx.anchor(entity.anchor).p, { depth } = ctx.read(owner).parameters;
        return { bounds: box([x, p.height / 2, 0], [p.width / 2, p.height / 2, depth / 2]) };
      }
    });

    function landingBox(entity, ctx) {
      const p = entity.parameters, doorway = ctx.read(part('doorway'));
      if (!doorway || !dimensions(p, { width: [.3, 3.5], height: [.16, .96], depth: [.5, 1.5], front: [.75, 2.25] }))
        throw new Error('Landing needs bounded dimensions and an existing doorway');
      const [x] = ctx.anchor(doorway.anchor).p;
      return { position: [x, p.height / 2, p.front + p.depth / 2],
        half: [p.width / 2, p.height / 2, p.depth / 2] };
    }

    context.register('landing', {
      describe(entity, ctx) {
        const { position, half } = landingBox(entity, ctx);
        const top = P.surface.plane({ id: 'top', origin: [position[0] - half[0], 2 * half[1], position[2] + half[2]],
          u: [2 * half[0], 0, 0], v: [0, 0, -2 * half[2]] });
        return { bounds: box(position, half), surfaces: [top] };
      }
    });

    context.register('cabinet', {
      describe({ parameters: { position, half } }) {
        if (!Array.isArray(position) || position.length !== 3 || !position.every(n => inside(n, -4, 4)) ||
            !Array.isArray(half) || half.length !== 3 || !half.every(n => inside(n, .05, 1)))
          throw new Error('Cabinet needs a bounded position and positive box half sizes');
        return { bounds: box(position, half) };
      }
    });

    context.rule({
      id: rule, types: ['wall'],
      generate: () => [
        { key: 'doorway', type: 'doorway', parameters: { width: 1.35, height: 1.94 },
          anchor: { host: owner, surface: 'front', uv: [.5, 0] } },
        { key: 'landing', type: 'landing', parameters: { width: 1.65, height: .60, depth: 1.0, front: 1.60 } },
        { key: 'cabinet', type: 'cabinet', parameters: { position: [1.73, .42, 1.43], half: [.34, .42, .31] } }
      ]
    });
    if (!snapshot) document.create('wall', { id: owner, parameters: wallSize });

    function realize() {
      const wall = document.get(owner), doorway = document.get(part('doorway')), landing = document.get(part('landing')),
        cabinet = document.get(part('cabinet')), checks = [];
      if (!wall || !doorway || !landing)
        return { checks: [check('required-parts', false, 'The wall, doorway and landing are required')] };
      const x = context.anchor(doorway.id).p[0], { width, height, depth } = wall.parameters;
      const { width: openingWidth, height: openingHeight } = doorway.parameters;
      const left = x - openingWidth / 2, right = x + openingWidth / 2, edge = width / 2;
      const openingFits = left >= -edge + .12 && right <= edge - .12 && openingHeight <= height - .12;
      checks.push(check('opening-fits-wall', openingFits, 'The opening leaves space for both jambs and a lintel'));

      const { width: landingWidth, height: rise, front } = landing.parameters;
      const stair = P.routes.fitStairApproach({ landing: [x, rise, front], direction: [0, 0, -1], height: () => 0,
        accept: point => point[2] >= depth / 2 + .04, rise: .16, tread: .28 });
      checks.push(check('stair-fits-approach', stair !== null, 'The stair fits between the doorway and landing'));
      if (!openingFits || !stair) return { checks };

      const stone = [1, 2, 3, 4, 5], tread = [2, 4, 5, 6], oak = [7, 8, 9, 10];
      const bodies = [];
      const solid = (id, position, half, ramp) => bodies.push({ id, position, half, ramp });
      solid('floor', [0, -.14, 0], [4, .14, 4], [0, 1, 2, 3]);
      solid('west-jamb', [(left - edge) / 2, height / 2, 0], [(left + edge) / 2, height / 2, depth / 2], stone);
      solid('east-jamb', [(right + edge) / 2, height / 2, 0], [(edge - right) / 2, height / 2, depth / 2], stone);
      solid('lintel', [x, (height + openingHeight) / 2, 0], [openingWidth / 2, (height - openingHeight) / 2, depth / 2], stone);
      const platform = landingBox(landing, context);
      solid('landing', platform.position, platform.half, tread);
      for (let index = 0; index < stair.risers; index++) {
        const top = (index + 1) * stair.rise, z = stair.toe[2] + (index + .5) * stair.tread;
        solid('tread-' + (index + 1), [x, top / 2, z], [landingWidth / 2, top / 2, stair.tread / 2], tread);
      }
      if (cabinet) solid('cabinet', cabinet.parameters.position, cabinet.parameters.half, oak);

      const run = K.world.runtime.create({ systems: { place: { kind: 'mechanics', config: {
        bodies: Object.fromEntries(bodies.map(({ id, position, half }) => [id, { position, half, fixed: true }]))
      } } } });
      const query = run.query();
      const collision = {
        supports(x, z, low, high) {
          return query.probe('place/support', [x, (low + high) / 2, z], { low, high }).value;
        },
        clearance(point) { return query.probe('place/clearance', point).value; }
      };
      const character = K.world.characters.create({ tuning: { flatBottom: true, radius: .22, height: 1.4, stepUp: .22, walkSpeed: 1.8 } });
      const start = [x, .7, -1.65], target = [x, rise + .7, platform.position[2]];
      let actor = character.state({ position: start });
      const points = [start];
      for (let i = 0; i < 240 && actor.position[2] < target[2]; i++) {
        const next = character.step(actor, { move: [0, 1], climb: false }, 1 / 60, collision);
        actor = next.actor;
        if (i % 12 === 0 && K.V.dist(points.at(-1), actor.position) > .05) points.push(actor.position);
      }
      const reached = actor.position[2] >= target[2] && Math.abs(actor.position[1] - target[1]) < .04;
      checks.push({ ...check('walk-to-landing', reached, reached ? 'The capsule reached the landing through the doorway' :
        'The capsule could not walk from the entrance to the landing'), target, reached: actor.position,
        points: points.at(-1) === actor.position ? points : points.concat([actor.position]) });

      const B = makeBuilder(document.seed(), [0x202331, 0x37394a, 0x4e4d61, 0x66677d, 0x8b8390, 0xb2a397,
        0xe0c69c, 0x39282b, 0x65504a, 0x8e6a51, 0xbe8a5e]);
      const S = K.sculpt(makeSculpt(B));
      S.sun = K.V.norm([-.65, 1.4, 1]);
      for (const { id, position, half, ramp } of bodies)
        S.box(position, half, { r: ramp }, { tag: id, res: id === 'floor' ? .20 : .10 });
      S.bake();
      return { checks, world: B.finish({ cam: { target: [0, .85, .30], dist: 8.5, yaw: .61, pitch: .54 },
        radius: 8, detail: 20, dither: .15 }) };
    }
    return { document, context, realize };
  }

  return { id, name: 'Editable stone passage', seed, authoring,
    build(seed, options) {
      const session = authoring(seed, options);
      try {
        session.context.reconcile();
        const { world, checks } = session.realize();
        const failures = checks.filter(check => !check.pass);
        if (failures.length) throw new Error(failures.map(check => check.message).join('. '));
        return world;
      } finally {
        session.context.dispose();
      }
    }
  };
};
