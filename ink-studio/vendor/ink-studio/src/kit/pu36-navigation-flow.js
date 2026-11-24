/* Destination fields over the same weighted edges used by tiled walking routes. */
(function(K){
  const W=K.world, P=K.procedural, V=K.V, {record,check}=W.data;
  const {overlaps}=P.spatialDependencies;
  const eps=1e-8;
  const horizontal=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);

  function create(options){
    check(record(options)&&Object.keys(options).every(key=>['maxFields','maxCells'].includes(key)),
      'Invalid navigation flow field settings');
    const {maxFields=8,maxCells=50000}=options;
    check(Number.isSafeInteger(maxFields)&&maxFields>=1&&maxFields<=64&&
      Number.isSafeInteger(maxCells)&&maxCells>=1&&maxCells<=250000,'Invalid navigation flow cache budget');
    const caches=new WeakMap(), work={builds:0,hits:0,invalidated:0};
    let revision=0;

    function include(area,p,pad){
      area.min[0]=Math.min(area.min[0],p[0]-pad);
      area.min[1]=Math.min(area.min[1],p[2]-pad);
      area.max[0]=Math.max(area.max[0],p[0]+pad);
      area.max[1]=Math.max(area.max[1],p[2]+pad);
    }
    function links(map,p,visit){
      const edges=[];
      for(const index of map.near(p)){
        const node=map.node(index);
        visit?.(node.p);
        const weight=map.sampler.edge(node.p,p);
        if(Number.isFinite(weight))edges.push([index,weight]);
      }
      return edges;
    }
    function destination(map,end){
      const {profile,pad}=map;
      let cache=caches.get(profile);
      if(!cache)caches.set(profile,cache=new Map());
      const key=end[0]+','+end[2], found=cache.get(key);
      if(found){
        work.hits++;
        cache.delete(key);
        cache.set(key,found);
        return {entry:found,cached:true};
      }
      const area={axes:'xz',min:[Infinity,Infinity],max:[-Infinity,-Infinity]};
      include(area,end,pad);
      const passable=Number.isFinite(map.sampler.pin(end));
      const seeds=passable?links(map,end,p=>include(area,p,pad)):[];
      const entry={end,area,passable,revision,field:P.routes.travelCosts(seeds,maxCells)};
      cache.set(key,entry);
      work.builds++;
      if(cache.size>maxFields)cache.delete(cache.keys().next().value);
      return {entry,cached:false};
    }
    function invalidate(profiles,areas){
      revision++;
      for(const profile of profiles){
        const cache=caches.get(profile);
        if(!cache)continue;
        for(const [key,entry] of cache){
          if(!areas||areas.some(area=>overlaps(area,entry.area))){
            cache.delete(key);
            work.invalidated++;
          }else entry.revision=revision;
        }
      }
    }
    function report(profiles){
      let cached=0;
      for(const profile of profiles)cached+=caches.get(profile)?.size??0;
      return {revision,cached,...work};
    }
    function sample(map,start,end,{direct,trace}){
      if(!Number.isFinite(map.sampler.pin(start)))return {status:'blocked-pin'};
      const {entry,cached}=destination(map,end), {field}=entry, settled=field.settled;
      const outcome=(status,detail={})=>({status,...detail,
        flow:{revision:entry.revision,cached,settled:field.settled,expanded:field.settled-settled}});
      if(!entry.passable)return outcome('blocked-pin');
      if(horizontal(start,end)<=eps)
        return outcome('ok',{cost:0,next:null,direction:[0,0,0],...(trace&&{path:[start]})});
      const origins=new Map(links(map,start));
      let cost=direct?map.sampler.edge(start,entry.end):Infinity, first=null;
      function candidate(row){
        if(!row||!origins.has(row.i))return;
        const value=row.value+origins.get(row.i);
        if(value<cost||value===cost&&first!==null&&row.i<first){
          cost=value;
          first=row.i;
        }
      }
      for(const i of origins.keys())candidate(field.at(i));
      if(!origins.size&&!Number.isFinite(cost))return outcome('unreachable');
      const status=field.advance((i,visit)=>map.neighbors(i,(node,weight)=>{
        include(entry.area,node.p,map.pad);
        visit(node.index,weight);
      }),bound=>bound>cost,candidate);
      if(status==='budget')return outcome('budget',{reason:'cells'});
      if(!Number.isFinite(cost))return outcome('unreachable');
      const waypoint=i=>i===null?entry.end:map.node(i).p;
      let next=waypoint(first);
      if(first!==null&&horizontal(start,next)<=eps)next=waypoint(field.at(first).next);
      const direction=V.norm(V.sub(next,start),[0,0,0]);
      if(!trace)return outcome('ok',{cost,next,direction});
      const path=[start];
      for(let i=first;i!==null;i=field.at(i).next){
        const p=waypoint(i);
        if(horizontal(path.at(-1),p)>eps)path.push(p);
        if(path.length>4096)return outcome('budget',{reason:'points'});
      }
      if(horizontal(path.at(-1),entry.end)>eps)path.push(entry.end);
      return outcome('ok',{cost,path});
    }
    return Object.freeze({sample,invalidate,report});
  }
  W.navigationFlow=Object.freeze({create});
})(KIT);
