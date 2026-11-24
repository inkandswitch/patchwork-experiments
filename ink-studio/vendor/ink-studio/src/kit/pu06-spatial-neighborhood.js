/* Bounded, world-space stencils for shared spatial fields. */
(function (K) {
  const W=K.world, {check,record,own}=W.data;
  const axesByName={x:[0],y:[1],z:[2],xy:[0,1],xz:[0,2],yz:[1,2],xyz:[0,1,2]};

  function prepare(options = {}) {
    check(record(options)&&Object.keys(options).every(key=>['radius','axes','operation','missing','explain'].includes(key)),
      'Invalid spatial neighborhood options');
    const {radius=0,axes='xyz',operation='mean',missing='skip',explain=false}=options;
    check(Number.isFinite(radius)&&radius>=0&&radius<=1e6&&own(axesByName,axes)&&
      ['mean','min','max','gradient'].includes(operation)&&['skip','strict'].includes(missing)&&
      typeof explain==='boolean'&&(operation!=='gradient'||radius>0),'Invalid spatial neighborhood stencil');
    const indices=radius?axesByName[axes].slice():[];
    return {radius,axes,indices,operation,missing,explain,count:1+2*indices.length};
  }

  function average(rows, valueOf) {
    const sum=rows.reduce((total,row)=>total+valueOf(row),0);
    return Number.isFinite(sum)?sum/rows.length:rows.reduce((total,row)=>total+valueOf(row)/rows.length,0);
  }

  function output(type, units, stencil) {
    const {operation}=stencil;
    check(type==='number'||operation==='mean'&&['vec2','vec3'].includes(type),
      'Spatial neighborhood '+operation+' needs '+(operation==='mean'?'a numeric or vector field':'a scalar field'));
    return operation==='gradient'
      ? {type:'vec3',units:units===null?null:units+'/world'}
      : {type,units};
  }

  function sample(query, field, point, stencil, type, explain = stencil.explain) {
    const {radius,indices,operation,missing}=stencil;
    const samples=[];
    function read(at) {
      const {status,value}=query.probe(field,at);
      const row={point:at,status,...(status==='ok'&&{value})};
      samples.push(row);
      return row;
    }
    const center=read(point);
    const pairs=indices.map(axis=>[-radius,radius].map(offset=>{
      const at=point.slice();
      at[axis]+=offset;
      return read(at);
    }));
    const available=samples.filter(row=>row.status==='ok');
    const information=explain&&{field,operation,radius,axes:stencil.axes,missing,samples};
    function report(status, details) {
      return {status,...details,...(explain&&{neighborhood:information})};
    }
    if (!available.length||missing==='strict'&&available.length!==samples.length) {
      const status=samples.every(row=>row.status==='outside')?'outside':'unavailable';
      return report(status,{reason:'Spatial neighborhood has unavailable samples'});
    }
    let value;
    if (operation==='gradient') {
      value=[0,0,0];
      for (let i=0;i<indices.length;i++) {
        const axis=indices[i], [lower,upper]=pairs[i];
        const from=lower.status==='ok'?lower:center, to=upper.status==='ok'?upper:center;
        if (from.status!=='ok'||to.status!=='ok'||from.point[axis]===to.point[axis])
          return report('unavailable',{reason:'Spatial neighborhood gradient needs two samples on axis '+'xyz'[axis]});
        value[axis]=(to.value-from.value)/(to.point[axis]-from.point[axis]);
      }
    } else if (operation==='min'||operation==='max') {
      value=Math[operation](...available.map(row=>row.value));
    } else if (type==='number') {
      value=average(available,row=>row.value);
    } else {
      value=available[0].value.map((_,component)=>average(available,row=>row.value[component]));
    }
    return (Array.isArray(value)?value.every(Number.isFinite):Number.isFinite(value))
      ? report('ok',{value}) : report('unavailable',{reason:'Spatial neighborhood result is out of range'});
  }

  W.spatialNeighborhood=Object.freeze({prepare,output,sample});
})(KIT);
