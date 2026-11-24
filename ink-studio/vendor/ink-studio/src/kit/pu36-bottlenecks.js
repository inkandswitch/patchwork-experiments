/* Capacity, directional admission and release for shared walking crossings. */
(function(K){
  const W=K.world,V=K.V,P=K.procedural,{check,id,own,record,vector,equal}=W.data;
  const eps=1e-7;
  const other=side=>side==='a'?'b':'a';
  const direction=side=>side==='a'?1:-1;
  const sideOK=side=>side==='a'||side==='b';
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const lexical=(a,b)=>a<b?-1:a>b?1:0;

  function create(specs){
    check(record(specs)&&Object.keys(specs).length<=128,'Expected bounded bottleneck definitions');
    const gates=new Map(), index=W.spatial.create(), inputs={};
    for(const [name,spec] of Object.entries(specs).sort(([a],[b])=>lexical(a,b))){
      check(id(name)&&name.length<=80&&record(spec)&&
        Object.keys(spec).every(key=>['from','to','width','height','capacity','batch','approach','queueOffset','policy','open'].includes(key)),
      'Invalid bottleneck '+name);
      const {from,to,width,height=2,capacity=1,batch=capacity,approach=1.8,queueOffset=width*.85,
        policy='alternate',open={}}=spec;
      check(vector(from)&&vector(to)&&finite(width,.05,128)&&finite(height,.1,128)&&
        integer(capacity,1,256)&&integer(batch,1,256)&&finite(approach,.05,32)&&finite(queueOffset,0,32)&&
        ['alternate','fifo'].includes(policy)&&record(open)&&Object.keys(open).every(side=>sideOK(side)&&typeof open[side]==='boolean'),
      'Invalid bottleneck geometry or policy '+name);
      const dx=to[0]-from[0],dz=to[2]-from[2],length=Math.hypot(dx,dz);
      check(finite(length,.02,10000),'Bottleneck needs distinct XZ endpoints '+name);
      const u=[dx/length,0,dz/length],v=[u[2],0,-u[0]],half=width/2;
      const gate={name,from,to,u,v,length,half,capacity,batch,approach,queueOffset,policy,
        minY:Math.min(from[1],to[1])-.25,maxY:Math.max(from[1],to[1])+height};
      gates.set(name,gate);
      const pad=Math.max(approach,half+queueOffset);
      index.set(name,{min:[Math.min(from[0],to[0])-pad,gate.minY,Math.min(from[2],to[2])-pad],
        max:[Math.max(from[0],to[0])+pad,gate.maxY,Math.max(from[2],to[2])+pad],rank:gates.size,value:gate});
      for(const side of ['a','b'])inputs['open.'+name+'.'+side]={type:'bool',default:open[side]??true};
    }
    const initial=Object.fromEntries([...gates.keys()].map(name=>[name,{
      turn:null,admitted:0,holders:[],waiting:[],completed:{a:0,b:0}
    }]));

    function nearby(a,b,r,visit){
      index.overlap(a.map((n,i)=>Math.min(n,b[i])-r),a.map((n,i)=>Math.max(n,b[i])+r),row=>visit(row.value));
    }
    function local(g,p){
      const delta=V.sub(p,g.from);
      return [V.dot(delta,g.u),V.dot(delta,g.v),p[1]];
    }
    function hit(g,a,b,r){
      const x=local(g,a),y=local(g,b),low=[-r,-g.half-r,g.minY],high=[g.length+r,g.half+r,g.maxY];
      let start=0,end=1;
      for(let i=0;i<3;i++){
        const d=y[i]-x[i];
        if(Math.abs(d)<eps){if(x[i]<low[i]||x[i]>high[i])return;continue;}
        const a=(low[i]-x[i])/d,b=(high[i]-x[i])/d;
        start=Math.max(start,Math.min(a,b));end=Math.min(end,Math.max(a,b));
        if(start>end)return;
      }
      return start;
    }
    const inside=(g,point,r)=>hit(g,point,point,r)!==undefined;
    function intent(g,person,from,route,cursor){
      const [s,t,y]=local(g,from), r=person.radius;
      if(y<g.minY||y>g.maxY||Math.abs(t)>g.half+g.queueOffset+r) return;
      const side=s<=0?'a':s>=g.length?'b':null;
      if(!side||Math.abs(s-(side==='a'?0:g.length))>g.approach+r)return;
      let a=from, distance=0;
      for(let i=cursor;i<route.length&&distance<=g.approach*3+g.half+r;i++){
        const b=route[i], [next]=local(g,b);
        if(direction(side)*(next-s)>eps&&hit(g,a,b,r)!==undefined)return side;
        distance+=V.dist(a,b);
        a=b;
      }
    }
    const at=(g,s,t)=>V.mad(V.mad(g.from,g.u,s),g.v,t);
    function holding(g,p,side,rank){
      const gap=Math.max(p.radius*1.2,Math.min(g.approach*.9,g.approach*.35+rank*(2*p.radius+.06)));
      return at(g,side==='a'?-gap:g.length+gap,direction(side)*Math.max(g.queueOffset,g.half+p.radius));
    }
    function passed(g,p,side,point){
      const [s]=local(g,point);
      return side==='a'?s>g.length+p.radius+eps:s<-p.radius-eps;
    }
    function queueOrder(g,people){
      const distance=row=>Math.abs(local(g,people.get(row.agent).position)[0]-(row.side==='a'?0:g.length));
      return (a,b)=>a.since-b.since||distance(a)-distance(b)||lexical(a.agent,b.agent);
    }

    function validate(state){
      check(record(state)&&Object.keys(state).length===gates.size,'Invalid saved bottlenecks');
      for(const name of gates.keys()){
        const row=state[name];
        check(record(row)&&(row.turn===null||sideOK(row.turn))&&integer(row.admitted,0,256)&&record(row.completed)&&
          ['a','b'].every(side=>integer(row.completed[side],0,Number.MAX_SAFE_INTEGER)),
        'Invalid saved right of way '+name);
        const ids=new Set();
        for(const [list,holds] of [[row.holders,true],[row.waiting,false]]){
          check(Array.isArray(list)&&list.length<=65536,'Invalid saved bottleneck queue '+name);
          for(const item of list){
            check(record(item)&&id(item.agent)&&!ids.has(item.agent)&&integer(item.generation,1,Number.MAX_SAFE_INTEGER)&&
              integer(item.since,0,10000000)&&vector(item.goal)&&(sideOK(item.side)||holds&&item.side===null)&&
              (!holds||typeof item.entered==='boolean'&&integer(item.granted,0,10000000)),
            'Invalid saved crossing member '+name);
            ids.add(item.agent);
          }
        }
      }
    }

    function begin(state,people,ctx){
      const working=new Map(), swept=new Map();
      const same=(row,p)=>p?.active&&p.generation===row.generation;
      const live=(row,p)=>same(row,p)&&equal(row.goal,p.goal);
      const receipt=(p,side,since)=>({agent:p.id,generation:p.generation,side,since,goal:p.goal});
      for(const [name,g] of gates){
        const prior=state[name], open={a:ctx.input['open.'+name+'.a'],b:ctx.input['open.'+name+'.b']};
        const holders=new Map();
        for(const row of prior.holders){
          const p=people.get(row.agent);
          if(!same(row,p))continue;
          if(inside(g,p.position,p.radius))holders.set(row.agent,{...row,entered:true});
          else if(!row.entered&&live(row,p)&&open[row.side]&&ctx.tick-row.granted<60)holders.set(row.agent,row);
        }
        const waiting=new Map(prior.waiting.filter(row=>live(row,people.get(row.agent))).map(row=>[row.agent,row]));
        working.set(name,{g,open,holders,waiting,next:new Map(),ranks:new Map(),turn:prior.turn,admitted:prior.admitted,
          completed:{...prior.completed}});
      }
      for(const p of people.values())if(p.active)nearby(p.position,p.position,p.radius,g=>{
        const row=working.get(g.name);
        if(inside(g,p.position,p.radius)&&!row.holders.has(p.id))
          row.holders.set(p.id,{...receipt(p,null,ctx.tick),entered:true,granted:ctx.tick});
      });
      for(const row of working.values()){
        const {g,open,waiting,holders}=row;
        const all=[...waiting.values()].filter(x=>!holders.has(x.agent));
        all.sort(queueOrder(g,people));
        const queue=all.filter(x=>open[x.side]), sides=new Set(queue.map(x=>x.side)), can=side=>sides.has(side);
        if(holders.size&&[...holders.values()].some(x=>x.side!==row.turn||x.side===null))continue;
        if(queue.length&&!holders.size){
          const side=g.policy==='alternate'&&row.turn&&can(other(row.turn))&&row.admitted>=g.batch?
            other(row.turn):queue[0].side;
          if(side!==row.turn){row.turn=side;row.admitted=0;}
        }
        for(const x of queue){
          if(holders.size>=g.capacity)break;
          if(x.side!==row.turn)continue;
          if(can(other(x.side))&&(g.policy==='alternate'?row.admitted>=g.batch:queue[0].side!==x.side))break;
          holders.set(x.agent,{...x,entered:false,granted:ctx.tick});
          row.admitted=Math.min(g.batch,row.admitted+1);
        }
        const ranks={a:0,b:0};
        for(const x of all)if(!holders.has(x.agent))row.ranks.set(x.agent,ranks[x.side]++);
      }
      function request(person,from,route,cursor,exit){
        let best, gap=Infinity, held;
        nearby(from,from,person.radius,g=>{
          const row=working.get(g.name), holder=row.holders.get(person.id);
          if(holder){held={row,holder};return;}
          const side=intent(g,person,from,route,cursor);
          if(!side)return;
          const distance=Math.abs(local(g,from)[0]-(side==='a'?0:g.length));
          if(distance<gap||distance===gap&&lexical(g.name,best.row.g.name)<0){best={row,side};gap=distance;}
        });
        if(held){
          const {row,holder}=held, {g}=row, side=holder.side;
          const [goal]=local(g,person.goal);
          if(!side||!exit&&(!live(holder,person)||(side==='a'?goal<=g.length:goal>=0)))
            return {gate:g.name,status:'crossing'};
          if(!holder.entered){
            for(const prior of row.holders.values()){
              if(prior.agent===holder.agent)break;
              const ahead=people.get(prior.agent);
              if(!prior.entered&&ahead&&!inside(g,ahead.position,ahead.radius))
                return {gate:g.name,status:'crossing',hold:from};
            }
          }
          const [s,t]=local(g,from), pad=Math.max(person.radius*1.35,.28);
          const align=!holder.entered&&Math.abs(t)>.08;
          const line=align?(side==='a'?Math.min(s,-pad):Math.max(s,g.length+pad)):
            (side==='a'?g.length+pad:-pad);
          return {gate:g.name,status:'crossing',guide:at(g,line,0),align,
            exited:point=>passed(g,person,side,point)};
        }
        if(!best)return null;
        const {row,side}=best, old=row.waiting.get(person.id);
        row.next.set(person.id,receipt(person,side,old?.side===side?old.since:ctx.tick));
        return {gate:row.g.name,status:'queued',hold:holding(row.g,person,side,row.ranks.get(person.id)??0)};
      }
      function exitGoal(person){
        if(!person)return;
        let point;
        nearby(person.position,person.position,person.radius,g=>{
          const holder=working.get(g.name).holders.get(person.id);
          if(!point&&holder?.entered&&holder.side){
            const pad=Math.max(person.radius*1.35,.28);
            point=at(g,holder.side==='a'?g.length+pad:-pad,0);
            point[1]=person.position[1];
          }
        });
        return point;
      }
      function pass(person,a,b){
        let safe=true;
        nearby(a,b,person.radius,g=>{
          if(!working.get(g.name).holders.has(person.id)&&hit(g,a,b,person.radius)!==undefined)safe=false;
        });
        return safe;
      }
      function crossed(person,a,b){
        nearby(a,b,person.radius,g=>{
          if(working.get(g.name).holders.has(person.id)&&hit(g,a,b,person.radius)!==undefined){
            if(!swept.has(person.id))swept.set(person.id,new Set());
            swept.get(person.id).add(g.name);
          }
        });
      }
      function finish(){
        const result={};
        for(const [name,row] of working){
          const holders=[];
          for(const holder of row.holders.values()){
            const p=people.get(holder.agent);
            if(!same(holder,p))continue;
            const here=inside(row.g,p.position,p.radius), entered=holder.entered||here||swept.get(p.id)?.has(name)||false;
            if(entered&&!here){
              const [at]=local(row.g,p.position);
              if(holder.side==='a'&&at>row.g.length||holder.side==='b'&&at<0)row.completed[holder.side]++;
              continue;
            }
            holders.push({...holder,entered});
          }
          const waiting=[...row.next.values()].filter(item=>live(item,people.get(item.agent)))
            .sort(queueOrder(row.g,people));
          result[name]={turn:row.turn,admitted:row.admitted,holders,waiting,completed:row.completed};
        }
        return result;
      }
      return {request,exitGoal,pass,crossed,finish};
    }
    function report(state){
      return Object.fromEntries([...gates].map(([name,g])=>[name,{from:g.from,to:g.to,width:g.half*2,
        capacity:g.capacity,policy:g.policy,...state[name]}]));
    }
    function blocks(a,b,r){
      let blocked=false;
      nearby(a,b,r,g=>{if(hit(g,a,b,r)!==undefined)blocked=true;});
      return blocked;
    }
    return {initial,inputs,begin,validate,report,blocks};
  }
  W.bottlenecks=Object.freeze({create});
})(KIT);
