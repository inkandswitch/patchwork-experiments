/* Publish neighborhood operations as queryable fields with bounded invalidation. */
(function (K) {
  const W=K.world, {check,record,id}=W.data, spatial=W.spatialNeighborhood;

  function coupling(config,{id:system}) {
    const {fields:definitions}=config;
    check(record(definitions)&&Object.keys(definitions).length>0&&Object.keys(definitions).length<=64,
      'A field-coupling system needs 1–64 channels');
    const channels=Object.keys(definitions).sort().map(name=>{
      const raw=definitions[name];
      check(id(name)&&record(raw),'Invalid spatial coupling channel '+name);
      const {source,type='number',units=null,bounds=null,components,...options}=raw;
      check(typeof source==='string'&&source.length>0&&source.length<=193,
        'A spatial coupling channel needs a source field: '+system+'/'+name);
      check(units===null||typeof units==='string'&&units.trim().length>0,'Invalid spatial coupling units for '+system+'/'+name);
      const stencil=spatial.prepare(options);
      check(options.explain===undefined,'Use explain on the spatial query, not the channel');
      const result=spatial.output(type,units,stencil);
      const descriptor=W.spatialFields.define({...result,bounds,components},({query,point,explain})=>{
        const {neighborhood,...sample}=spatial.sample(query,source,point,stencil,type,explain);
        return {...sample,...(explain&&{source:{kind:'spatial-coupling',...neighborhood}})};
      });
      return {name,source,type,units,stencil,descriptor};
    });
    return {
      initial:()=>null,
      fields:Object.fromEntries(channels.map(row=>[row.name,row.descriptor])),
      dependencies:{
        reads:channels.map(({source,stencil,descriptor})=>{
          const domain=descriptor.spatial.bounds;
          return {field:source,bounds:domain&&affectedBounds({axes:'xyz',...domain},{stencil})};
        }),
        writes:channels.map(({name,descriptor})=>({field:name,bounds:descriptor.spatial.bounds}))
      },
      spatialCouplings(query) {
        return channels.map(({name,source,type,units,stencil,descriptor})=>{
          const field=query.field(source), to=system+'/'+name;
          check(field?.spatial&&field.type===type&&field.units===units&&
            (type!=='vec2'||field.spatial.components===descriptor.spatial.components),
          'Incompatible spatial coupling source '+source+' for '+to);
          return {from:field.name,to,writer:system,stencil,bounds:descriptor.spatial.bounds};
        });
      }
    };
  }

  function affectedBounds(area,{bounds:domain,stencil}) {
    if (!area) return domain??null;
    const axes=domain?'xyz':area.axes, min=[], max=[];
    for (let i=0;i<axes.length;i++) {
      const axis=axes[i], index=area.axes.indexOf(axis), padding=stencil.axes.includes(axis)?stencil.radius:0;
      const lo=index<0?-Infinity:area.min[index]-padding, hi=index<0?Infinity:area.max[index]+padding;
      min.push(domain?Math.max(domain.min[i],lo):lo);
      max.push(domain?Math.min(domain.max[i],hi):hi);
      if (min[i]>max[i]) return undefined;
    }
    return {axes,min,max};
  }

  function relays(systems,query) {
    const links=systems.flatMap(system=>system.spatialCouplings(query));
    const byTarget=new Map(links.map(link=>[link.to,link]));
    const budgets=new Map();
    for (const {to} of links) {
      const path=new Set();
      let cursor=to;
      while (byTarget.has(cursor)&&!budgets.has(cursor)) {
        check(!path.has(cursor),'Cyclic spatial coupling at '+cursor);
        check(path.size<12,'Spatial coupling chain exceeds 12 channels at '+to);
        path.add(cursor);
        cursor=byTarget.get(cursor).from;
      }
      let {depth=0,cost=1}=budgets.get(cursor)??{};
      for (const name of [...path].reverse()) {
        depth++;
        cost*=byTarget.get(name).stencil.count;
        check(depth<=12&&cost<=4096,'Spatial coupling sample budget exceeded at '+name);
        budgets.set(name,{depth,cost});
      }
    }
    return links.map(link=>({...link,area:bounds=>affectedBounds(bounds,link)}));
  }

  W.fieldCoupling=Object.freeze({relays});
  W.runtime.register('field-coupling',coupling);
})(KIT);
