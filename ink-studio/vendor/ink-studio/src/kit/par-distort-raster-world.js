/* Route graph rasters into the existing depth-tested surface and splat renderers. */
(function (P) {
  const W=P.rasterWarp, R=P.raster;
  const {view,finite,int,fraction}=P.rasterWarpSupport;
  const list=value=>Array.isArray(value) || ArrayBuffer.isView(value);
  function flatten(value,tuple,limit) {
    if (!list(value) || !value.length || value.length>limit) throw new RangeError('Invalid projected mesh buffer');
    const flat=Array.isArray(value[0]) || ArrayBuffer.isView(value[0]) ? value.flatMap(row=>{
      if (!list(row) || row.length!==tuple) throw new TypeError('Mesh projection needs XYZ vertices, UV pairs and triangles');
      return Array.from(row);
    }) : value;
    if (flat.length>limit || flat.length%tuple || !Array.from(flat).every(finite))
      throw new RangeError('Invalid projected mesh coordinates or indices');
    return flat;
  }

  function surface(source,mesh,{alphaThreshold=128}={}) {
    view(source);
    if (!int(alphaThreshold,1,255)) throw new RangeError('Mesh projection alpha threshold must be in [1,255]');
    const geometry={
      points:flatten(mesh?.points ?? mesh?.positions ?? mesh?.pos,3,196608),
      uvs:flatten(mesh?.uvs,2,131072),
      triangles:flatten(mesh?.triangles ?? mesh?.indices ?? mesh?.faces ?? mesh?.tri,3,600000)
    };
    const {width,height,data}=R.rgba(source), atlas=SpriteSurface.make(width,height);
    atlas.mesh(geometry,width,height,(x,y)=>{
      const i=(y*width+x)*4;
      if (data[i+3]<alphaThreshold) return;
      return (data[i]<<16)|(data[i+1]<<8)|data[i+2];
    });
    const value=atlas.finish();
    if (!value.vertices.every(finite)) throw new RangeError('Projected vertices exceed finite geometry storage');
    return value;
  }

  function project(source,{projection={},space='rest',scale=1,wrap=false,strength=1,stage='material',ink=false}={}) {
    view(source);
    if (!['rest','world'].includes(space) || !['material','lit'].includes(stage) ||
        !finite(scale) || scale<=0 || !fraction(strength) || typeof wrap!=='boolean' || typeof ink!=='boolean' ||
        !P.graphTypes.validator('record')(projection))
      throw new TypeError('Invalid projected raster layer settings');
    if (source.width*source.height>2**20) throw new RangeError('Projected raster exceeds the material pixel budget');
    SplatEffects.project(projection);
    const {width,height,data}=R.rgba(source);
    return {type:'projected',pattern:'raster',projection:P.data.clone(projection),space,scale,strength,stage,ink,
      raster:{width,height,channels:4,wrap,frames:[Array.from(data)]}};
  }

  Object.assign(W,{surface,project});
})(KIT.procedural);
