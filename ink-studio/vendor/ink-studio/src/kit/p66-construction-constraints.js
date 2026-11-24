/* Feasible socket placements from named bounds on coordinate differences. */
(function(K) {
  const P=K.procedural, {V}=K, {clone,freeze}=P.data;
  const axisOf=['x','y','z'], datum='$datum', eps=1e-8;
  const own=(row,key)=>Object.hasOwn(row,key);
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const name=value=>typeof value==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(value)&&
    !['constructor','prototype','__proto__'].includes(value);
  const finite=value=>Number.isFinite(value)&&Math.abs(value)<=1e6;
  const xyz=value=>Array.isArray(value)&&value.length===3&&value.every(finite);
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  function check(condition,message) {if(!condition)throw Error(message);}

  function witness(edges,labels,axis) {
    const distances=new Array(labels.length).fill(0), parent=[];
    let latest;
    for(let pass=0;pass<labels.length;pass++){
      latest=undefined;
      for(const edge of edges){
        const {from,to,bound}=edge, candidate=distances[from]+bound;
        if(candidate>=distances[to]-eps)continue;
        distances[to]=candidate;
        parent[to]=edge;
        latest=to;
      }
      if(latest===undefined)return null;
    }
    for(let i=0;i<labels.length;i++)latest=parent[latest].from;
    const cycle=[];
    let cursor=latest;
    do{
      const {from,to,bound,constraint}=parent[cursor];
      cycle.push({constraint,from:labels[from],to:labels[to],maxDifference:bound===0?0:bound});
      cursor=from;
    }while(cursor!==latest);
    cycle.reverse();
    return {axis:axisOf[axis],constraints:[...new Set(cycle.map(row=>row.constraint))].sort(),cycle,
      totalBound:cycle.reduce((sum,row)=>sum+row.maxDifference,0)};
  }
  function shortest(edges,n,reverse) {
    const distance=new Array(n).fill(Infinity);
    distance[0]=0;
    for(let pass=1;pass<n;pass++){
      let changed=false;
      for(const edge of edges){
        const from=reverse?edge.to:edge.from, to=reverse?edge.from:edge.to, next=distance[from]+edge.bound;
        if(next>=distance[to]-eps)continue;
        distance[to]=next;
        changed=true;
      }
      if(!changed)break;
    }
    return distance;
  }
  function place(edges,preferred) {
    const current=edges.slice(), n=preferred.length+1, result=[];
    for(let i=1;i<n;i++){
      const low=-shortest(current,n,true)[i], high=shortest(current,n,false)[i];
      const value=low>high?(low+high)*.5:Math.max(low,Math.min(high,preferred[i-1]));
      current.push({from:0,to:i,bound:value},{from:i,to:0,bound:-value});
      result.push(Object.is(value,-0)?0:value);
    }
    return result;
  }

  function compile(points,source) {
    points=freeze(clone(points));
    const constraints=freeze(clone(source));
    check(record(points)&&Object.keys(points).length>=1&&Object.keys(points).length<=64&&
      Array.isArray(constraints)&&constraints.length<=192,'Construction needs 1–64 points and up to 192 constraints');
    const pointIds=Object.keys(points).sort(), labels=[datum,...pointIds], refs=new Map(), origin={index:0,offset:[0,0,0]};
    for(const [i,id] of pointIds.entries()){
      const p=points[id], sockets=p?.sockets??{};
      check(name(id)&&keys(p,['position','sockets'])&&xyz(p.position)&&record(sockets)&&
        Object.keys(sockets).length<=32&&Object.entries(sockets).every(([socket,offset])=>name(socket)&&xyz(offset)),
      'Invalid construction point or socket '+id);
      refs.set(id,{index:i+1,offset:origin.offset});
      for(const [socket,offset] of Object.entries(sockets))refs.set(id+'/'+socket,{index:i+1,offset});
    }
    function ref(key) {
      check(refs.has(key),'Unknown construction point or socket '+key);
      return refs.get(key);
    }
    const ids=new Set(), pins=new Map(), edges=[[],[],[]], passages=[];
    function range(id,a,b,axis,min,max) {
      const delta=a.offset[axis]-b.offset[axis];
      if(max!==undefined)edges[axis].push({from:a.index,to:b.index,bound:max+delta,constraint:id});
      if(min!==undefined)edges[axis].push({from:b.index,to:a.index,bound:-min-delta,constraint:id});
    }
    for(const row of constraints){
      check(record(row)&&name(row.id)&&!ids.has(row.id),'Construction constraints need unique IDs');
      const {id,type,a,b}=row;
      ids.add(id);
      if(type==='pin'){
        check(keys(row,['id','type','point','position'])&&xyz(row.position),'Invalid pin '+id);
        pins.set(id,{ref:ref(row.point),position:row.position});
      }else if(type==='align'){
        const offset=row.offset??origin.offset;
        check(keys(row,['id','type','a','b','offset'])&&xyz(offset),'Invalid socket alignment '+id);
        for(let axis=0;axis<3;axis++)range(id,ref(a),ref(b),axis,offset[axis],offset[axis]);
      }else if(type==='level'){
        check(keys(row,['id','type','points'])&&Array.isArray(row.points)&&row.points.length>=2&&row.points.length<=64&&
          row.points.length===new Set(row.points).size,'A level constraint needs distinct points '+id);
        const first=ref(row.points[0]);
        for(const next of row.points.slice(1))range(id,first,ref(next),1,0,0);
      }else if(type==='range'){
        const {min,max}=row, axis=axisOf.indexOf(row.axis);
        check(keys(row,['id','type','a','b','axis','min','max'])&&axis>=0&&(min!==undefined||max!==undefined)&&
          (min===undefined||finite(min))&&(max===undefined||finite(max))&&(min===undefined||max===undefined||min<=max),
        'Invalid construction range '+id);
        range(id,ref(a),ref(b),axis,min,max);
      }else if(type==='opening'){
        const {width,height,passage}=row, axis=axisOf.indexOf(width?.axis);
        check(keys(row,['id','type','width','height','passage'])&&keys(width,['a','b','axis','min'])&&[0,2].includes(axis)&&
          keys(height,['a','b','min'])&&[width.min,height.min].every(n=>finite(n)&&n>1e-5),'Invalid opening dimensions '+id);
        range(id,ref(width.a),ref(width.b),axis,width.min,undefined);
        range(id,ref(height.a),ref(height.b),1,height.min,undefined);
        if(passage!==undefined){
          check(keys(passage,['a','b']),'Invalid opening passage '+id);
          ref(passage.a);ref(passage.b);
          passages.push({constraint:id,a:passage.a,b:passage.b,width:width.min,height:height.min});
        }
      }else throw Error('Unknown construction constraint type '+type);
    }
    function checkPins(overrides) {
      check(record(overrides)&&Object.entries(overrides).every(([key,value])=>pins.has(key)&&xyz(value)),
      'Construction overrides need pin constraint IDs and XYZ positions');
    }
    function solve(overrides={}) {
      checkPins(overrides);
      const planes=edges.map(rows=>rows.slice());
      for(const [id,pin] of pins){
        const position=overrides[id]??pin.position;
        for(let axis=0;axis<3;axis++){
          const bound=position[axis]-pin.ref.offset[axis];
          planes[axis].push({from:0,to:pin.ref.index,bound,constraint:id},
            {from:pin.ref.index,to:0,bound:-bound,constraint:id});
        }
      }
      const conflicts=planes.map((plane,axis)=>witness(plane,labels,axis)).filter(Boolean);
      if(conflicts.length)return freeze({status:'conflict',conflicts});
      const axes=planes.map((plane,axis)=>place(plane,pointIds.map(key=>points[key].position[axis])));
      const positions=Object.fromEntries(pointIds.map((key,i)=>[key,axes.map(row=>row[i])]));
      const sockets=Object.fromEntries([...refs].map(([key,{index,offset}])=>[key,V.add(positions[labels[index]],offset)]));
      return freeze({status:'ok',points:positions,sockets});
    }
    return Object.freeze({solve,checkPins,has:key=>refs.has(key),passages:freeze(passages)});
  }
  P.construct.constraints=Object.freeze({compile});
})(KIT);
