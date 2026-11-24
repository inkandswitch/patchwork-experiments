/* Resolve retained entities through the same pure styles and frames used by core primitives. */
(function (K) {
  const A = K.authoring,
    P = K.procedural;
  const { V, M } = K;
  const styleCatalogs = new WeakMap();

  function resolveStyle(source, id) {
    const view = A.data.documentView(typeof source.snapshot === 'function' ? source.snapshot() : source);
    if (!styleCatalogs.has(view.styles)) styleCatalogs.set(view.styles, P.styles.catalog(view.styles));
    const catalog = styleCatalogs.get(view.styles);
    const layers = view.environment.styleRef ? [view.environment.styleRef] : [];
    const seen = new Set(),
      active = new Set();
    function visit(key) {
      if (!key || seen.has(key)) return;
      if (active.has(key)) throw new Error('Cyclic appearance relationships: ' + key);
      if (!Object.prototype.hasOwnProperty.call(view.entities, key)) throw new Error('Unknown styled entity: ' + key);
      const entity = view.entities[key];
      active.add(key);
      visit(entity.anchor?.host);
      visit(entity.parent);
      if (entity.styleRef) layers.push(entity.styleRef);
      if (entity.appearance) layers.push(entity.appearance);
      active.delete(key);
      seen.add(key);
    }
    visit(id);
    return catalog.resolve(...layers);
  }

  function anchoredFrame(hit, align) {
    if (align === 'upright') {
      const tangent = [hit.tangent[0], 0, hit.tangent[2]],
        up = [0, 1, 0];
      let x = V.len(tangent) > 1e-8 ? V.norm(tangent) : V.norm(V.cross(up, hit.n));
      if (V.len(x) < 1e-8) x = [1, 0, 0];
      return { R: M.cols(x, up, V.cross(x, up)), t: hit.p };
    }
    if (align === 'normal') {
      const x = V.norm(hit.tangent),
        y = V.norm(hit.n);
      return { R: M.cols(x, y, V.norm(V.cross(x, y))), t: hit.p };
    }
    const z = V.norm(hit.n),
      x = V.norm(V.cross(hit.bitangent, z)),
      y = V.cross(z, x);
    return { R: M.cols(x, y, z), t: hit.p };
  }

  function worldFrame(source, id, { resolveAnchor } = {}) {
    const read = key =>
      source.read
        ? source.read(key)
        : source.get
          ? source.get(key)
          : Object.prototype.hasOwnProperty.call(source.entities, key)
            ? source.entities[key]
            : null;
    const anchor = resolveAnchor || (typeof source.anchor === 'function' ? value => source.anchor(value) : null);
    const chain = [],
      seen = new Set();
    let origin = P.transforms.local();
    while (id) {
      if (seen.has(id)) throw new Error('Cyclic transform: ' + id);
      seen.add(id);
      const entity = read(id);
      if (!entity) throw new Error('Unknown transformed entity: ' + id);
      chain.push(P.transforms.local(entity.parameters.transform));
      if (entity.anchor) {
        if (!anchor) throw new Error('Anchored transforms need a surface context or resolveAnchor');
        const align = entity.anchor.align ?? 'surface';
        if (!['surface', 'normal', 'upright'].includes(align)) throw new Error('Invalid anchor alignment');
        origin = anchoredFrame(anchor(entity.anchor), align);
        break;
      }
      id = entity.parent;
    }
    return chain.reverse().reduce(P.transforms.combine, origin);
  }

  A.styles = { resolve: resolveStyle };
  A.worldFrame = worldFrame;
})(KIT);
