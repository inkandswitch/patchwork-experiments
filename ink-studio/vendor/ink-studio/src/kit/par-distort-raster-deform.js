/* Landmark and analytic inverse maps for raster warps. */
(function (P) {
  const W=P.rasterWarp, R=P.raster;
  const {view,output,tuple,int,finite,bounded,fraction,clamp,wrap,raster,sampler,paint,mix,fieldFrom}=P.rasterWarpSupport;
  const coordinates=(rows,n)=>Array.isArray(rows) && int(rows.length,n,16384) && Array.from(rows).every(p=>tuple(p,2,bounded));

  function controlIndices(from,to,triangles) {
    if (!coordinates(from,3) || !coordinates(to,3) || from.length!==to.length ||
        !(Array.isArray(triangles) || ArrayBuffer.isView(triangles)))
      throw new TypeError('Mesh warp needs matching 2D landmarks and indexed triangles');
    const indices=Array.isArray(triangles[0]) ? triangles.flatMap(t=>{
      if (!tuple(t,3,Number.isSafeInteger)) throw new TypeError('Warp faces must be triangles');
      return t;
    }) : triangles;
    if (!int(indices.length,3,98304) || indices.length%3 ||
        !Array.from(indices).every(i=>int(i,0,to.length-1)))
      throw new RangeError('Mesh warp needs valid bounded triangle indices');
    for (let i=0;i<indices.length;i+=3) {
      const a=indices[i],b=indices[i+1],c=indices[i+2];
      if (a===b || b===c || a===c) throw new RangeError('Warp triangles need distinct vertices');
    }
    return indices;
  }

  function triangular(from,to,indices,{width,height}) {
    const data=new Float32Array(width*height*3);
    let work=0;
    const project=point=>[point[0]*width,point[1]*height];
    for (let i=0;i<indices.length;i+=3) {
      const a=indices[i],b=indices[i+1],c=indices[i+2];
      const [ax,ay]=project(to[a]),[bx,by]=project(to[b]),[cx,cy]=project(to[c]);
      const ux=bx-ax,uy=by-ay,vx=cx-ax,vy=cy-ay,det=ux*vy-uy*vx;
      if (Math.abs(det)<1e-9) continue;
      const x0=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-.5)), y0=Math.max(0,Math.ceil(Math.min(ay,by,cy)-.5));
      const x1=Math.min(width-1,Math.floor(Math.max(ax,bx,cx)-.5)), y1=Math.min(height-1,Math.floor(Math.max(ay,by,cy)-.5));
      work+=Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1);
      if (work>64e6) throw new RangeError('Mesh warp exceeds its triangle visit budget');
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
        const dx=x+.5-ax,dy=y+.5-ay;
        const r=(dx*vy-dy*vx)/det,s=(ux*dy-uy*dx)/det,t=1-r-s;
        if (r < -1e-8 || s < -1e-8 || t < -1e-8) continue;
        const q=(y*width+x)*3;
        for (let k=0;k<2;k++) data[q+k]=from[a][k]*t+from[b][k]*r+from[c][k]*s;
        data[q+2]=1;
      }
    }
    return raster(width,height,3,data);
  }

  function mesh(source,{from,to,triangles}={},settings={}) {
    view(source);
    const field=triangular(from,to,controlIndices(from,to,triangles),output(source,settings));
    return {value:W.sample(source,field,settings),field};
  }

  function grid(source,{columns,rows,points}={},settings={}) {
    if (!int(columns,2,128) || !int(rows,2,128) || !coordinates(points,4) || points.length!==columns*rows)
      throw new RangeError('Grid warp needs a row-major lattice of 2D landmarks');
    const layout=TexturedSurface.grid({segments:[columns-1,rows-1],point:(u,v)=>[u,v,0]});
    const from=Array.from({length:points.length},(_,i)=>[layout.uvs[i*2],layout.uvs[i*2+1]]);
    return mesh(source,{from,to:points,triangles:layout.triangles},settings);
  }

  function polar(source,{mode='fromPolar',center=[.5,.5],radii=[0,.5],angle=0,clockwise=true,...settings}={}) {
    view(source);
    const {width,height}=output(source,settings), fit=Math.min(width,height), strip=mode==='fromPolar';
    if (!['fromPolar','toPolar'].includes(mode) || !tuple(center,2,bounded) ||
        !tuple(radii,2,n=>finite(n) && n>=0 && n<=16) || radii[0]>=radii[1] ||
        !bounded(angle) || typeof clockwise!=='boolean') throw new RangeError('Invalid polar mapping coordinates');
    const [cx,cy]=center,[low,high]=radii,span=high-low, turn=Math.PI*2, direction=clockwise ? 1 : -1;
    const base=wrap(angle), sourceFit=Math.min(source.width,source.height);
    const field=fieldFrom(width,height,3,(u,v,_x,_y,_p,out)=>{
      if (strip) {
        const dx=(u-cx)*width/fit,dy=(v-cy)*height/fit,r=Math.hypot(dx,dy);
        out[0]=wrap(direction*(Math.atan2(dy,dx)/turn-base));
        out[1]=(r-low)/span; out[2]=Number(r>=low && r<=high);
        if (!out[2]) out[1]=0;
      } else {
        const theta=(base+direction*u)*turn,r=(low+span*v)*sourceFit;
        out[0]=cx+Math.cos(theta)*r/source.width; out[1]=cy+Math.sin(theta)*r/source.height; out[2]=1;
      }
    });
    return {value:W.sample(source,field,{...settings,...(strip && {edgeU:settings.edgeU ?? 'wrap'})}),field};
  }

  function displace(source,map,{units='pixels',center=0,scale=[1,0],...settings}={}) {
    view(source);
    const {width,height,data,channels}=view(map);
    const offset=Array.isArray(center) ? center : [center,center];
    if (![1,2].includes(channels) || !['pixels','normalized'].includes(units) || !tuple(offset,2,bounded) || !tuple(scale,2,bounded))
      throw new RangeError('Displacement needs one or two numeric channels and a finite centre and scale');
    const sx=scale[0]/(units==='pixels' ? source.width : 1),sy=scale[1]/(units==='pixels' ? source.height : 1);
    const field=fieldFrom(width,height,2,(u,v,_x,_y,p,out)=>{
      out[0]=u-(data[p*channels]-offset[0])*sx;
      out[1]=v-(data[p*channels+channels-1]-offset[1])*sy;
    });
    return {value:W.sample(source,field,settings),field};
  }

  function refract(source,map,{channel=0,heightScale=1/255,index=1.33,depth=8,...settings}={}) {
    view(source);
    const {width,height}=view(map);
    if (!bounded(heightScale) || !finite(index) || index<1 || index>4 || !finite(depth) || depth<0 || depth>4096)
      throw new RangeError('Invalid refraction height scale, index or depth');
    const heights=R.channel(map,{channel}).data, ratio=1/index;
    const at=(x,y)=>heights[clamp(y,0,height-1)*width+clamp(x,0,width-1)];
    const field=fieldFrom(width,height,2,(u,v,x,y,_p,out)=>{
      const dx=(at(x+1,y)-at(x-1,y))*heightScale/2, dy=(at(x,y+1)-at(x,y-1))*heightScale/2;
      const length=Math.hypot(dx,dy,1);
      if (!finite(length)) throw new RangeError('Refraction height gradients are out of range');
      const n=1/length, k=ratio*n-Math.sqrt(Math.max(0,1-ratio*ratio*(1-n*n))), z=ratio-k*n;
      out[0]=u-k*dx*n*depth/z/source.width; out[1]=v-k*dy*n*depth/z/source.height;
    });
    return {value:W.sample(source,field,settings),field};
  }

  function morph(a,b,{from,to,triangles}={},amount=.5,settings={}) {
    view(a); view(b);
    if (!fraction(amount)) throw new RangeError('Morph amount must be from zero to one');
    const indices=controlIndices(from,to,triangles);
    const {width,height}=output(a,settings);
    if (amount===0 || amount===1) {
      const endpoint=amount===0 ? a : b;
      return endpoint.width===width && endpoint.height===height ? R.rgba(endpoint) :
        W.sample(endpoint,W.field({width,height}),settings);
    }
    const rgba=new Uint8Array(width*height*4);
    const atA=sampler(a,settings),atB=sampler(b,settings), x=new Float64Array(4),y=new Float64Array(4),z=new Float64Array(4);
    const blended=from.map((p,i)=>p.map((n,k)=>n*(1-amount)+to[i][k]*amount));
    const aData=triangular(from,blended,indices,{width,height}).data;
    const bData=triangular(to,blended,indices,{width,height}).data;
    for (let p=0;p<width*height;p++) {
      const i=p*3;
      if (!aData[i+2]) continue;
      atA(aData[i],aData[i+1],x); atB(bData[i],bData[i+1],y);
      mix(x,y,amount,z);
      paint(rgba,p*4,z);
    }
    return raster(width,height,4,rgba);
  }

  Object.assign(W,{mesh,grid,polar,displace,refract,morph});
})(KIT.procedural);
