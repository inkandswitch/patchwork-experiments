/* Native Gaussian splats for sampled field geometry. */
(function (K) {
  const V = K.V, finite = Number.isFinite, { freeze } = K.procedural.data;
  const check = (ok,message) => { if (!ok) throw new TypeError('Field views: ' + message); };
  const shape = (o,keys) => K.world.data.record(o) && Object.keys(o).every(key => keys.includes(key));
  const vec = (p,size=3) => Array.isArray(p) && p.length === size && Array.from(p).every(finite);
  const budget = n => Number.isSafeInteger(n) && n >= 1 && n <= 500000;
  const defaultRamp = ['#192b68','#276f9b','#32bbb3','#dddf8b','#ffad63'];
  const kinds = {
    slice:['plane','counts'],
    lic:['plane','counts','length','step','seed','grain','kernel','motion','minSpeed','maxWork'],
    contours:['plane','levels','cell','maxCells'],
    isosurface:['level','inside','resolution','maxCells','maxTriangles','edgeRefinements'],
    streamlines:['seeds','maxChecks','direction','step','minStep','tolerance','normalize','maxLength',
      'maxSteps','closeDistance'],
    glyphs:['points','plane','counts','scale','normalize','minLength','maxLength']
  };
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));

  function rgb(hex) {
    check(typeof hex === 'string' && /^#[\da-f]{6}$/i.test(hex),'colors need six-digit RGB hex');
    const value = parseInt(hex.slice(1),16);
    return [value>>>16,value>>>8&255,value&255];
  }

  function styleOf({ color,ramp,domain,opacity=1,width=.018,head=.32,light=[-.35,.7,.6],ambient=.4 } = {}) {
    check((color === undefined || ramp === undefined) && (ramp === undefined || Array.isArray(ramp) &&
      ramp.length >= 2 && ramp.length <= 32) && (domain === undefined ||
      vec(domain,2) && domain[0] < domain[1] && finite(domain[1]-domain[0])) &&
      finite(opacity) && opacity >= 0 && opacity <= 1 && finite(width) && width > 0 &&
      finite(head) && head > 0 && head <= .8 && vec(light) && finite(V.len(light)) && V.len(light) > 1e-9 &&
      finite(ambient) && ambient >= 0 && ambient <= 1,'invalid field view style');
    return { colors:color === undefined ? Array.from(ramp ?? defaultRamp,rgb) : [rgb(color)],
      domain,opacity,width,head,light:V.norm(light),ambient };
  }

  function transfer(style,range) {
    const { colors } = style, [lo,hi] = style.domain ?? range ?? [0,1];
    if (colors.length === 1) return () => colors[0];
    return value => {
      const fraction = value == null || lo === hi ? .5 : clamp((value-lo)/(hi-lo),0,1);
      const at = fraction*(colors.length-1), i = Math.floor(at);
      const a = colors[i], b = colors[Math.min(i+1,colors.length-1)];
      return a.map((n,k) => Math.round(n+(b[k]-n)*(at-i)));
    };
  }

  function segment(B,a,b,width,color,density) {
    const d = V.sub(b,a), length = V.len(d);
    if (length < 1e-8) return;
    B.stick(...V.mad(a,d,.5),V.mul(d,1/length),length*.41,width,color,density);
  }

  function arrow(B,row,frame,style,color,density) {
    const { from,to } = row, d = V.sub(to,from), length = V.len(d);
    if (length < 1e-8) return;
    const aim = V.mul(d,1/length);
    const lateral = V.cross(frame?.normal ?? [0,1,0],aim);
    const side = V.norm(V.len(lateral) > 1e-6 ? lateral : V.cross([1,0,0],aim));
    const head = length*style.head, base = V.mad(to,aim,-head);
    const width = Math.min(style.width,head*.27);
    segment(B,from,base,width,color,density);
    segment(B,to,V.mad(base,side,head*.6),width,color,density);
    segment(B,to,V.mad(base,side,-head*.6),width,color,density);
    if (!frame) {
      const third = V.cross(aim,side);
      segment(B,to,V.mad(base,third,head*.6),width,color,density);
    }
  }

  function drawSlice(B,view,tint,density) {
    const { frame,counts,values } = view, { origin,u,v,normal,size } = frame;
    const dx = size[0]/counts[0], dy = size[1]/counts[1];
    for (let i=0;i<values.length;i++) {
      if (values[i] === null) continue;
      const point = V.mad(V.mad(origin,u,(i%counts[0]+.5)*dx),v,(Math.floor(i/counts[0])+.5)*dy);
      B.dab(...point,normal,u,dx*.49,dy*.49,Math.min(dx,dy)*.05,tint(values[i]),density);
    }
  }

  function drawSurface(B,{ mesh,level },style,tint,density) {
    const { positions,normals } = mesh, base = tint(level);
    for (let i=0;i<positions.length;i+=9) {
      let a = Array.from(positions.subarray(i,i+3)), b = Array.from(positions.subarray(i+3,i+6)),
        c = Array.from(positions.subarray(i+6,i+9));
      const lengths = [V.dist(a,b),V.dist(b,c),V.dist(c,a)];
      if (lengths[1] > lengths[0] && lengths[1] > lengths[2]) [a,b,c] = [b,c,a];
      else if (lengths[2] > lengths[0]) [a,b,c] = [c,a,b];
      const length = Math.max(...lengths);
      if (length < 1e-8) continue;
      const normal = Array.from(normals.subarray(i,i+3)), u = V.mul(V.sub(b,a),1/length);
      const height = V.len(V.cross(u,V.sub(c,a)));
      if (height < 1e-8) continue;
      const light = style.ambient+(1-style.ambient)*clamp(V.dot(normal,style.light),0,1);
      const color = base.map(value => Math.round(value*light));
      const center = V.mul(V.add(V.add(a,b),c),1/3);
      B.dab(...center,normal,u,length*.44,height*.43,Math.min(.016,height*.21),color,density);
    }
  }

  function estimate(view) {
    if (view.kind === 'slice' || view.kind === 'lic') return view.values.reduce((n,value) => n+Number(value !== null),0);
    if (view.kind === 'isosurface') return view.mesh.positions.length/9;
    if (view.kind === 'glyphs') return view.arrows.length*(view.frame ? 3 : 4);
    return view.paths.reduce((n,row) => n+Math.max(0,row.points.length-1),0);
  }

  function emit(B,view,style,id) {
    const first = B.count();
    if (style.opacity > 0) {
      const tint = transfer(style,view.range), density = 1.5*style.opacity;
      if (view.kind === 'slice' || view.kind === 'lic') drawSlice(B,view,tint,density);
      else if (view.kind === 'isosurface') drawSurface(B,view,style,tint,density);
      else if (view.kind === 'glyphs')
        for (const row of view.arrows) arrow(B,row,view.frame,style,tint(row.magnitude),density);
      else {
        for (const row of view.paths)
          for (let i=1;i<row.points.length;i++) {
            const value = row.level ?? row.magnitudes?.[i-1] ?? row.magnitudes?.[i];
            segment(B,row.points[i-1],row.points[i],style.width,tint(value),density);
          }
      }
    }
    const count = B.count()-first;
    if (count) B.describeSplats?.(first,B.count(),{ object:'fieldView/'+id,material:'field-'+view.kind,
      target:{surface:'fieldView/'+id,tags:['field-view',view.kind]} });
    return { id,first,count,kind:view.kind,units:view.units,range:view.range };
  }

  function stamp(B,view,{ id = 'field', style, maxSplats = 250000 } = {}) {
    check(Object.hasOwn(kinds,view?.kind) && K.world.data.id(id) && budget(maxSplats),'invalid field view stamp');
    const ink = styleOf(style);
    check(ink.opacity === 0 || estimate(view) <= maxSplats,'visualization exceeds its splat budget');
    return emit(B,view,ink,id);
  }

  function prepare(layers) {
    if (layers === undefined) return [];
    check(Array.isArray(layers) && layers.length <= 16,'expected up to 16 field visualization layers');
    const ids = new Set();
    return Array.from(layers,layer => {
      const { id,kind,field,bounds,args,measure,options={},style } = layer ?? {};
      check(shape(layer,['id','kind','field','bounds','args','measure','options','style']) &&
        K.world.data.id(id) && !ids.has(id) && Object.hasOwn(kinds,kind) &&
        typeof field === 'string' && field.trim().length > 0 && field.length <= 256 &&
        (measure === undefined || measure === 'magnitude') && shape(options,kinds[kind]),
        'invalid or duplicate field visualization layer');
      if (bounds !== undefined) K.world.fields.bounds(bounds);
      check(args === undefined || K.world.data.record(args),'expected a field query argument record');
      check(style === undefined || shape(style,['color','ramp','domain','opacity','width','head','light','ambient']),
        'unexpected field view style property');
      ids.add(id);
      return { id,kind,field,bounds,args,measure,options,style:styleOf(style) };
    });
  }

  function stampQuery(B,query,layers,{ bounds, maxSplats = 250000 } = {}) {
    const reports = [], plans = [];
    check(budget(maxSplats),'invalid field visualization splat budget');
    let remaining = maxSplats;
    for (const layer of prepare(layers)) {
      const { id,kind,field,bounds:box,args,measure,options,style } = layer;
      const source = K.fieldViews.fromQuery(query,field,{bounds:box,fallbackBounds:bounds,args});
      const view = K.fieldViews[kind](measure ? K.fieldViews.magnitude(source) : source,options);
      if (style.opacity > 0) remaining -= estimate(view);
      check(remaining >= 0,'visualization exceeds its splat budget');
      plans.push({ id,field,view,style });
    }
    for (const { id,field,view,style } of plans) {
      const {first,...report} = emit(B,view,style,id);
      reports.push({ ...report,field });
    }
    return freeze(reports);
  }

  Object.assign(K.fieldViews,{stamp,stampQuery,prepare});
  Object.freeze(K.fieldViews);
})(KIT);
