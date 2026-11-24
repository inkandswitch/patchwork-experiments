/* Bounded need meters and recurring activity windows in world ticks. */
(function(K){
  const W=K.world, {check,id,record,own}=W.data, Q=W.query;
  const keys=(value,names)=>record(value)&&Object.keys(value).every(key=>names.includes(key));
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const measure=n=>Number.isFinite(n)&&Math.abs(n)<=1e9;
  const clamp=(row,n)=>Math.max(row.min,Math.min(row.max,n));

  function create({needs,cycle}){
    check(needs===undefined||record(needs)&&Object.keys(needs).length<=32,'Invalid agent needs');
    check(cycle===undefined||integer(cycle,1,10000000),'Invalid activity schedule cycle');
    const meters=new Map(Object.entries(needs??{}).map(([name,row])=>{
      check(id(name)&&keys(row,['min','max','initial','perTick']),'Invalid agent need '+name);
      const {min=0,max=100,initial=min,perTick=0}=row;
      check([min,max,initial,perTick].every(measure)&&min<max&&initial>=min&&initial<=max,
        'Invalid bounds for agent need '+name);
      return [name,{min,max,initial,perTick}];
    }));
    const defaults=Object.fromEntries([...meters].map(([name,row])=>[name,row.initial]));
    let enabled=meters.size>0;
    function validValue(name,value){
      const row=meters.get(name);
      return row&&measure(value)&&value>=row.min&&value<=row.max;
    }
    function amounts(raw,label){
      check(record(raw)&&Object.entries(raw).every(([key,value])=>meters.has(key)&&measure(value)),
        'Invalid activity '+label);
      return Object.entries(raw);
    }
    function compile(name,spec){
      const {schedule,needWhen,needPriority,needEffects,needRates,commitment,urgent}=spec;
      if([schedule,needWhen,needPriority,needEffects,needRates,commitment,urgent].every(x=>x===undefined))return null;
      enabled=true;
      check(commitment===undefined||commitment==='finish'&&spec.duration!==undefined,'Invalid activity commitment '+name);
      check(needEffects===undefined||spec.duration!==undefined,'Activity need effects need a duration '+name);
      check(urgent===undefined||typeof urgent==='boolean','Invalid activity urgency '+name);
      check(needWhen===undefined||meters.size>0&&record(needWhen),'Invalid activity need condition '+name);
      Q.condition(needWhen,defaults);
      if(schedule!==undefined){
        check(cycle!==undefined&&Array.isArray(schedule)&&schedule.length>0&&schedule.length<=16,
          'Activity schedule needs a cycle and at least one window '+name);
        for(const range of schedule)check(keys(range,['start','end'])&&integer(range.start,0,cycle-1)&&
          integer(range.end,0,cycle)&&range.start!==range.end,'Invalid activity schedule window '+name);
      }
      return {schedule,needWhen,priority:amounts(needPriority??{},'need priorities'),
        effects:amounts(needEffects??{},'need effects'),rates:new Map(amounts(needRates??{},'need rates')),commitment,urgent};
    }
    function gate(program,values,tick){
      if(!program)return null;
      if(program.schedule){
        const phase=tick%cycle;
        if(!program.schedule.some(({start,end})=>start<end?phase>=start&&phase<end:phase>=start||phase<end))
          return 'outside-schedule';
      }
      return Q.condition(program.needWhen,values)?null:'need-condition';
    }
    function score(program,values){
      return program?.priority.reduce((sum,[key,weight])=>sum+weight*values[key],0)??0;
    }
    function values(overrides={}){
      check(record(overrides)&&Object.entries(overrides).every(([key,value])=>validValue(key,value)),'Invalid initial agent need');
      return {...defaults,...overrides};
    }
    function validate(values,tick){
      return record(values)&&Object.keys(values).length===meters.size&&
        [...meters.keys()].every(key=>own(values,key)&&validValue(key,values[key]))&&integer(tick,0,10000000);
    }
    function advance(values,elapsed,active){
      if(!meters.size||elapsed===0)return values;
      return Object.fromEntries([...meters].map(([key,row])=>[key,
        clamp(row,values[key]+(row.perTick+(active?.rates.get(key)??0))*elapsed)]));
    }
    function apply(values,program){
      if(!program?.effects.length)return values;
      const next={...values};
      for(const [key,amount] of program.effects)next[key]=clamp(meters.get(key),values[key]+amount);
      return next;
    }
    return {get enabled(){return enabled;},hasMeters:meters.size>0,compile,gate,score,values,validate,
      advance,apply,validValue};
  }
  W.agentNeeds=Object.freeze({create});
})(KIT);
