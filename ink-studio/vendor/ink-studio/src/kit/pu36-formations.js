/* Persistent formations with shared route planning and per-member rally slots. */
(function(K){
  const W=K.world, P=K.procedural, {V}=K, {check,record,own,id,vector,equal}=W.data, {freeze}=P.data;
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const bounded=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const order=(a,b)=>a<b?-1:a>b?1:0;
  const east=[1,0,0], eps=1e-6, empty=freeze([]);
  const flat=([x,,z])=>[x,0,z];
  const horizontal=(v,otherwise=east)=>V.norm(flat(v),otherwise);
  const side=([x,,z])=>[-z,0,x];
  const defaults=freeze({columns:3,spacing:.72});
  const actions=['form-group','group-move','group-join','group-detach','group-stop','group-disband'];
  const phases=['idle','planning','blocked','moving','compressing','regrouping','waiting-members','arrived'];
  const maxMembers=256;
  const handle=value=>keys(value,['agent','generation'])&&id(value.agent)&&
    (value.generation===undefined||integer(value.generation,1,Number.MAX_SAFE_INTEGER));
  const member=value=>typeof value==='string'?{agent:value}:value;
  const same=(a,b)=>a&&b&&a.agent===b.agent&&a.generation===b.generation;
  const matches=(link,row)=>row&&row.id===link.agent&&row.generation===link.generation;
  const full=(row,point)=>point&&V.dist(row.position,point)<=row.radius*.65+eps;

  function layout(raw){
    check(keys(raw,['columns','spacing']),'Invalid formation layout');
    const value={...defaults,...raw};
    check(integer(value.columns,1,32)&&bounded(value.spacing,.06,32),'Invalid formation layout');
    return value;
  }
  function memberList(raw){
    check(Array.isArray(raw)&&integer(raw.length,1,maxMembers)&&raw.every(value=>handle(member(value)))&&
      new Set(raw.map(value=>member(value).agent)).size===raw.length,'Invalid formation member list');
    return raw.map(member);
  }
  function moveSpec(raw){
    check(keys(raw,['group','to','facing','layout'])&&vector(raw.to)&&
      (raw.facing===undefined||vector(raw.facing)&&V.len(flat(raw.facing))>eps),'Invalid formation destination or facing');
    if(raw.layout!==undefined)layout(raw.layout);
  }
  function checkAction(action,args){
    check(id(args.group),'Expected a formation group ID');
    if(action==='group-move')return moveSpec(args);
    if(action==='group-stop'||action==='group-disband')
      return check(keys(args,['group']),'Invalid formation group command');
    if(action==='form-group'||action==='group-join'){
      const fields=action==='form-group'?['group','members','layout']:['group','members'];
      check(keys(args,fields),'Invalid formation membership command');
      memberList(args.members);
      if(args.layout!==undefined)layout(args.layout);
      return;
    }
    check(keys(args,['group','agent','generation'])&&handle({agent:args.agent,generation:args.generation}),
      'Invalid formation detachment');
  }

  function create(config,profiles,spacing=0){
    check(keys(config,['groups','maxPlansPerTick','retryTicks','sampleStep']),'Invalid formation settings');
    const {groups={},maxPlansPerTick=8,retryTicks=24,sampleStep=.3}=config;
    check(record(groups)&&Object.keys(groups).length<=256&&integer(maxPlansPerTick,1,64)&&
      integer(retryTicks,1,3600)&&bounded(sampleStep,.05,8),'Invalid formation catalog or budgets');
    const indices=new WeakMap();
    const mode=row=>profiles[row.species].mode;
    const speed=row=>profiles[row.species].speed??1;

    function index(state){
      if(!indices.has(state)){
        const entries=new Map();
        for(const [name,row] of Object.entries(state))
          for(const link of row.members)entries.set(link.agent,{name,link,row});
        indices.set(state,entries);
      }
      return indices.get(state);
    }
    function active(state,row){
      const entry=index(state).get(row.id);
      return Boolean(entry?.row.move&&matches(entry.link,row));
    }
    function update(state,name,value){
      return freeze({...state,[name]:value});
    }
    function remove(state,name){
      const next={...state};
      delete next[name];
      return freeze(next);
    }
    function enlist(state,raw,read,previous){
      const members=memberList(raw).map(ref=>{
        const row=read(ref.agent);
        check(row&&(ref.generation===undefined||ref.generation===row.generation),'Unknown or stale formation member '+ref.agent);
        check(!index(state).has(ref.agent),'Agent already belongs to a formation '+ref.agent);
        return row;
      });
      const kind=previous?.mode??mode(members[0]);
      check(members.every(row=>mode(row)===kind),'A formation needs a shared locomotion mode');
      return members.map(row=>({agent:row.id,generation:row.generation}));
    }
    function initial(read){
      let value=freeze({});
      for(const name of Object.keys(groups).sort()){
        const spec=groups[name];
        check(id(name)&&keys(spec,['members','layout']),'Invalid formation group '+name);
        const members=enlist(value,spec.members,read);
        value=update(value,name,{members,mode:mode(read(members[0].agent)),layout:layout(spec.layout??{}),
          move:null,phase:'idle',reason:null});
      }
      return value;
    }
    function detach(state,name,link){
      const row=state[name], members=row.members.filter(item=>!same(item,link));
      if(!members.length)return remove(state,name);
      let motion=row.move;
      if(motion?.assignment&&own(motion.assignment.slots,link.agent)){
        const slots={...motion.assignment.slots};
        delete slots[link.agent];
        motion={...motion,assignment:{...motion.assignment,slots}};
      }
      return update(state,name,{...row,members,move:motion});
    }
    function discard(state,row,ctx){
      const entry=index(state).get(row.id);
      if(!entry||!matches(entry.link,row))return state;
      ctx.emit('group-detached',{group:entry.name,agent:row.id,generation:row.generation,reason:'despawned'});
      return detach(state,entry.name,entry.link);
    }
    function edit(state,action,args,read,ctx){
      const name=args.group, current=own(state,name)&&state[name];
      if(action==='form-group'){
        check(!current&&Object.keys(state).length<256,'Formation group exists or group capacity exceeded');
        const members=enlist(state,args.members,read);
        ctx.emit('group-formed',{group:name,members});
        return update(state,name,{members,mode:mode(read(members[0].agent)),layout:layout(args.layout??{}),
          move:null,phase:'idle',reason:null});
      }
      check(current,'Unknown formation group '+name);
      if(action==='group-join'){
        const members=enlist(state,args.members,read,current);
        check(current.members.length+members.length<=maxMembers,'Formation member capacity exceeded');
        ctx.emit('group-joined',{group:name,members});
        return update(state,name,{...current,members:[...current.members,...members],
          move:current.move?{...current.move,assignment:null}:null});
      }
      if(action==='group-detach'){
        const link=current.members.find(item=>item.agent===args.agent);
        check(link&&(args.generation===undefined||args.generation===link.generation),'Unknown or stale formation member '+args.agent);
        ctx.emit('group-detached',{group:name,agent:link.agent,generation:link.generation,reason:'command'});
        return detach(state,name,link);
      }
      if(action==='group-disband'){
        ctx.emit('group-disbanded',{group:name});
        return remove(state,name);
      }
      if(action==='group-stop'){
        ctx.emit('group-stopped',{group:name});
        return update(state,name,{...current,move:null,phase:'idle',reason:null});
      }
      ctx.emit('group-destination',{group:name,at:args.to});
      return update(state,name,{...current,layout:args.layout===undefined?current.layout:layout(args.layout),
        move:{to:args.to,facing:args.facing===undefined?null:horizontal(args.facing),
          requested:ctx.tick,retry:ctx.tick,plannedAt:null,stages:empty,stage:0,assignment:null},phase:'planning',reason:null});
    }

    function arrange(stage,rows,style,motion,base){
      const gap=Math.max(style.spacing,base.radius*2+spacing+.05), fu=stage.forward, sv=side(fu);
      const forwardScore=row=>V.dot(row.position,fu), across=row=>V.dot(row.position,sv);
      const lineup=rows.slice().sort((a,b)=>forwardScore(b)-forwardScore(a)||order(a.id,b.id));
      for(let columns=Math.min(rows.length,style.columns);columns>=1;columns--){
        const depth=Math.ceil(lineup.length/columns);
        const slots={};
        let placed=0;
        ranks: for(let r=0;r<depth;r++){
          const rank=lineup.slice(r*columns,(r+1)*columns).sort((a,b)=>across(a)-across(b)||order(a.id,b.id));
          const center=V.mad(stage.anchor,fu,((depth-1)*.5-r)*gap);
          for(const [i,row] of rank.entries()){
            const candidate=motion.fit(base,V.mad(center,sv,(i-(rank.length-1)*.5)*gap));
            const goal=candidate&&motion.fit(motion.profile(row),candidate);
            if(!goal)break ranks;
            slots[row.id]=goal;
            placed++;
          }
        }
        if(placed===lineup.length)return {columns,gap,slots};
      }
      return null;
    }

    function stagesFor(rows,style,intent,motion,body){
      const goal=motion.fit(body,intent.to);
      if(!goal)return {reason:'destination-unfit'};
      const center=V.mul(rows.reduce((total,row)=>V.add(total,row.position),[0,0,0]),1/rows.length);
      const starts=rows.slice().sort((a,b)=>V.dist(a.position,center)-V.dist(b.position,center)||order(a.id,b.id));
      const first=starts.find(row=>motion.fit(body,row.position));
      if(!first)return {reason:'origin-unfit'};
      const route=motion.route(body,first.position,goal);
      if(route.status!=='ok'||!route.points.length)return {reason:route.status??'route-blocked'};
      let points=route.points.filter((p,i)=>!i||V.dist(p,route.points[i-1])>eps);
      if(points.length>4097){
        const stride=Math.ceil((points.length-1)/4096);
        points=points.filter((_,i)=>i%stride===0||i===points.length-1);
      }
      const initialDirection=horizontal(V.sub(goal,center)), stages=[];
      let lastPass=false, lastT=0, heading=initialDirection;
      if(points.length>=2&&body.mode==='walk'){
        const line=P.routes.polyline(points), count=Math.min(2048,Math.max(1,Math.ceil(line.length/sampleStep)));
        const columns=Math.min(rows.length,style.columns);
        const gap=Math.max(style.spacing,body.radius*2+spacing+.05), flank=(columns-1)*.5*gap;
        const trail=(Math.ceil(rows.length/columns)-1)*.5*gap;
        let passage=false;
        const directionAt=t=>horizontal(V.sub(line.sample(t+sampleStep/line.length).point,
          line.sample(t-sampleStep/line.length).point),initialDirection);
        for(let i=0;i<=count;i++){
          const t=i/count, {point}=line.sample(t), dir=directionAt(t);
          const narrow=motion.passage?.(point,point,0)||flank>0&&[-1,1].some(sign=>
            !motion.fit(body,V.mad(point,side(dir),flank*sign)));
          if(narrow){passage=true;continue;}
          if(!passage||(t-lastT)*line.length<gap)continue;
          const landing=t+(trail+gap+body.radius)/line.length;
          if(landing>=1-gap/line.length)break;
          const stage={anchor:line.sample(landing).point,forward:directionAt(landing),kind:'passage'};
          if(arrange(stage,rows,style,motion,body)){
            stages.push(stage);
            lastT=landing;
            i=Math.ceil(landing*count);
            passage=false;
          }
        }
        lastPass=passage;
        heading=directionAt(1);
      }
      stages.push({anchor:goal,forward:intent.facing??heading,kind:lastPass?'passage':'rally'});
      return {stages};
    }
    function groupBody(rows,motion){
      const profiles=rows.map(row=>motion.profile(row));
      const primary=profiles[0];
      return {...primary,radius:Math.max(...profiles.map(row=>row.radius)),
        maxWade:Math.min(...profiles.map(row=>row.maxWade)),
        maxSlope:Math.min(...profiles.map(row=>row.maxSlope??.9))};
    }
    function begin(state,ctx,motion){
      let next=state, budget=maxPlansPerTick-Object.values(state).filter(row=>row.move?.plannedAt===ctx.tick).length;
      const guides=new Map();
      const names=Object.keys(state).filter(name=>state[name].move).sort((a,b)=>
        state[a].move.retry-state[b].move.retry||state[a].move.requested-state[b].move.requested||order(a,b));
      for(const name of names){
        const group=state[name];
        const all=group.members.map(link=>motion.read(link.agent)).filter(Boolean);
        const ready=all.filter(row=>!W.agentOrders.holding(row.orders)&&!row.travelPlan);
        let move=group.move, phase=group.phase, reason=group.reason;
        const goalFor=row=>own(move.assignment?.slots,row.id)?move.assignment.slots[row.id]:null;
        const pending=ready.some(row=>!goalFor(row));
        const retry=ctx.tick>=move.retry&&(ctx.tick%retryTicks===0||ctx.spatial?.changes().length||
          ready.some(row=>row.mode==='blocked'));
        const needed=ready.length&&(!move.stages.length||retry&&ready.some(row=>{
          const point=goalFor(row);
          return point&&(!motion.fit(motion.profile(row),point)||row.mode==='blocked'&&!full(row,point));
        }));
        if(!ready.length){
          phase='waiting-members';reason='personal-orders';
        }else if(needed&&ctx.tick>=move.retry){
          if(budget<=0){phase='planning';reason='route-budget';}
          else{
            budget--;
            const body=groupBody(ready,motion), planned=stagesFor(ready,group.layout,move,motion,body);
            move={...move,stages:planned.stages??empty,stage:0,retry:ctx.tick+retryTicks,plannedAt:ctx.tick,assignment:null};
            phase=planned.stages?'moving':'blocked';reason=planned.reason??null;
          }
        }
        if(ready.length&&move.stages.length){
          let stage=move.stages[move.stage], assignment=move.assignment;
          if(!assignment||pending){
            assignment=arrange(stage,ready,group.layout,motion,groupBody(ready,motion));
          }
          if(assignment&&retry&&assignment.columns<Math.min(ready.length,group.layout.columns)){
            const wider=arrange(stage,ready,group.layout,motion,groupBody(ready,motion));
            if(wider&&wider.columns>assignment.columns)assignment=wider;
          }
          const filled=assignment&&ready.every(row=>own(assignment.slots,row.id)&&full(row,assignment.slots[row.id]));
          const final=move.stage===move.stages.length-1;
          if(filled&&!final){
            ctx.emit('group-regrouped',{group:name,at:stage.anchor,stage:move.stage});
            move={...move,stage:move.stage+1,assignment:null};
            stage=move.stages[move.stage];
            assignment=arrange(stage,ready,group.layout,motion,groupBody(ready,motion));
          }
          if(!assignment){
            phase='blocked';reason='slots-unfit';
            if(ctx.tick>=move.retry)move={...move,stages:empty,stage:0,retry:ctx.tick+1};
          }else{
            if(filled&&final)phase=ready.length===all.length?'arrived':'waiting-members';
            else phase=stage.kind==='passage'?'compressing':move.stage?'regrouping':'moving';
            reason=phase==='waiting-members'?'personal-orders':null;
            if(phase==='arrived'&&group.phase!=='arrived')
              ctx.emit('group-arrived',{group:name,at:stage.anchor,members:ready.length});
          }
          if(assignment!==move.assignment)move={...move,assignment};
        }
        const pace=ready.length?Math.min(...ready.map(speed)):0;
        for(const row of ready)guides.set(row.id,{point:goalFor(row),pace});
        if(move!==group.move||phase!==group.phase||reason!==group.reason)
          next=update(next,name,{...group,move,phase,reason});
      }
      return {state:next,guides};
    }

    function describe(row,read){
      const forward=row.move?.stages[row.move.stage]?.forward??east, axis=side(forward);
      const all=row.members.map(link=>read(link.agent)).filter(Boolean);
      const ready=all.filter(agent=>!W.agentOrders.holding(agent.orders));
      const across=ready.map(agent=>V.dot(agent.position,axis));
      const goals=row.move?.assignment?.slots;
      return {...row,observed:{
        active:ready.length,suspended:all.length-ready.length,pace:ready.length?Math.min(...ready.map(speed)):0,
        lateralSpan:across.length?Math.max(...across)-Math.min(...across):0,
        atSlots:goals?ready.filter(agent=>own(goals,agent.id)&&full(agent,goals[agent.id])).length:0
      }};
    }

    function validate(state,read){
      check(record(state)&&Object.keys(state).length<=256,'Invalid formation checkpoint');
      const seen=new Set();
      for(const [name,row] of Object.entries(state)){
        check(id(name)&&record(row)&&['walk','swim','fly'].includes(row.mode)&&
          phases.includes(row.phase)&&(row.reason===null||id(row.reason))&&
          (row.move===null||record(row.move)),'Invalid saved formation '+name);
        check(equal(layout(row.layout),row.layout),'Incomplete saved formation layout');
        for(const link of memberList(row.members)){
          const agent=read(link.agent);
          check(matches(link,agent)&&mode(agent)===row.mode&&!seen.has(link.agent),'Invalid saved formation identity '+link.agent);
          seen.add(link.agent);
        }
        if(!row.move)continue;
        const move=row.move, {stages,stage,assignment}=move;
        check(vector(move.to)&&(move.facing===null||vector(move.facing)&&V.len(flat(move.facing))>.99)&&
          integer(move.requested,0,10000000)&&integer(move.retry,0,10003600)&&
          (move.plannedAt===null||integer(move.plannedAt,move.requested,10000000))&&Array.isArray(stages)&&stages.length<=2049&&
          integer(stage,0,Math.max(0,stages.length-1))&&stages.every(item=>record(item)&&vector(item.anchor)&&
            vector(item.forward)&&['passage','rally'].includes(item.kind))&&
          (assignment===null||stages.length>0&&record(assignment)&&integer(assignment.columns,1,32)&&
            bounded(assignment.gap,.06,48)&&record(assignment.slots)&&Object.entries(assignment.slots).every(([key,point])=>
              vector(point)&&row.members.some(link=>link.agent===key))),
        'Invalid saved formation motion '+name);
      }
    }
    return {initial,active,discard,edit,begin,describe,validate,checkAction};
  }
  W.formations=Object.freeze({create,actions});
})(KIT);
