(function (K) {
  const P = K.procedural;
  const colors = {
    basalt: [85, 110, 106],
    glaze: [45, 136, 123],
    coral: [228, 123, 95],
    ochre: [219, 178, 96],
    cream: [226, 220, 180]
  };
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const box = (center, half, material) => P.pieces.box(center, half, identity, { material }).mesh;
  const tube = (a, b, radius, material) => P.pieces.tube(a, b, radius, { material }, 6).mesh;

  function courses() {
    const layout = P.fittedCourses({ width: 4.8, height: 1.9, unit: [0.8, 0.4], joint: 0.05, stagger: 0.5 });
    return layout.cells.map(({ row, inset }) => {
      const [x, y] = inset.min;
      const [right, top] = inset.max;
      return box(
        [(x + right) / 2, (y + top) / 2, 0],
        [(right - x) / 2, (top - y) / 2, 0.18],
        row % 2 ? 'glaze' : 'basalt'
      );
    });
  }

  function cells() {
    const field = (x, z) => Math.max(Math.hypot(x, z) - 2.2, 0.75 - Math.hypot(x, z));
    const layout = P.planarCells.layout({ min: [-2.2, 0, -2.2], max: [2.2, 0, 2.2] }, field, { size: 0.72, seed: 8 });
    return layout.cells.map((cell, index) =>
      P.planarCells.prism(cell, { bottom: -0.2, top: 0.08, material: index % 3 ? 'glaze' : 'cream' }).mesh()
    );
  }

  function skirt() {
    const ground = {
      height: (x, z) => 0.23 * x + 0.17 * z,
      slopeBound: 0.29,
      bounds: { min: [-2, -0.8, -1.3], max: [2, 0.8, 1.3] }
    };
    const outline = [
      [-2, 1, -1.15],
      [2, 1, -1.15],
      [2, 1, 1.15],
      [-2, 1, 1.15]
    ];
    const support = P.supportSkirt({ ground, outline, overlap: 0 });
    const mesh = support.mesh({ material: 'basalt', surface: 'support' });
    // The platform covers this cap. Omit it from the gallery's painter pass.
    const sides = { ...mesh, groups: mesh.groups.filter(group => group.surface !== 'support-top') };
    return [sides, box([0, 1.23, 0], [2.1, 0.23, 1.25], 'ochre')];
  }

  function span() {
    const sockets = [
      { id: 'a', point: [-2.5, 2, 0], group: 'cable' },
      { id: 'b', point: [2.5, 2.8, 0], group: 'cable' }
    ];
    const edges = P.proximity.connect(sockets);
    const out = sockets.map(({ point: [x, y, z] }) => box([x, y / 2, z], [0.17, y / 2, 0.17], 'basalt'));
    for (const edge of edges) {
      const [a, b] = [edge.a, edge.b].map(id => sockets.find(socket => socket.id === id).point);
      const catenary = P.spans.catenary(a, b, { sag: 0.9 });
      for (let i = 0; i < 24; i++) {
        const { point } = catenary.sample(i / 24);
        const next = catenary.sample((i + 1) / 24).point;
        out.push(tube(point, next, 0.045, 'ochre'));
        if (i % 3 === 2) out.push(box(K.V.sub(point, [0, 0.16, 0]), [0.08, 0.15, 0.045], 'coral'));
      }
    }
    return out;
  }

  function clipped() {
    const a = box([0, 0, 0], [1.1, 1.1, 1.1], 'glaze');
    return [P.geometry.clipConvex(a, [{ normal: [0.8, 0.45, 1], offset: 0.45 }], { material: 'coral' })];
  }

  function population() {
    const region = { min: [-2, 0, -2], max: [2, 0, 2] };
    const result = P.populations.layout(
      [region],
      (x, z) => ({
        density: Math.min(0.9, Math.max(0, (2.3 - Math.hypot(x, z)) * 0.4))
      }),
      { spacing: 0.55, slots: 3, seed: 11 }
    );
    return [
      box([0, -0.1, 0], [2.15, 0.1, 2.15], 'basalt'),
      ...result.instances.map(({ point: [x, z], scale, rank }) =>
        tube([x, 0, z], [x, scale * (0.25 + rank), z], 0.075, rank < 0.25 ? 'ochre' : 'coral')
      )
    ];
  }

  function sweptMask() {
    const mask = P.masks.compose([
      {
        id: 'sweep',
        points: [
          [-2, -0.7],
          [-0.6, 0.2],
          [1.7, 0.25]
        ],
        radii: [0.28, 0.63, 1]
      },
      { id: 'erase', points: [[1.37, 0.26]], width: 0.72, operation: 'erase', order: 1 }
    ]);
    const field = ([x, y, z]) => Math.max(mask.distance([x, z]), Math.abs(y) - 0.15);
    return [
      P.geometry.implicitSurface(
        field,
        { min: [-2.5, -0.3, -1.5], max: [2.9, 0.3, 1.5] },
        { resolution: 0.085, meta: { material: 'glaze' } }
      )
    ];
  }

  function profiledCut() {
    const profile = [
      [-0.8, -0.73],
      [0.8, -0.73],
      [0.8, 0.27],
      [0.58, 0.62],
      [0, 0.85],
      [-0.58, 0.62],
      [-0.8, 0.27]
    ];
    const cut = P.profileCut({ profile, span: [-1.2, 1.2] });
    const shell = point => Math.max(Math.abs(point[0]) - 1.75, Math.abs(point[1]) - 1.22, Math.abs(point[2]) - 0.52);
    const lining = cut.lining(0.19, shell);
    const body = point => Math.max(cut.subtract(shell)(point), -lining(point));
    const bounds = { min: [-1.9, -1.4, -0.65], max: [1.9, 1.4, 0.65] };
    return [
      [body, 'basalt'],
      [lining, 'coral']
    ].map(([field, material]) => P.geometry.implicitSurface(field, bounds, { resolution: 0.09, meta: { material } }));
  }

  function clearance() {
    const beam = P.pieces.beam([-1.85, 0, 0], [1.85, 0, 0], 0.55, 0.6, { material: 'basalt' });
    const probes = [
      { min: [-0.6, -0.1, -0.12], max: [0.1, 0.4, 0.38] },
      { min: [0.42, 0.62, 0.18], max: [1.12, 1.12, 0.68] }
    ];
    const field = P.clearance.field([{ ...beam, id: 'beam' }]);
    return [
      beam.mesh,
      ...probes.map(candidate => {
        const center = candidate.min.map((v, i) => (v + candidate.max[i]) / 2);
        const half = candidate.min.map((v, i) => (candidate.max[i] - v) / 2);
        return box(center, half, field.probe(candidate).clear ? 'glaze' : 'coral');
      })
    ];
  }

  function emittedSamples() {
    const emitter = P.emitters.compile({
      id: 'plume',
      p: [0, 0.12, 0],
      color: [1, 0.6, 0.2],
      height: 2.1,
      speed: 1,
      spread: 0.55,
      growth: 1,
      count: 36,
      direction: [0.35, 1, 0.15]
    });
    return [
      box([0, 0, 0], [0.9, 0.12, 0.9], 'basalt'),
      ...emitter
        .samples(0.71)
        .filter(p => p.opacity > 0.07)
        .map(({ p, size, opacity }) => box(p, [size, size, size], opacity > 0.38 ? 'ochre' : 'coral'))
    ];
  }

  const routeStyles = P.styles.catalog({
    base: {
      construction: { pitch: 0.48, gap: 0.055, depth: 0.12, width: 0.7 },
      materials: { piece: '#2d887b', post: '#556e6a' }
    },
    warm: { extends: 'base', materials: { piece: '#dc9960', post: '#875c60' } }
  });

  function fittedRoute(styleName) {
    const style = routeStyles.resolve(styleName);
    const { pitch, gap, depth, width } = style.construction;
    const outline = [
      [-1.4, -0.85],
      [1.4, -0.85],
      [1.4, 0.85],
      [-1.4, 0.85]
    ];
    const route = P.routes.aroundConvex(outline, [-1.15, 0.5, 0.85], [1.4, 0.98, -0.45], { offset: 0.6 });
    const parts = P.routes.layout(route, { pitch, gap });
    for (const role of ['piece', 'post']) {
      colors[styleName + '/' + role] = P.styles.material(style, role).color.map(v => v * 255);
    }
    const support = box([0, 0.36, 0], [1.4, 0.36, 0.85], 'basalt');
    const resolved = parts.flatMap((part, i) => {
      const { point, side, normal, tangent } = part.frame;
      const frame = K.M.cols(side, normal, tangent);
      const board = P.pieces.box(K.V.mad(point, normal, -depth / 2), [width / 2, depth / 2, part.length / 2], frame, {
        material: styleName + '/piece'
      }).mesh;
      if (i % 3 !== 0) return [board];
      const [x, y, z] = point;
      return [board, box([x, (y - depth) / 2, z], [0.07, (y - depth) / 2, 0.07], styleName + '/post')];
    });
    return [support, ...resolved];
  }

  function surfaceContact() {
    const lower = box([0, 0, 0], [2, 0.1, 1.15], 'basalt');
    const upright = box([0, 0.45, -0.17], [1.65, 0.6, 0.15], 'glaze');
    const cover = box([0.25, 0.26, 0.3], [0.4, 0.16, 0.35], 'cream');
    // Two named carrier surfaces define a seam. A separate solid hides its middle.
    const top = P.geometry.builder(),
      face = P.geometry.builder();
    top.quad([-2, 0.105, -1], [-2, 0.105, 1], [2, 0.105, 1], [2, 0.105, -1], { surface: 'plate' });
    face.quad([-1.65, -0.12, -0.01], [1.65, -0.12, -0.01], [1.65, 1.05, -0.01], [-1.65, 1.05, -0.01], {
      surface: 'face'
    });
    const paths = P.contacts.intersections(P.contacts.index(top.finish()), P.contacts.index(face.finish()));
    const solids = [{ id: 'cover', index: P.contacts.index(cover) }];
    const seams = paths
      .flatMap(path => P.contacts.clipCurve(path.points, solids))
      // Lift the trim off the seam so the palette is visible in the preview.
      .map(run => run.points.map(point => K.V.add(point, [0, 0.045, 0.065])))
      .flatMap(points => points.slice(1).map((point, i) => tube(points[i], point, 0.038, 'coral')));
    return [lower, upright, cover, ...seams];
  }

  function fittedRibbon(shape, material) {
    const inner =
      shape === 'arch'
        ? [[1.2, 0], ...Array.from({ length: 17 }, (_, i) => {
          const angle = (i * Math.PI) / 16;
          return [1.2 * Math.cos(angle), 1 + 1.2 * Math.sin(angle)];
        }), [-1.2, 0]]
        : [[-1.3, 0], [1.3, 0], [1.5, 0.55], [1.5, 1.6], [0.9, 2], [-0.9, 2], [-1.5, 1.6], [-1.5, 0.55]];
    const outer = inner.map(([x, y]) => [x * 1.23, 1 + (y - 1) * 1.26]);
    const band = P.fittedRibbon({ inner, outer, pitch: 0.47, gap: 0.036, closed: shape !== 'arch' });
    return band.cells.flatMap(cell =>
      cell.fragments.map(({ points, edge }) => {
        const vertices = [-0.13, 0.13].flatMap(z => points.map(([x, y]) => [x, y, z]));
        return P.pieces.convex(vertices, P.pieces.boxFaces, {
          key: cell.key + '/' + edge,
          material: cell.index % 3 ? material : 'ochre'
        }).mesh;
      })
    );
  }

  function cutCourses() {
    const width = 5;
    const height = 3;
    const layout = P.fittedCourses({ width, height, unit: [0.64, 0.32], joint: 0.035, stagger: 0.5 });
    const portal = [[1.72, 0], [3.28, 0], ...Array.from({ length: 13 }, (_, i) => {
      const angle = (i * Math.PI) / 12;
      return [2.5 + 0.78 * Math.cos(angle), 1.28 + 0.78 * Math.sin(angle)];
    })];
    const cells = P.surfaceCells.clip(layout.cells, {
      boundary: [[0, 0], [width, 0], [4.65, 2.4], [2.5, height], [0.35, 2.4]],
      holes: [portal]
    });
    return [P.surfaceCells.loft(cells, {
      levels: [-0.13, 0.13],
      step: 0.2,
      sample: ([x, y], level) => [x, y, level + (x - 2.5) ** 2 * 0.065],
      metadata: key => ({ surface: key, material: Number(key.split('/')[0]) < 3 ? 'basalt' : 'glaze' })
    }).finish()];
  }

  function framedWall() {
    const width = 4.8, height = 2.7;
    const fields = P.panelFrames({
      width, height, unit: [1.2, 1.35], beam: .15, braceWidth: .10, braces: 'alternating'
    });
    const holes = [[[1.4, 0], [2.23, 0], [2.23, 1.55], [1.4, 1.55]]];
    const backing = P.surfaceCells.clip([{
      key: 'wall', polygon: [[0, 0], [width, 0], [width, height], [0, height]]
    }], { holes });
    const trim = P.surfaceCells.clip(fields.parts, { holes });
    const sample = ([u, v], level) => {
      const angle = (u - width / 2) * .28, radius = 3.6 + level;
      return [radius * Math.sin(angle), v, radius * Math.cos(angle) - 3.6];
    };
    return [
      P.surfaceCells.loft(backing, { sample, levels: [-.14, 0], step: .18, metadata: { material: 'cream' } }).finish(),
      P.surfaceCells.loft(trim, {
        sample, levels: [0, .09], step: .18,
        metadata: key => ({ surface: key, material: key.startsWith('brace/') ? 'ochre' : 'basalt' })
      }).finish()
    ];
  }

  const examples = [
    ['Fitted courses', 'Staggered units fit the domain and preserve physical joints.', courses],
    ['Masked cells', 'Clipped prisms follow an annular mask with real gaps.', cells],
    ['Gravity support', 'A convex carrier meets the supplied sloping ground.', skirt],
    ['Flexible span', 'Matched sockets carry an arc-length sampled cable.', span],
    ['Convex clipping', 'A closed cap carries its own material role.', clipped],
    ['Stable population', 'World space ranks give each candidate a stable identity.', population],
    ['Swept mask', 'A taper and an erase stroke define a solid with a hole.', sweptMask],
    ['Profile cut and lining', 'An extruded profile cuts through a solid with a separate lining.', profiledCut],
    ['Clearance probe', 'Coral indicates an occupied candidate. Green indicates a clear sample.', clearance],
    ['Directional emitter', 'A fixed-time sample of seeded particles rising along a chosen direction.', emittedSamples],
    ['Fitted route', 'A path wraps the supplied outline and fits pieces up to each bend.', () => fittedRoute('base')],
    [
      'Inherited appearance',
      'The same dimensions and geometry use overridden material roles.',
      () => fittedRoute('warm')
    ],
    ['Surface contacts', 'The seam follows the intersecting faces and stops where a solid covers it.', surfaceContact],
    ['Fitted arch trim', 'Physical joints follow the inner profile through each bend.', () => fittedRibbon('arch', 'cream')],
    ['Fitted hatch trim', 'The same strip layout follows a closed panel profile.', () => fittedRibbon('hatch', 'glaze')],
    ['Clipped surface courses', 'Courses follow a curved carrier and share a physical opening.', cutCourses],
    ['Fitted panel framing', 'Continuous rails, posts and alternating braces follow a curved wall.', framedWall]
  ];

  function triangles(meshes) {
    return meshes.flatMap(mesh =>
      mesh.groups.flatMap(group => {
        const output = [];
        for (let i = group.start; i < group.start + group.count; i += 3) {
          const points = [0, 1, 2].map(j => mesh.positions.slice((i + j) * 3, (i + j + 1) * 3));
          const normal = mesh.normals.slice(i * 3, i * 3 + 3);
          output.push({ points, normal, color: colors[group.material] || colors.basalt });
        }
        return output;
      })
    );
  }

  const panels = examples.map(([name, description, build]) => {
    const article = document.createElement('article');
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 360;
    canvas.setAttribute('aria-label', name + ' geometry');
    const text = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = name;
    const copy = document.createElement('p');
    copy.textContent = description;
    text.append(heading, copy);
    article.append(canvas, text);
    document.getElementById('gallery').append(article);
    return { canvas, faces: triangles(build()) };
  });

  function draw(yaw) {
    const V = K.V;
    const view = V.norm([Math.sin(yaw), 0.72, Math.cos(yaw)]);
    const right = V.norm(V.cross([0, 1, 0], view));
    const up = V.cross(view, right),
      sun = V.norm([-0.45, 0.8, 0.35]);
    for (const { canvas, faces } of panels) {
      if (!faces.length) continue;
      const ctx = canvas.getContext('2d');
      const projected = faces.map(face => ({
        ...face,
        points: face.points.map(p => [V.dot(p, right), -V.dot(p, up), V.dot(p, view)])
      }));
      const min = [Infinity, Infinity],
        max = [-Infinity, -Infinity];
      for (const { points } of projected)
        for (const p of points)
          for (const axis of [0, 1]) {
            min[axis] = Math.min(min[axis], p[axis]);
            max[axis] = Math.max(max[axis], p[axis]);
          }
      const scale = Math.min((canvas.width * 0.8) / (max[0] - min[0]), (canvas.height * 0.75) / (max[1] - min[1]));
      const center = min.map((v, k) => (v + max[k]) / 2);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const depth = face => face.points.reduce((sum, p) => sum + p[2], 0);
      for (const face of projected.sort((a, b) => depth(a) - depth(b))) {
        if (V.dot(face.normal, view) < 0) continue;
        const light = 0.63 + 0.37 * Math.max(0, V.dot(face.normal, sun));
        const color = 'rgb(' + face.color.map(x => Math.round(x * light)).join(',') + ')';
        ctx.beginPath();
        for (const [x, y] of face.points)
          ctx.lineTo(canvas.width / 2 + (x - center[0]) * scale, canvas.height / 2 + (y - center[1]) * scale);
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  const slider = document.getElementById('yaw');
  const update = () => draw((Number(slider.value) * Math.PI) / 180);
  slider.addEventListener('input', update);
  update();
  const byId = id => document.getElementById(id);
  const assembly = { canvas: byId('assemblies'), faces: [] };
  panels.push(assembly);
  retainedExample(K, {
    canvas: assembly.canvas,
    status: byId('assembly-status'),
    resize: byId('resize-mount'),
    undo: byId('undo-mount'),
    redo: byId('redo-mount'),
    draw(canvas, meshes) {
      assembly.faces = triangles(meshes);
      update();
    }
  });
})(KIT);
