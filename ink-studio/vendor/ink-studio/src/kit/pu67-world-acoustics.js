/* One query contract for agent hearing and host audio mix. */
(function(K){
  const W=K.world, Q=W.query, A=W.acousticPropagation, V=K.V;
  const {check,id,record}=W.data;
  const {bands,point,amplitude,same}=A;
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const fieldName=value=>typeof value==='string'&&value.length>0&&value.length<=193;
  const sameMedia=(a,b)=>a.length===b.length&&a.every((row,i)=>row.geometry===b[i].geometry&&same(row.levels,b[i].levels));
  const empty=[0,0,0];

  function acoustics(config){
    const {layout,media=[],openings={},mediumProfiles={},metersPerWorld=1,mediumStep=.65,
      routeDistanceDb=.4,referenceDistance=1,sourceLevelDb=70,thresholdDb=30}=config;
    check(fieldName(layout)&&Array.isArray(media)&&media.length<=8&&media.every(fieldName)&&
      new Set(media).size===media.length&&record(openings)&&Object.keys(openings).length<=256&&
      finite(metersPerWorld,.0001,100)&&finite(mediumStep,.01,1000)&&finite(routeDistanceDb,0,100)&&
      finite(referenceDistance,.001,1000)&&finite(sourceLevelDb,-200,250)&&finite(thresholdDb,-200,250),
    'Invalid acoustic query settings');
    const styles=new Map(Object.entries(openings).map(([name,spec])=>{
      check(id(name),'Invalid acoustic opening ID '+name);
      return [name,A.openingStyle(spec,name)];
    }));
    const profiles=A.materials(mediumProfiles), geometries=new WeakMap(), snapshots=new WeakMap();
    let stable, layouts=[], sampled=[];
    function compile(geometry){
      let graph=geometries.get(geometry);
      if(!graph){graph=A.compile(geometry,styles);geometries.set(geometry,graph);}
      return graph;
    }
    function scene(query){
      if(snapshots.has(query))return snapshots.get(query);
      const result=query.probe(layout);
      if(result.status!=='ok')return null;
      const source=result.value, extra=[];
      for(const field of layouts){
        const row=query.probe(field);
        if(row.status==='ok'&&row.value.geometry!==source.geometry)extra.push(row.value);
      }
      const reuse=!sampled.length&&stable?.source.geometry===source.geometry&&same(source.levels,stable.source.levels)&&
        sameMedia(extra,stable.extra);
      if(reuse&&same(source.fractions,stable.source.fractions)){
        snapshots.set(query,stable.engine);
        return stable.engine;
      }
      function mediumAt(at){
        for(const field of sampled){
          const row=query.probe(field,at);
          if(row.status!=='ok')continue;
          const value=row.value;
          const kind=typeof value==='string'?value:value?.kind??(Number.isFinite(value?.surface)&&'water');
          if(!profiles.has(kind)||kind==='air')continue;
          if(kind==='water'&&Number.isFinite(value?.surface)&&
            (at[1]>=value.surface||Number.isFinite(value.bed)&&at[1]<value.bed||value.depth===0))continue;
          return kind;
        }
      }
      const engine=A.propagation(source,extra,sampled.length?mediumAt:null,{compile,metersPerWorld,
        mediaProfiles:profiles,mediumStep,routeDistanceDb,reuse:reuse?stable.engine.mediaGraph:undefined});
      snapshots.set(query,engine);
      if(!sampled.length)stable={source,extra,engine};
      return engine;
    }
    function result(context,details){
      const {query,target,args}=context;
      const {from,fromRoom=from?.room,toRoom=target?.room,band='mid',sourceLevelDb:level=sourceLevelDb,
        thresholdDb:threshold=thresholdDb}=args;
      const index=bands.indexOf(band);
      check(index>=0&&finite(level,-200,250)&&finite(threshold,-200,250)&&
        [fromRoom,toRoom].every(name=>name===undefined||id(name)),'Invalid hearing query settings');
      if(from===undefined||!target?.point)return Q.missing('acoustic query needs source and listener points');
      const origin=query.target(from)?.point, listener=target.point;
      if(!origin)return Q.missing('unknown acoustic source or socket','missing');
      check(point(origin)&&point(listener),'Acoustic source and listener need bounded XYZ positions');
      const engine=scene(query);
      if(!engine)return Q.missing('acoustic layout is unavailable');
      const {topology}=engine;
      const a=topology.locate(origin,fromRoom),b=topology.locate(listener,toRoom);
      if(a<0||b<0)return Q.missing(a<0?'source is outside the acoustic layout':'listener is outside the acoustic layout','outside');
      const {cells,nodes}=topology;
      const {first,links,totals}=engine.route(origin,listener,a,b,index);
      const names={fromRoom:cells[a].name,toRoom:cells[b].name};
      if(!first)return Q.ok({status:'blocked',reason:'no acoustic path through the current openings and media',
        ...names,audible:false,band,gain:0,levelDb:null,delaySeconds:null,muffleDb:null,
        bands:Object.fromEntries(bands.map(name=>[name,{gain:0,lossDb:null,levelDb:null}])),
        ...(details&&{blockedOpenings:engine.blockedOpenings(links)})});
      const {section}=first, tail=first.index*6;
      const meters=section.meters+(totals?.[tail]??0), delay=section.seconds+(totals?.[tail+1]??0);
      const loss=section.loss.map((value,k)=>value+(totals?.[tail+2+k]??0));
      const apparentSource=tail<0?origin:nodes[totals[tail+5]].point;
      let path;
      if(details){
        let room=a, position=origin;
        const rooms=[cells[a].name], segments=[], openings=[];
        for(let link=first;link;link=link.index<0?null:links[link.index]){
          const {section,index:next,reverse}=link, at=next<0?listener:nodes[next].point;
          const opening=section.opening;
          const nextRoom=next<0?b:nodes[next].room;
          segments.push({from:position,to:at,distanceMeters:section.meters,delaySeconds:section.seconds,
            media:reverse?section.parts.slice().reverse():section.parts,lossDb:section.loss,
            ...(opening?{opening:opening.id}:{room:cells[room].name})});
          if(opening){
            openings.push({...opening,from:cells[room].name,to:cells[nextRoom].name});
            rooms.push(cells[nextRoom].name);
          }
          room=nextRoom;
          position=at;
        }
        path={rooms,openings,segments};
      }
      const distanceLossDb=20*Math.log10(Math.max(1,meters/referenceDistance));
      const estimates=loss.map(db=>{
        const lossDb=db+distanceLossDb;
        return {lossDb,gain:amplitude(lossDb),levelDb:level-lossDb};
      });
      const selected=estimates[index], audible=selected.levelDb>=threshold;
      const incoming=V.sub(apparentSource,listener);
      return Q.ok({status:audible?'audible':'attenuated',...names,audible,band,sourceLevelDb:level,thresholdDb:threshold,
        ...selected,distanceMeters:meters,distanceLossDb,delaySeconds:delay,muffleDb:loss[2]-loss[0],
        direction:V.len(incoming)>1e-9?V.norm(incoming):empty,apparentSource,
        bands:Object.fromEntries(bands.map((name,k)=>[name,estimates[k]])),
        ...(path&&{path})});
    }
    return {initial:()=>null,
      checkFields(query){
        const source=query.field(layout);
        check(source?.role==='acoustic-layout','Acoustics needs a room and opening layout field');
        if(source.openingIds)for(const name of styles.keys())
          check(source.openingIds.includes(name),'Unknown acoustic opening '+name);
        layouts=[];sampled=[];
        for(const name of media){
          const field=query.field(name);
          check(field&&field.role!=='acoustic-hearing'&&['record','category'].includes(field.type),'Invalid acoustic medium field '+name);
          if(field.name===source.name)continue;
          if(field.role==='acoustic-layout'){
            check(field.medium==='water','Only water chamber layouts can supply secondary acoustic media');
            layouts.push(field.name);
          }else sampled.push(field.name);
        }
      },
      validateState:state=>check(state===null,'Invalid acoustic checkpoint'),
      fields:{audible:{type:'record',role:'acoustic-hearing',read:ctx=>result(ctx,ctx.args.details===true)}},
      traces:{path:{run:ctx=>result(ctx,true)}}
    };
  }
  W.runtime.register('acoustics',acoustics);
})(KIT);
