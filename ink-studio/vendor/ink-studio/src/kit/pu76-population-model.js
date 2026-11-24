/* Validated census definitions and compact household group counts. */
(function(K){
  const W=K.world, Q=W.query, {check,id,record,own,vector,endpoint}=W.data;
  const keys=(row,allowed)=>record(row)&&Object.keys(row).every(key=>allowed.includes(key));
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const tick=n=>integer(n,0,10000000);
  const count=n=>integer(n,0,1e9);
  const order=(a,b)=>a<b?-1:a>b?1:0;
  const entries=table=>Object.keys(table).sort().map(name=>[name,table[name]]);
  const numbers=bag=>Object.values(bag).reduce((total,n)=>total+n,0);
  const at=value=>vector(value)||keys(value,['entity','socket'])&&id(value.entity)&&
    (value.socket===undefined||id(value.socket));
  const actor=value=>keys(value,['system','agent','generation'])&&id(value.system)&&id(value.agent)&&
    (value.generation===undefined||integer(value.generation,1,Number.MAX_SAFE_INTEGER));
  const actorKey=({system,agent,generation})=>system+'/'+agent+'/'+generation;

  function table(value,min,max,label){
    check(record(value)&&integer(Object.keys(value).length,min,max)&&Object.keys(value).every(id),
      'Invalid population '+label);
    return entries(value);
  }
  function list(value,max,test){
    return Array.isArray(value)&&integer(value.length,1,max)&&value.every(test)&&new Set(value).size===value.length;
  }

  function definitions(config){
    check(keys(config,['interval','groups','resources','districts','workplaces','households','rules',
      'rosters','maxHouseholds','maxNamed','householdDemand']),'Invalid population configuration');
    const {interval=60,groups,districts,resources={},workplaces={},households={},rules={},rosters=[],
      maxHouseholds=4096,maxNamed=2048,householdDemand={}}=config;
    check(integer(interval,1,36000)&&integer(maxHouseholds,1,16384)&&integer(maxNamed,1,4096)&&
      (Array.isArray(rosters)&&rosters.length===0||list(rosters,128,id)),'Invalid population limits');
    for(const [name,unit] of table(resources,0,32,'resources'))
      check(typeof unit==='string'&&unit.trim().length>0&&unit.length<=64,'Invalid demand units '+name);

    function demand(raw){
      for(const [name,value] of table(raw,0,32,'demand'))
        check(own(resources,name)&&Number.isFinite(value)&&value>=0&&value<=1e6,'Invalid demand resource '+name);
      return raw;
    }
    demand(householdDemand);

    for(const [name,group] of table(groups,1,32,'groups')){
      check(keys(group,['work','demand','after','next'])&&(group.work===undefined||typeof group.work==='boolean')&&
        (group.after===undefined||group.after>0&&tick(group.after))&&
        (group.next===undefined||group.after!==undefined&&id(group.next)&&name!==group.next&&own(groups,group.next)),
        'Invalid population group '+name);
      demand(group.demand??{});
    }
    function cohorts(raw){
      for(const [name,value] of table(raw,0,32,'cohorts'))
        check(own(groups,name)&&count(value),'Invalid population cohort '+name);
      check(count(numbers(raw)),'Household population exceeds capacity');
      return Object.fromEntries(entries(raw).filter(([,value])=>value>0));
    }
    for(const [name,row] of table(districts,1,128,'districts')){
      check(keys(row,['at','capacity','supply'])&&at(row.at)&&count(row.capacity),'Invalid population district '+name);
      for(const [resource,account] of table(row.supply??{},0,32,'supply')){
        check(own(resources,resource),'Unknown district supply resource '+resource);
        endpoint(account);
      }
    }
    for(const [name,row] of table(workplaces,0,256,'workplaces'))
      check(keys(row,['district','at','capacity','groups','from','priority'])&&id(row.district)&&own(districts,row.district)&&
        (row.at===undefined||at(row.at))&&count(row.capacity)&&Number.isFinite(row.priority??0)&&
        (row.groups===undefined||list(row.groups,32,group=>id(group)&&own(groups,group)&&groups[group].work===true))&&
        (row.from===undefined||list(row.from,128,district=>id(district)&&own(districts,district))),
      'Invalid population workplace '+name);

    function person(raw,initial=false){
      check(keys(raw,initial?['group','name','age','stageAge','actor']:['group','name','age','stageAge'])&&
        id(raw.group)&&own(groups,raw.group)&&(raw.name===undefined||typeof raw.name==='string'&&raw.name.length<=256)&&
        tick(raw.age??0)&&integer(raw.stageAge??0,0,raw.age??0)&&
        (raw.actor===undefined||actor(raw.actor)&&rosters.includes(raw.actor.system)), 'Invalid named resident');
    }
    function household(raw,initial=false){
      check(keys(raw,['district','groups','residents','demand'])&&id(raw.district)&&own(districts,raw.district),'Invalid household');
      cohorts(raw.groups??{});
      for(const [,row] of table(raw.residents??{},0,maxNamed,'named residents'))person(row,initial);
      if(raw.demand!==undefined)demand(raw.demand);
    }
    for(const [,row] of table(households,0,maxHouseholds,'households'))household(row,true);

    const fields=new Set();
    for(const [name,row] of table(rules,0,32,'rules')){
      check(keys(row,['kind','district','group','from','rate','count','prefix','to','where','when'])&&
        ['birth','death','transition','immigrate','move','emigrate'].includes(row.kind)&&
        (row.district===undefined||id(row.district)&&own(districts,row.district))&&Array.isArray(row.when??[])&&
        (row.when??[]).length<=12,'Invalid population rule '+name);
      if(['birth','death','transition'].includes(row.kind)){
        check(id(row.from)&&own(groups,row.from)&&Number.isFinite(row.rate)&&row.rate>0&&row.rate<=1&&
          (row.kind==='death'||id(row.group)&&own(groups,row.group))&&(row.kind!=='transition'||row.from!==row.group),
        'Invalid demographic rate '+name);
      }else{
        check(own(districts,row.district)&&count(row.count)&&row.count>0,'Invalid migration rate '+name);
        if(row.kind==='immigrate')
          check(id(row.group)&&own(groups,row.group)&&id(row.prefix??name)&&(row.prefix??name).length<=80,
            'Invalid immigration household prefix '+name);
        if(row.kind==='move')check(id(row.to)&&own(districts,row.to)&&row.to!==row.district,'Invalid migration destination '+name);
      }
      Q.condition(row.where,undefined);
      for(const when of row.when??[]){
        check(keys(when,['field','at','args','when'])&&typeof when.field==='string'&&when.field.length>0&&
          (when.at===undefined||at(when.at))&&(when.args===undefined||record(when.args))&&record(when.when),
          'Invalid population rule condition '+name);
        Q.condition(when.when,undefined);
        fields.add(when.field);
      }
    }

    return {interval,groups,districts,resources,workplaces,households,rules,rosters,maxHouseholds,maxNamed,
      householdDemand,demand,cohorts,person,household,fields};
  }
  W.populationModel=Object.freeze({definitions,keys,integer,tick,count,entries,numbers,at,actor,actorKey,order});
})(KIT);
