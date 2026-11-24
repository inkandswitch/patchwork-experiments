/* Immutable component pages with stable agent handles and sparse cold records. */
(function(K){
  const W=K.world, {check,record,id,equal}=W.data, freeze=K.procedural.data.freeze;
  const size=128, zero=Object.freeze([0,0,0]), vectorAt=(column,i)=>column.slice(i*3,i*3+3);
  const sameVector=(a,b)=>a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2];
  const empty=freeze({version:1,pages:[],taskNames:[],serial:0});
  const indexes=new WeakMap(), orders=new WeakMap(), projections=new WeakMap(), legacy=new WeakMap();
  const emptyPage=()=>({ids:[],generations:[],positions:[],velocities:[],tasks:[],details:[]});
  const count=({pages})=>pages.length?(pages.length-1)*size+pages[pages.length-1].ids.length:0;

  function order(roster){
    let cached=orders.get(roster);
    if(!cached){
      cached=roster.pages.flatMap((page,p)=>page.ids.map((id,i)=>({id,p,i})));
      cached.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
      orders.set(roster,cached);
    }
    return cached;
  }
  function find(roster,name){
    if(typeof name!=='string')return null;
    for(let p=0;p<roster.pages.length;p++){
      const ids=roster.pages[p].ids;
      let index=indexes.get(ids);
      if(!index){
        index=new Map(ids.map((id,i)=>[id,i]));
        indexes.set(ids,index);
      }
      const i=index.get(name);
      if(i!==undefined)return {p,i};
    }
    return null;
  }
  function read(roster,{p,i}){
    const page=roster.pages[p];
    return {...page.details[i],id:page.ids[i],generation:page.generations[i],position:vectorAt(page.positions,i),
      velocity:vectorAt(page.velocities,i),task:roster.taskNames[page.tasks[i]-1]??null};
  }
  function select(roster,name){
    const slot=find(roster,name);
    return slot&&read(roster,slot);
  }
  function atRest(roster,{p,i}){
    const {details,positions,velocities}=roster.pages[p], row=details[i], at=i*3;
    return row.mode==='rest'&&row.goal.every((n,axis)=>n===positions[at+axis]&&velocities[at+axis]===0);
  }
  function rows(roster){
    if(!projections.has(roster))
      projections.set(roster,freeze(Object.fromEntries(order(roster).map(slot=>[slot.id,read(roster,slot)]))));
    return projections.get(roster);
  }
  function edit(roster){
    const pages=roster.pages.slice(), copied=new Map();
    let taskNames=roster.taskNames, serial=roster.serial, changed=false, layout=false;
    function write({p,i},key,value,vector=false){
      let columns=copied.get(p);
      if(!columns){
        const page=pages[p];
        pages[p]=page?{...page}:emptyPage();
        columns=new Set();
        copied.set(p,columns);
      }
      const page=pages[p];
      if(!columns.has(key)){
        page[key]=page[key].slice();
        columns.add(key);
      }
      const column=page[key];
      if(vector){
        column[i*3]=value[0];
        column[i*3+1]=value[1];
        column[i*3+2]=value[2];
      }else column[i]=value;
      changed=true;
    }
    function taskCode(task){
      if(task==null)return 0;
      let index=taskNames.indexOf(task);
      if(index<0){
        if(taskNames===roster.taskNames)taskNames=taskNames.slice();
        index=taskNames.push(task)-1;
      }
      return index+1;
    }
    function put(slot,row,before){
      const {id,generation,position,velocity,task,...details}=row;
      if(!before){
        write(slot,'ids',id);
        write(slot,'generations',generation);
      }
      if(!before||!sameVector(before.position,position))write(slot,'positions',position,true);
      if(!before||!sameVector(before.velocity,velocity))write(slot,'velocities',velocity,true);
      if(!before||before.task!==task)write(slot,'tasks',taskCode(task));
      if(!before||!equal(roster.pages[slot.p].details[slot.i],details))write(slot,'details',details);
    }
    return {
      update(slot,before,row){if(before!==row)put(slot,row,before);},
      add(row){
        const n=count({pages});
        const generation=row.generation??serial+1;
        check(Number.isSafeInteger(generation),'Agent generation limit exceeded');
        serial=Math.max(serial,generation);
        put({p:Math.floor(n/size),i:n%size},{...row,generation},null);
        layout=true;
        return generation;
      },
      remove(slot){
        const p=pages.length-1, i=pages[p].ids.length-1;
        if(slot.p!==p||slot.i!==i)put(slot,read({pages,taskNames},{p,i}),null);
        if(i===0)pages.pop();
        else{
          pages[p]=Object.fromEntries(Object.entries(pages[p]).map(([key,column])=>
            [key,column.slice(0,key==='positions'||key==='velocities'?i*3:i)]));
          copied.delete(p);
        }
        layout=changed=true;
      },
      finish(){
        if(!changed)return roster;
        const result=freeze({version:1,pages,taskNames,serial});
        if(!layout&&orders.has(roster))orders.set(result,orders.get(roster));
        return result;
      }
    };
  }
  function get(state){
    if(state.roster)return state.roster;
    if(!legacy.has(state)){
      const draft=edit(empty);
      for(const name of Object.keys(state.agents).sort())
        draft.add({...state.agents[name],id:name,velocity:zero,task:null});
      legacy.set(state,draft.finish());
    }
    return legacy.get(state);
  }
  function view(state){
    if(!state?.roster)return state;
    const {roster,...rest}=state;
    return Object.freeze({...rest,get agents(){return rows(roster);}});
  }
  function legacyState(state,expected){
    if(state?.format==='ink-studio/aggregate-state'&&state.format===expected?.format){
      const data=legacyState(state.data,expected.data);
      if(data===state.data)return state;
      const groups=data.groups.map(({velocity,...group})=>group);
      return {...state,data:{...data,groups}};
    }
    if(!state?.roster||expected?.roster||!record(expected?.agents))return state;
    const {roster,...rest}=state;
    const entries=order(roster).map(slot=>{
      const {generation,velocity,task,...row}=read(roster,slot);
      return [slot.id,row];
    });
    return {...rest,agents:Object.fromEntries(entries)};
  }
  function validate(roster,maxAgents,validateRow){
    check(record(roster)&&roster.version===1&&Array.isArray(roster.pages)&&Array.isArray(roster.taskNames)&&
      Number.isSafeInteger(roster.serial)&&roster.serial>=0&&roster.taskNames.every(id)&&
      new Set(roster.taskNames).size===roster.taskNames.length&&roster.pages.length<=Math.ceil(maxAgents/size),
    'Invalid packed agent checkpoint');
    const names=new Set(), generations=new Set();
    for(const [p,page] of roster.pages.entries()){
      const length=page?.ids?.length;
      check(record(page)&&Number.isInteger(length)&&length>0&&length<=size&&
        (p===roster.pages.length-1||length===size)&&
        Object.keys(emptyPage()).every(key=>Array.isArray(page[key])&&
          page[key].length===length*(key==='positions'||key==='velocities'?3:1))&&
        page.positions.every(Number.isFinite)&&page.velocities.every(Number.isFinite),'Invalid packed agent page');
      for(let i=0;i<length;i++){
        const name=page.ids[i], generation=page.generations[i], task=page.tasks[i];
        check(id(name)&&!names.has(name)&&Number.isSafeInteger(generation)&&generation>0&&generation<=roster.serial&&
          !generations.has(generation)&&Number.isSafeInteger(task)&&task>=0&&task<=roster.taskNames.length&&
          record(page.details[i])&&['id','generation','position','velocity','task'].every(key=>!Object.hasOwn(page.details[i],key)),
        'Invalid packed agent identity or task');
        names.add(name);
        generations.add(generation);
        validateRow(name,read(roster,{p,i}));
      }
    }
    check(names.size<=maxAgents,'Agent checkpoint exceeds capacity');
    return names;
  }
  W.agentStorage=Object.freeze({empty,zero,count,order,find,read,select,atRest,rows,edit,get,view,validate,sameVector,legacyState});
})(KIT);
