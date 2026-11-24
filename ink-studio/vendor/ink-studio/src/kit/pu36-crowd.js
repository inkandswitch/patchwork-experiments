/* Local swept-disc steering over incrementally published walking poses. */
(function(K){
  const W=K.world,V=K.V,{check,record}=W.data;
  const eps=1e-7;
  const clear=Object.freeze({status:'clear'});
  const statuses=['clear','avoiding','yielding','queued','crossing'];
  const turns=[-.55,.55,-1.02,1.02,-Math.PI/2,Math.PI/2,-1.95,1.95]
    .map(angle=>[Math.cos(angle),Math.sin(angle)]);
  const distance=(a,b)=>Math.hypot(b[0]-a[0],b[2]-a[2]);
  function separation(a,b,p,r,height){
    if(Math.min(a[1],b[1])>=p.position[1]+p.height-eps||
      Math.max(a[1],b[1])+height<=p.position[1]+eps)return true;
    const dx=b[0]-a[0],dz=b[2]-a[2],x=a[0]-p.position[0],z=a[2]-p.position[2];
    const span=dx*dx+dz*dz, projection=dx*x+dz*z;
    if(span<=eps*eps)return true;
    const t=Math.max(0,Math.min(1,-projection/span)), required=r+p.radius;
    // An authored overlap can separate, while motion deeper into it is held.
    if(x*x+z*z<required*required-eps&&projection>=0)return true;
    return (x+dx*t)**2+(z+dz*t)**2>=required*required-eps;
  }

  function create(config,bounds){
    check(record(config)&&Object.keys(config).every(key=>['avoidance','lookAhead','spacing','bottlenecks'].includes(key)),
      'Invalid crowd settings');
    const {avoidance=true,lookAhead=.55,spacing=.02,bottlenecks={}}=config;
    check(typeof avoidance==='boolean'&&Number.isFinite(lookAhead)&&lookAhead>=0&&lookAhead<=8&&
      Number.isFinite(spacing)&&spacing>=0&&spacing<=1,'Invalid crowd steering settings');
    const gates=W.bottlenecks.create(bottlenecks);
    const hasGates=Object.keys(bottlenecks).length>0;

    function begin(state,rows,ctx){
      const people=new Map(), grid=avoidance?W.spatial.grid(2):null;
      const cellPoint=p=>[p[0],0,p[2]];
      let radius=0;
      for(const row of rows){
        const p={...row,position:row.position};
        people.set(p.id,p);
        if(grid&&p.active)p.slot=grid.add(cellPoint(row.position),p);
        radius=Math.max(radius,p.radius);
      }
      const admission=hasGates?gates.begin(state,people,ctx):null;
      function move(agent,from,wanted,route,cursor,walk,maxDistance,exit){
        const p=people.get(agent.id);
        if(!p)return {...walk(from,[wanted[0]-from[0],wanted[2]-from[2]]),crowd:clear};
        p.goal=agent.goal;
        const gate=admission?.request(p,from,route,cursor,exit);
        const target=gate?.hold??gate?.guide??wanted, span=distance(from,target);
        const budget=gate?.hold||gate?.guide?maxDistance:distance(from,wanted);
        const step=Math.min(budget,span);
        if(step<=eps)return {foot:from,contacts:[],held:Boolean(gate),crowd:gate?
          {status:gate.status,bottleneck:gate.gate}:clear};
        const heading=[(target[0]-from[0])/span,0,(target[2]-from[2])/span];
        const neighbors=[], padding=radius+p.radius+spacing+step+lookAhead;
        grid?.overlap([from[0]-padding,0,from[2]-padding],
          [from[0]+padding,0,from[2]+padding],q=>{
            if(q.id!==p.id&&distance(from,q.position)<=padding)neighbors.push(q);
          });
        const peoplePass=(a,b)=>neighbors.every(q=>separation(a,b,q,p.radius+spacing,p.height));
        const gatePass=(a,b)=>!admission||admission.pass(p,a,b);
        const pass=(a,b)=>W.fields.zone(b,bounds)&&peoplePass(a,b)&&gatePass(a,b);
        let found={foot:from,contacts:[]}, redirected=false, held=false;
        function trial(axis,turned){
          const end=V.mad(from,axis,step);
          if(!pass(from,end)){held=true;return false;}
          const motion=walk(from,[end[0]-from[0],end[2]-from[2]]);
          let foot=from, count=0;
          for(const contact of motion.contacts){
            if(!pass(foot,contact.foot)){held=true;break;}
            foot=contact.foot;
            count++;
          }
          const progress=distance(from,foot);
          if(progress>distance(from,found.foot)+eps){
            found={foot,contacts:motion.contacts.slice(0,count)};
            redirected=turned;
          }
          return progress>=step*.8;
        }
        if(!trial(heading,false)&&neighbors.length&&(!gate?.guide||gate.align)){
          for(const predict of lookAhead?[true,false]:[false]){
            for(const [cos,sin] of turns){
              const axis=[heading[0]*cos-heading[2]*sin,0,heading[0]*sin+heading[2]*cos];
              if(predict&&!peoplePass(from,V.mad(from,axis,step+lookAhead)))continue;
              if(trial(axis,true))break;
            }
            if(distance(from,found.foot)>=step*.8)break;
          }
        }
        const result=found;
        let at=from;
        for(const contact of result.contacts){admission?.crossed(p,at,contact.foot);at=contact.foot;}
        const status=gate?.status??(distance(from,result.foot)<=eps&&held?'yielding':redirected?'avoiding':'clear');
        return {...result,held:held||gate?.status==='queued',exited:gate?.exited?.(result.foot),
          crowd:{status,...(gate&&{bottleneck:gate.gate})}};
      }
      function commit(row){
        const p=people.get(row.id);
        if(!p)return;
        if(row.mode==='dormant'||row.mode==='ride'){
          if(p.slot)grid.remove(p.slot);
          p.slot=null;
          p.active=false;
          return;
        }
        p.position=row.position;
        p.goal=row.goal;
        p.active=true;
        if(grid){
          if(p.slot)grid.move(p.slot,cellPoint(row.position));
          else p.slot=grid.add(cellPoint(row.position),p);
        }
      }
      function canRelocate(agent,point){
        const p=people.get(agent.id);
        if(!p)return !hasGates||!gates.blocks(agent.position,point,agent.radius);
        if(admission&&!admission.pass(p,p.position,point))return false;
        let safe=true;
        const pad=p.radius+radius+spacing;
        grid?.overlap([point[0]-pad,0,point[2]-pad],[point[0]+pad,0,point[2]+pad],other=>{
          if(other.id===p.id||point[1]>=other.position[1]+other.height||point[1]+p.height<=other.position[1])return;
          if(distance(point,other.position)<p.radius+other.radius+spacing-eps)safe=false;
        });
        return safe;
      }
      function canTransfer(agent,from,to){
        const p=people.get(agent.id);
        if(!p||admission&&!admission.pass(p,from,to))return false;
        let safe=true;
        const pad=p.radius+radius+spacing;
        grid?.overlap([Math.min(from[0],to[0])-pad,0,Math.min(from[2],to[2])-pad],
          [Math.max(from[0],to[0])+pad,0,Math.max(from[2],to[2])+pad],other=>{
            if(other.id===p.id)return;
            const radius=p.radius+spacing;
            const landsOnBody=to[1]<other.position[1]+other.height&&to[1]+p.height>other.position[1]&&
              distance(to,other.position)<radius+other.radius-eps;
            if(landsOnBody||!separation(from,to,other,radius,p.height))safe=false;
          });
        return safe;
      }
      return {move,commit,canRelocate,canTransfer,exitGoal:agent=>admission?.exitGoal(people.get(agent.id)),
        finish:()=>admission?.finish()??state};
    }
    function validateAgent(state){
      check(record(state)&&statuses.includes(state.status)&&
        (state.bottleneck===undefined||Object.hasOwn(bottlenecks,state.bottleneck)),'Invalid saved crowd status');
    }
    return {initial:gates.initial,spacing,inputs:gates.inputs,begin,validate:gates.validate,validateAgent,report:gates.report,
      blockedCoarse:hasGates?gates.blocks:null};
  }
  W.crowd=Object.freeze({create,clear});
})(KIT);
