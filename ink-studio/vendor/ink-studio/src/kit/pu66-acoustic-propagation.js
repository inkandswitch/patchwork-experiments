/* Direction-independent acoustic transfer through rooms, apertures and media. */
(function(K){
  const W=K.world, V=K.V, {check,id,record,vector}=W.data, {bounds,clamp}=W.fields;
  const bands=['low','mid','high'], zero=[0,0,0];
  const number=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const point=p=>vector(p)&&p.every(n=>number(n,-1e6,1e6));
  const spectrum=(p,max)=>vector(p)&&p.every(n=>number(n,0,max));
  const amplitude=db=>10**(-db/20);
  const decibels=gain=>-20*Math.log10(gain);
  const same=(a,b)=>a===b||a?.length===b?.length&&a.every((n,i)=>n===b[i]);
  const contains=(box,p)=>p.every((n,i)=>n>=box.min[i]&&n<box.max[i]);
  const defaults={
    air:{speed:343,loss:[.002,.008,.04],interfaceLoss:zero},
    water:{speed:1480,loss:[.006,.02,.08],interfaceLoss:[22,30,42]},
    vacuum:{blocked:true,speed:1,loss:zero,interfaceLoss:zero}
  };
  function materials(input){
    check(record(input)&&Object.keys(input).length<=32,'Invalid acoustic media profiles');
    const catalog=new Map(Object.entries(defaults));
    for(const [name,spec] of Object.entries(input)){
      check(id(name)&&record(spec)&&Object.keys(spec).every(key=>['speed','loss','interfaceLoss','blocked'].includes(key)),
        'Invalid acoustic medium '+name);
      const profile={...defaults[name],...spec};
      const {speed=343,loss=zero,interfaceLoss=zero,blocked=false}=profile;
      check(number(speed,1,10000)&&spectrum(loss,100)&&spectrum(interfaceLoss,200)&&typeof blocked==='boolean',
        'Invalid acoustic medium '+name);
      catalog.set(name,{speed,loss,interfaceLoss,blocked});
    }
    return catalog;
  }
  function openingStyle(spec,key){
    check(record(spec)&&Object.keys(spec).every(k=>['at','fromAt','toAt','openLossDb','closedLossDb','sealed'].includes(k)),
      'Invalid acoustic opening settings '+key);
    const {at,fromAt,toAt,openLossDb=[.1,.35,1.2],closedLossDb=[18,32,52],sealed=false}=spec;
    check([at,fromAt,toAt].every(p=>p===undefined||point(p))&&spectrum(openLossDb,200)&&
      spectrum(closedLossDb,240)&&closedLossDb.every((value,i)=>value>=openLossDb[i])&&typeof sealed==='boolean',
    'Invalid acoustic opening settings '+key);
    return {at,fromAt,toAt,openLossDb,closedLossDb,sealed,openGain:openLossDb.map(amplitude),
      closedGain:sealed?zero:closedLossDb.map(amplitude)};
  }
  function center(box,i){return (box.min[i]+box.max[i])*.5;}
  function junction(a,b){
    if(!a||!b){
      const box=a??b;
      return [center(box,0),center(box,1),box.max[2]];
    }
    return [0,1,2].map(i=>a.max[i]<b.min[i]?(a.max[i]+b.min[i])*.5:
      b.max[i]<a.min[i]?(b.max[i]+a.min[i])*.5:
      (Math.max(a.min[i],b.min[i])+Math.min(a.max[i],b.max[i]))*.5);
  }
  function mouth(at,box,port){
    if(!box)return at;
    return at.map((value,i)=>{
      const min=i===1&&port?port.sill:box.min[i], max=i===1&&port?port.crown:box.max[i];
      const inset=Math.min(1e-5,(max-min)*.25);
      return clamp(value,min+inset,max-inset);
    });
  }
  function compile(geometry,styles){
    check(record(geometry),'Invalid acoustic topology');
    const {rooms,exterior=[],openings}=geometry;
    check(Array.isArray(rooms)&&rooms.length>0&&rooms.length<=96&&Array.isArray(exterior)&&
      exterior.length<=32&&Array.isArray(openings)&&openings.length<=256,'Invalid acoustic topology');
    const cells=[...rooms.map(row=>{
      check(record(row)&&id(row.id),'Invalid acoustic room');
      const box=bounds(row.bounds);
      check(point(box.min)&&point(box.max)&&box.min.every((n,i)=>n<box.max[i]),'Invalid acoustic room bounds');
      return {name:row.id,box,nodes:[]};
    }),...exterior.map(name=>{
      check(id(name),'Invalid acoustic exterior');
      return {name,box:null,nodes:[]};
    })];
    const lookup=new Map(cells.map((row,i)=>[row.name,i])), names=new Set(), nodes=[];
    check(lookup.size===cells.length,'Duplicate acoustic room');
    const portals=openings.map((row,i)=>{
      const from=lookup.get(row.from),to=lookup.get(row.to);
      check(id(row.id)&&!names.has(row.id)&&from!==undefined&&to!==undefined&&from!==to&&
        (cells[from].box||cells[to].box),'Invalid acoustic opening '+row.id);
      names.add(row.id);
      const style=styles.get(row.id)??openingStyle({},row.id);
      const at=style.at??row.at??junction(cells[from].box,cells[to].box);
      check(point(at),'Invalid acoustic opening position '+row.id);
      for(const [room,position,port] of [[from,style.fromAt,row.fromPort],[to,style.toAt,row.toPort]]){
        if(port)check(record(port)&&cells[room].box&&number(port.sill,cells[room].box.min[1],cells[room].box.max[1])&&
          number(port.crown,port.sill,cells[room].box.max[1])&&port.sill<port.crown,'Invalid acoustic opening span '+row.id);
        const index=nodes.length;
        nodes.push({point:mouth(position??at,cells[room].box,port),room,portal:i});
        cells[room].nodes.push(index);
      }
      return {id:row.id,style};
    });
    for(const key of styles.keys())check(names.has(key),'Unknown acoustic opening '+key);
    function locate(at,hint){
      for(let i=0;i<rooms.length;i++)if(contains(cells[i].box,at))
        return hint===undefined||hint===cells[i].name?i:-1;
      const named=lookup.get(hint??'outside');
      return named!==undefined&&(!cells[named].box||W.fields.zone(at,cells[named].box))?named:-1;
    }
    return {geometry,cells,nodes,portals,locate,rooms:rooms.length};
  }

  function liquidsFor(layouts){
    return layouts.flatMap(({geometry,levels})=>geometry.rooms.flatMap(({bounds},i)=>{
      const height=levels[i];
      return height<=bounds.min[1]?[]:[{min:bounds.min,max:[bounds.max[0],height,bounds.max[2]]}];
    }));
  }
  function intersection(box,a,b,cuts){
    let enter=0,exit=1;
    for(let k=0;k<3;k++){
      const span=b[k]-a[k];
      if(!span){
        if(a[k]<box.min[k]||a[k]>=box.max[k])return;
      }else{
        const x=(box.min[k]-a[k])/span,y=(box.max[k]-a[k])/span;
        enter=Math.max(enter,Math.min(x,y));
        exit=Math.min(exit,Math.max(x,y));
        if(enter>=exit)return;
      }
    }
    cuts.push(enter,exit);
  }
  function propagation(layout,extra,readMedium,tuning){
    const {geometry,levels,fractions}=layout, topology=tuning.compile(geometry);
    check(Array.isArray(fractions)&&fractions.length===topology.portals.length&&fractions.every(n=>number(n,0,1))&&
      (levels===undefined||Array.isArray(levels)&&levels.length===topology.rooms&&levels.every(Number.isFinite)),
    'Invalid current acoustic layout');
    const liquids=liquidsFor(extra);
    const {metersPerWorld,mediaProfiles,mediumStep,routeDistanceDb}=tuning;
    const {cells,nodes,portals}=topology;
    const dryAir=!levels&&!liquids.length&&!readMedium&&!mediaProfiles.get('air').blocked&&mediaProfiles.get('air');
    function medium(at,room){
      const sampled=readMedium?.(at);
      if(sampled)return sampled;
      return at[1]<(levels?.[room]??-Infinity)||liquids.some(box=>contains(box,at))?'water':'air';
    }
    function transfer(parts){
      const loss=[0,0,0];
      let seconds=0, meters=0, before;
      for(const part of parts){
        const profile=mediaProfiles.get(part.medium);
        if(profile.blocked)return null;
        const length=part.meters;
        meters+=length;
        seconds+=length/profile.speed;
        for(let k=0;k<3;k++)loss[k]+=length*profile.loss[k]+
          (before&&before!==profile?before.interfaceLoss[k]+profile.interfaceLoss[k]:0);
        before=profile;
      }
      return {meters,seconds,loss,parts};
    }
    function segment(a,b,room){
      const length=V.dist(a,b)*metersPerWorld, height=levels?.[room]??-Infinity;
      const left=a[1]<height,right=b[1]<height;
      if(!liquids.length&&!readMedium){
        if(left===right)return transfer([{medium:left?'water':'air',meters:length}]);
        const split=clamp((height-a[1])/(b[1]-a[1]),0,1);
        return transfer([{medium:left?'water':'air',meters:length*split},{medium:right?'water':'air',meters:length*(1-split)}]);
      }
      const cuts=[0,1], parts=[];
      if(left!==right)cuts.push(clamp((height-a[1])/(b[1]-a[1]),0,1));
      for(const box of liquids)intersection(box,a,b,cuts);
      if(readMedium){
        const steps=clamp(Math.ceil(length/mediumStep),1,24);
        for(let i=1;i<steps;i++)cuts.push(i/steps);
      }
      cuts.sort((x,y)=>x-y);
      for(let i=1;i<cuts.length;i++){
        const width=cuts[i]-cuts[i-1];
        if(width<=0)continue;
        const kind=medium(V.lerp(a,b,(cuts[i]+cuts[i-1])*.5),room), last=parts.at(-1);
        if(last?.medium===kind)last.meters+=width*length;
        else parts.push({medium:kind,meters:width*length});
      }
      return transfer(parts);
    }
    const mediaGraph=tuning.reuse??{edges:nodes.map(()=>[]),initialized:new Set(),portalMedia:new Map()};
    const {edges,initialized,portalMedia}=mediaGraph, across=new Map(), trees=new Map();
    function portal(index){
      if(across.has(index))return across.get(index);
      const {style,id}=portals[index], fraction=fractions[index], a=nodes[index*2],b=nodes[index*2+1];
      if(fraction===0&&style.sealed){across.set(index,null);return null;}
      if(!portalMedia.has(index)){
        const first=medium(a.point,a.room), second=medium(b.point,b.room), length=V.dist(a.point,b.point)*metersPerWorld;
        portalMedia.set(index,transfer(first===second?[{medium:first,meters:length}]:
          [{medium:first,meters:length*.5},{medium:second,meters:length*.5}]));
      }
      const path=portalMedia.get(index), apertureLoss=style.openGain.map((value,i)=>fraction===1?style.openLossDb[i]:
        fraction===0?style.closedLossDb[i]:decibels(K.mix(style.closedGain[i],value,fraction)));
      const section=path&&{...path,loss:path.loss.map((value,i)=>value+apertureLoss[i]),opening:{id,fraction,lossDb:apertureLoss}};
      across.set(index,section);
      return section;
    }
    function roomEdges(room){
      if(initialized.has(room))return;
      initialized.add(room);
      const group=cells[room].nodes;
      for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
        const a=group[i],b=group[j], section=segment(nodes[a].point,nodes[b].point,room);
        if(section){
          edges[a].push({index:b,section,reverse:false});
          edges[b].push({index:a,section,reverse:true});
        }
      }
    }
    const cost=(section,band)=>section.loss[band]+section.meters*routeDistanceDb;
    function search(listener,room,band){
      const key=[room,band,...listener].join('/');
      if(trees.has(key))return trees.get(key);
      const scores=new Float64Array(nodes.length).fill(Infinity), links=new Array(nodes.length);
      const totals=new Float64Array(nodes.length*6);
      const heap=new ProceduralHeap((a,b)=>a.cost<b.cost||a.cost===b.cost&&a.index<b.index);
      function visit(index,total,link){
        if(total>=scores[index])return;
        scores[index]=total; links[index]=link; heap.push({index,cost:total});
      }
      for(const index of cells[room].nodes){
        const piece=segment(nodes[index].point,listener,room);
        if(piece)visit(index,cost(piece,band),{index:-1,section:piece,reverse:false});
      }
      while(heap.size){
        const {index,cost:total}=heap.pop(), node=nodes[index];
        if(scores[index]!==total)continue;
        const {section,index:next}=links[index];
        const at=index*6, tail=next*6;
        totals[at]=section.meters+(next<0?0:totals[tail]);
        totals[at+1]=section.seconds+(next<0?0:totals[tail+1]);
        for(let k=0;k<3;k++)totals[at+2+k]=section.loss[k]+(next<0?0:totals[tail+2+k]);
        totals[at+5]=next<0?index:totals[tail+5];
        const opening=portal(node.portal);
        if(opening)visit(index^1,total+cost(opening,band),{index,section:opening,reverse:Boolean((index^1)&1)});
        roomEdges(node.room);
        for(const edge of edges[index])
          visit(edge.index,total+cost(edge.section,band),{index,section:edge.section,reverse:!edge.reverse});
      }
      if(trees.size>=24)trees.delete(trees.keys().next().value);
      const tree={scores,links,totals};
      trees.set(key,tree);
      return tree;
    }
    function route(from,to,sourceRoom,listenerRoom,band){
      const direct=sourceRoom===listenerRoom?segment(from,to,sourceRoom):null;
      if(direct&&direct.parts.length===1)return {first:{index:-1,section:direct,reverse:false}};
      const tree=search(to,listenerRoom,band);
      let best=direct?cost(direct,band):Infinity;
      let first=direct?{index:-1,section:direct,reverse:false}:null;
      let selected=-1;
      for(const index of cells[sourceRoom].nodes){
        if(!Number.isFinite(tree.scores[index]))continue;
        const at=nodes[index].point, piece=dryAir?null:segment(from,at,sourceRoom);
        const added=dryAir?V.dist(from,at)*metersPerWorld*(dryAir.loss[band]+routeDistanceDb):
          piece?cost(piece,band):Infinity;
        const score=tree.scores[index]+added;
        if(score<best){
          best=score; selected=index;
          if(piece)first={index,section:piece,reverse:false};
        }
      }
      if(dryAir&&selected>=0)first={index:selected,section:segment(from,nodes[selected].point,sourceRoom),reverse:false};
      return {first,links:tree.links,totals:tree.totals};
    }
    function blockedOpenings(links){
      const found=[];
      for(let i=0;i<portals.length;i++){
        const a=i*2,b=a+1;
        if(Boolean(links[a])===Boolean(links[b])||portal(i))continue;
        const {id,style}=portals[i], fraction=fractions[i];
        found.push({id,fraction,from:cells[nodes[a].room].name,to:cells[nodes[b].room].name,
          reason:fraction===0&&style.sealed?'sealed':'medium'});
      }
      return found;
    }
    return {topology,route,blockedOpenings,mediaGraph};
  }

  W.acousticPropagation=Object.freeze({amplitude,materials,compile,openingStyle,propagation,bands,point,same});
})(KIT);
