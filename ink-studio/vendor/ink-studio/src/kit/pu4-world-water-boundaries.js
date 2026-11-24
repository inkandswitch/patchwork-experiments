/* Editable region rules for water sources, sinks, barriers and external heads. */
(function(K){
  const W=K.world, {check,record,id,own}=W.data, {bounds,zone}=W.fields;
  const kinds={
    source:['rate'],sink:['rate'],wall:['axis'],open:['side','opening'],exchange:['field','rate','direction']
  };
  const sides=['x-min','x-max','z-min','z-max'];
  const directions=['both','in','out'];
  const inRange=(n,max)=>Number.isFinite(n)&&n>=0&&n<=max;
  const limit=64;

  function create(initial,fields,{width,height,origin,dx,dz,point}){
    check(record(fields)&&Object.keys(fields).length<=16&&Object.entries(fields).every(([key,name])=>
      id(key)&&typeof name==='string'&&name.length>0&&name.length<=193),'Invalid water boundary fields');
    const size=width*height, cellArea=dx*dz;
    const [ox,oz]=origin, maxX=ox+width*dx, maxZ=oz+height*dz;
    const cached=new WeakMap();

    function validate(key,rule){
      check(id(key)&&record(rule)&&own(kinds,rule.kind)&&Object.keys(rule).every(name=>
        ['kind','bounds','enabled',...kinds[rule.kind]].includes(name))&&
        (rule.enabled===undefined||typeof rule.enabled==='boolean'),'Invalid water boundary rule '+key);
      bounds(rule.bounds,2);
      switch(rule.kind){
        case 'source':
        case 'sink':
          check(inRange(rule.rate,1e4),'Water boundary rates need to be in [0, 10000]');
          break;
        case 'wall':
          check(['x','z'].includes(rule.axis),'A water wall needs a normal axis of x or z');
          break;
        case 'open':
          check(sides.includes(rule.side)&&inRange(rule.opening??1,1),'Invalid open water edge');
          break;
        case 'exchange':
          check(own(fields,rule.field)&&inRange(rule.rate,1e4)&&directions.includes(rule.direction??'both'),
            'Water exchange needs a declared head field, rate and valid direction');
          break;
      }
    }

    function compile(rules){
      if(cached.has(rules))return cached.get(rules);
      check(record(rules)&&Object.keys(rules).length<=limit,'Too many water boundary rules');
      const cells=new Map(), walls=new Set(), edges=new Map(), targets={};
      let coverage=0;
      for(const key of Object.keys(rules).sort()){
        const rule=rules[key];
        validate(key,rule);
        const active=rule.enabled!==false;
        let count=0;
        if(rule.kind==='wall'){
          const xNormal=rule.axis==='x';
          for(let z=0;z<height;z++)for(let x=0;x<width;x++){
            if(xNormal?x+1===width:z+1===height)continue;
            const face=[ox+(x+(xNormal?1:.5))*dx,oz+(z+(xNormal ? .5 : 1))*dz];
            if(!zone(face,rule.bounds))continue;
            count++;
            if(active)walls.add((z*width+x)*2+(xNormal?0:1));
          }
        }else if(rule.kind==='open'){
          const side=sides.indexOf(rule.side), xNormal=side<2, opening=rule.opening??1;
          for(let j=0;j<(xNormal?height:width);j++){
            const cell=xNormal?j*width+(side===0?0:width-1):(side===2?0:width*(height-1))+j;
            const face=point(cell);
            face[xNormal?0:1]=[ox,maxX,oz,maxZ][side];
            if(!zone(face,rule.bounds))continue;
            count++;
            const address=cell*4+side;
            if(active&&opening>(edges.get(address)?.opening??0))edges.set(address,{key,opening});
          }
        }else{
          for(let cell=0;cell<size;cell++){
            if(!zone(point(cell),rule.bounds))continue;
            count++;
            if(active){
              const next=cells.get(cell)??[];
              if(!next.length)cells.set(cell,next);
              next.push({key,rule});
            }
          }
        }
        check(count>0,'Water boundary does not cover any '+(['wall','open'].includes(rule.kind)?'faces':'cells')+': '+key);
        coverage+=count;
        check(coverage<=262144,'Water boundary coverage exceeds its budget');
        targets[key]=count;
      }
      const plan={cells,walls,edges,targets};
      cached.set(rules,plan);
      return plan;
    }

    const idle=()=>({added:0,drained:0});
    compile(initial);
    function set(state,{id:key,rule},ctx){
      const rules={...state.rules};
      if(rule===null){
        if(!own(rules,key))return state;
        ctx.emit('boundary-removed',{id:key,rule:rules[key]});
        delete rules[key];
      }else{
        rules[key]=rule;
        compile(rules);
        ctx.emit('boundary-set',{id:key,rule});
      }
      const flows={...state.flows};
      delete flows[key];
      return {rules,flows};
    }
    function start({rules},ctx){
      const {cells,walls,edges}=compile(rules), flows={};
      const heads=new Map();
      const note=(key,added,drained)=>{
        const flow=flows[key]??=idle();
        flow.added+=added;
        flow.drained+=drained;
      };
      function head(cell,field,floor){
        let values=heads.get(field);
        if(!values)heads.set(field,values=new Map());
        if(!values.has(cell)){
          const [x,z]=point(cell), sample=ctx.query.probe(fields[field],[x,floor,z]);
          values.set(cell,sample.status==='ok'?sample.value:null);
        }
        return values.get(cell);
      }
      const solver={
        edge(cell,side){return edges.get(cell*4+side)?.opening??0;},
        export(cell,side,volume){note(edges.get(cell*4+side).key,0,volume);},
        cell(cell){return cells.has(cell);},
        apply(cell,dt,floor,depth,change){
          const entries=cells.get(cell);
          if(!entries)return;
          for(const {key,rule} of entries){
            let amount=rule.rate*dt;
            if(rule.kind==='sink')amount=-amount;
            if(rule.kind==='exchange'){
              const outside=head(cell,rule.field,floor);
              if(!Number.isFinite(outside))continue;
              const gap=Math.max(0,outside-floor)-depth;
              if(gap>0&&rule.direction==='out'||gap<0&&rule.direction==='in')continue;
              amount=gap*Math.min(1,amount);
            }
            const applied=change(amount);
            depth+=applied;
            if(applied)note(key,Math.max(0,applied)*cellArea,Math.max(0,-applied)*cellArea);
          }
        }
      };
      return {flows,wall:(cell,axis)=>walls.has(cell*2+axis),walls:walls.size>0,
        solver:cells.size||edges.size?solver:undefined};
    }
    return {
      initial:()=>({rules:initial,flows:{}}),
      checkFields(query){
        for(const name of Object.values(fields)){
          const field=query.field(name);
          check(field?.type==='number'&&field.units==='world'&&field.spatial?.space==='world',
            'Water boundary head needs a numeric world-space field in world units: '+name);
        }
      },
      validate(state){
        check(record(state)&&record(state.rules)&&record(state.flows),'Invalid saved water boundaries');
        compile(state.rules);
        for(const [key,flow] of Object.entries(state.flows))
          check(own(state.rules,key)&&state.rules[key].enabled!==false&&record(flow)&&
            Object.keys(flow).length===2&&inRange(flow.added,Infinity)&&inRange(flow.drained,Infinity),
            'Invalid saved water boundary flow');
      },
      checkAction(args){
        const {id:key,rule}=args;
        check(id(key)&&Object.keys(args).length===2&&own(args,'rule'),'Water boundary edit needs an ID and rule');
        if(rule!==null){
          validate(key,rule);
          compile({[key]:rule});
        }
      },
      set,start,
      report({rules,flows}){
        const {targets}=compile(rules);
        return Object.fromEntries(Object.keys(rules).sort().map(key=>[
          key,{...rules[key],targets:targets[key],...(flows[key]??idle())}
        ]));
      }
    };
  }
  W.waterBoundaries=Object.freeze({create});
})(KIT);
