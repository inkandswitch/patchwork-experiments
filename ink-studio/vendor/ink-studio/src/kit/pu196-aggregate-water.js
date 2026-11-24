/* A conservative block grid for plain shallow water. */
(function(K){
  const W=K.world, P=K.procedural, Q=W.query, {check}=W.data, freeze=P.data.freeze;

  function blocks(settings,{width,height,dx,dz,origin,maxDepth,index,rain,drain,friction,system,sensors}){
    const {clamp}=W.fields;
    const {model,factor=4}=settings;
    check(model==='blocks'&&Object.keys(settings).every(key=>key==='model'||key==='factor')&&
      Number.isSafeInteger(factor)&&factor>=2&&factor<=16&&width%factor===0&&height%factor===0,
    'Water block factor must divide both grid dimensions and be 2–16');
    const across=width/factor, rows=height/factor, blockArea=dx*dz*factor*factor, area=dx*dz, count=factor*factor;
    const grid={width:across,height:rows,cell:[dx*factor,dz*factor],origin,maxDepth};
    P.motion.gridSpacing(grid);
    let scratchSolver;
    const getSolver=()=>scratchSolver??=P.motion.shallowWater(grid);
    const block=i=>Math.floor((i%width)/factor)+Math.floor(i/(width*factor))*across;
    function reduce(state){
      const {fluid}=state, {bed,depth,mx,mz}=fluid;
      const beds=new Array(across*rows).fill(0), depths=beds.slice(), xs=beds.slice(), zs=beds.slice();
      for(let i=0;i<depth.length;i++){
        const at=block(i);
        beds[at]+=bed[i];depths[at]+=depth[i];xs[at]+=mx[i];zs[at]+=mz[i];
      }
      return freeze({bed,fluid:{...fluid,bed:beds.map(n=>n/count),depth:depths.map(n=>n/count),
        mx:xs.map(n=>n/count),mz:zs.map(n=>n/count)}});
    }
    function fill(indices,bed,target,depth){
      if(!target)return;
      let base=Infinity,highest=-Infinity;
      for(const i of indices){base=Math.min(base,bed[i]);highest=Math.max(highest,bed[i]);}
      if(base===highest||target>=indices.length*maxDepth){
        const value=Math.min(maxDepth,target/indices.length);
        for(const i of indices)depth[i]=value;
        return;
      }
      const changes=indices.flatMap(i=>[[bed[i]-base,1],[bed[i]-base+maxDepth,-1]])
        .sort((a,b)=>a[0]-b[0]);
      let wet=0,level=0,rest=target;
      for(const [top,change] of changes){
        const room=(top-level)*wet;
        if(wet&&rest<=room){level+=rest/wet;break;}
        rest-=room;level=top;wet+=change;
      }
      let sum=0;
      for(const i of indices){depth[i]=clamp(level-(bed[i]-base),0,maxDepth);sum+=depth[i];}
      let difference=target-sum;
      for(const i of indices){
        if(!difference)break;
        const next=clamp(depth[i]+difference,0,maxDepth);
        difference-=next-depth[i];depth[i]=next;
      }
    }
    function expand(state){
      const {bed,fluid}=state, size=width*height;
      const depth=new Array(size).fill(0), mx=depth.slice(), mz=depth.slice();
      for(let at=0;at<fluid.depth.length;at++){
        const row=Math.floor(at/across)*factor,col=(at%across)*factor, indices=[];
        const mean=fluid.depth[at];
        if(!mean)continue;
        for(let z=row;z<row+factor;z++)for(let x=col;x<col+factor;x++)indices.push(z*width+x);
        fill(indices,bed,mean*count,depth);
        const vx=fluid.mx[at]/mean,vz=fluid.mz[at]/mean;
        for(const i of indices){mx[i]=depth[i]*vx;mz[i]=depth[i]*vz;}
      }
      return freeze({fluid:{...fluid,bed,depth,mx,mz},gate:{},pump:{},terrain:[],manual:{}});
    }
    function measure({fluid},aggregate){
      let volume=0,x=0,z=0;
      for(let i=0;i<fluid.depth.length;i++){volume+=fluid.depth[i];x+=fluid.mx[i];z+=fluid.mz[i];}
      const scale=aggregate?blockArea:area;
      return {volume:volume*scale,momentum:[x*scale,z*scale]};
    }
    function volume(state){return state.fluid.depth.reduce((sum,n)=>sum+n,0)*blockArea;}
    function mass({state}){
      const {startVolume:initial,added,drained,moved:transferred}=state.fluid, total=volume(state);
      return Q.ok({volume:total,initial,added,drained,transferred,error:total-initial-added+drained});
    }
    function at(state,point){
      if(!point)return null;
      const i=index(point[0],point[2]);
      if(i<0)return null;
      const n=block(i), {fluid}=state, depth=fluid.depth[n], bed=fluid.bed[n];
      return {n,bed,depth,surface:depth+bed,velocity:depth>1e-6?[fluid.mx[n]/depth,fluid.mz[n]/depth]:[0,0]};
    }
    function channel(key){
      return ({state,target,args})=>{
        const sample=at(state,target.point);
        if(!sample)return Q.missing('outside water grid','outside');
        return {status:'ok',value:sample[key],...(args.explain&&{source:{kind:'water-block',factor,
          cell:[sample.n%across,Math.floor(sample.n/across)]}})};
      };
    }
    return {quantities:{volume:{units:'world^3'},momentum:{units:'world^4/s'}},reduce,expand,measure,
      validate(state){
        check(Array.isArray(state?.bed)&&state.bed.length===width*height&&
          state.bed.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7),'Invalid retained detailed water bed');
        getSolver().restore(state.fluid);
      },
      step(state,ctx){
        const solver=getSolver();
        solver.restore(state.fluid);
        solver.step(ctx.dt,{rain,drain,friction,...ctx.simulationLOD?.tuning});
        return freeze({bed:state.bed,fluid:solver.checkpoint({shareBed:true})});
      },
      output(state){
        const out={volume:volume(state)};
        for(const [key,[x,z]] of Object.entries(sensors)){
          const sample=at(state,[x,0,z]);
          out['depth.'+key]=sample.depth;
          out['flow.'+key]=sample.depth*Math.hypot(...sample.velocity);
        }
        return out;
      },
      describe:()=>({cells:across*rows,detailCells:width*height}),
      fields:{
        mass,depth:channel('depth'),flow:channel('velocity'),'surface-height':channel('surface'),
        bed:({state,target})=>{
          const p=target.point,i=p?index(p[0],p[2]):-1;
          return i<0?Q.missing('outside water grid','outside'):Q.ok(state.bed[i]);
        },
        water:({state,target})=>{
          const sample=at(state,target.point);
          if(!sample)return Q.missing('outside water grid','outside');
          const {n,...reading}=sample, value={id:system,...reading};
          return reading.depth>1e-6?Q.ok(value):{status:'dry',value};
        }
      }
    };
  }

  W.aggregateWater=blocks;
})(KIT);
