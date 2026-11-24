/* Public offers are evaluated using each responder's own preferences. */
(function(K){
  const W=K.world, Q=W.query, {check,id,record,endpoint}=W.data;
  const keys=(value,names)=>record(value)&&Object.keys(value).every(key=>names.includes(key));
  const magnitude=n=>Number.isFinite(n)&&Math.abs(n)<=1e9;
  const weight=n=>magnitude(n)&&n>=0;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const compare=(a,b)=>a<b?-1:a>b?1:0;

  function configure(config){
    check(keys(config,['board','profiles','members'])&&id(config.board)&&record(config.profiles)&&
      integer(Object.keys(config.profiles).length,1,128)&&record(config.members)&&
      integer(Object.keys(config.members).length,1,4096),'Invalid agent influence settings');
    const profiles=new Map(Object.entries(config.profiles).map(([name,raw])=>{
      check(id(name)&&keys(raw,['templates','priorityWeight','rewardWeight','distanceCost','minScore','when']),
        'Invalid influence preference '+name);
      const {templates,priorityWeight=1,rewardWeight=1,distanceCost=1,minScore=0,when}=raw;
      check(Array.isArray(templates)&&integer(templates.length,1,128)&&templates.every(id)&&
        new Set(templates).size===templates.length&&[priorityWeight,rewardWeight,distanceCost].every(weight)&&
        magnitude(minScore),'Invalid influence preference '+name);
      Q.condition(when,{});
      return [name,{templates:new Set(templates),priorityWeight,rewardWeight,distanceCost,minScore,when}];
    }));
    const members=Object.entries(config.members).sort(([a],[b])=>compare(a,b)).map(([agent,raw])=>{
      check(id(agent)&&keys(raw,['profile','wallet'])&&profiles.has(raw.profile),'Invalid influence member '+agent);
      if(raw.wallet!==undefined)endpoint(raw.wallet);
      return {agent,profile:profiles.get(raw.profile),wallet:raw.wallet};
    });
    return {board:config.board,members};
  }

  function rank(responders,offers,{maxPairs,cursor,report}){
    const bids=[];
    const count=responders.length*offers.length, start=count?cursor%count:0, reviewed=Math.min(count,maxPairs);
    for(let offset=0;offset<reviewed;offset++){
      const index=(start+offset)%count, offer=offers[Math.floor(index/responders.length)],
        responder=responders[index%responders.length];
      const {profile,row,available,wallet}=responder;
      if(!profile.templates.has(offer.template))continue;
      const distance=K.V.dist(row.position,offer.position);
      if(!Number.isFinite(distance)){report(offer,responder,'target-unavailable');continue;}
      const score=offer.priority*profile.priorityWeight+offer.reward*profile.rewardWeight-distance*profile.distanceCost;
      const reason=available!==true?available:
        !Q.condition(profile.when,responder.context)?'agent-condition':
        offer.reward&&!wallet?'missing-wallet':
        score<profile.minScore?'insufficient-incentive':null;
      if(reason)report(offer,responder,reason,{score,distance});
      else bids.push({offer,responder,score,distance});
    }
    const limited=reviewed<count;
    return {bids,limited,cursor:limited?(start+reviewed)%count:0};
  }

  const byBid=(a,b)=>b.score-a.score||a.distance-b.distance||a.offer.posted-b.offer.posted||
    compare(a.offer.id,b.offer.id)||compare(a.responder.system,b.responder.system)||compare(a.responder.row.id,b.responder.row.id);
  W.influenceChoices=Object.freeze({configure,rank,byBid,keys,magnitude,integer,compare});
})(KIT);
