/* Authored activity choice and confirmation over the normal agent mover. */
(function (K) {
  const W = K.world, Q = W.query, V = K.V;
  const { check, id, own, record, read, selector, vector } = W.data;
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const atOK = at => vector(at) || record(at) && (own(at, 'entity') ?
    id(at.entity) && (at.socket === undefined || id(at.socket)) && Object.keys(at).every(key => ['entity', 'socket'].includes(key)) :
    vector(at.point) && Object.keys(at).length === 1);
  const fieldOK = value => typeof value === 'string' && value.length > 0 && value.length <= 193;
  const phases = ['idle', 'traveling', 'acting', 'complete', 'blocked'];
  const blank = () => ({ choice: null, phase: 'idle', since: 0, nextPlan: 0, decisionTick: null,
    evidence: { checks: [], rejected: [] }, blockers: [] });

  function create(config, agents) {
    check(record(config), 'Agent decisions need a configuration');
    const { interval = 8, routeLimit = 12, activities, members } = config;
    check(integer(interval, 1, 3600) && integer(routeLimit, 1, 32) && record(activities) &&
      integer(Object.keys(activities).length, 1, 24) && record(members), 'Invalid agent decision policy');
    const needs=W.agentNeeds.create(config);
    const fields = new Set();
    function compileTests(tests) {
      check(Array.isArray(tests) && tests.length <= 12, 'Expected a bounded list of activity conditions');
      return tests.map(spec => {
        check(record(spec) && fieldOK(spec.field) && record(spec.when) &&
          (spec.args === undefined || record(spec.args)) && (spec.at === undefined || atOK(spec.at)) &&
          (spec.reason === undefined || typeof spec.reason === 'string' && spec.reason.length <= 160),
          'Invalid activity condition');
        Q.condition(spec.when, null);
        fields.add(spec.field);
        return { ...spec, path: spec.when.path === undefined ? undefined : selector(spec.when.path) };
      });
    }
    const catalog = new Map(Object.entries(activities).map(([name, spec]) => {
      check(id(name) && record(spec) && Number.isFinite(spec.priority ?? 0) &&
        (spec.duration === undefined || integer(spec.duration, 0, 10000000)) &&
        (spec.completeWhen === undefined || spec.duration !== undefined) &&
        record(spec.destinations) && integer(Object.keys(spec.destinations).length, 1, 16), 'Invalid activity ' + name);
      const destinations = new Map(Object.entries(spec.destinations).map(([key, site]) => {
        check(id(key) && record(site) && atOK(site.at), 'Invalid activity destination ' + name + '/' + key);
        return [key, { at: site.at, tests: compileTests(site.when ?? []) }];
      }));
      return [name, { priority: spec.priority ?? 0, duration: spec.duration, tests: compileTests(spec.when ?? []),
        completion: compileTests(spec.completeWhen ?? []), destinations, program:needs.compile(name,spec) }];
    }));
    const starting={};
    const policies = new Map(Object.entries(members).map(([name, member]) => {
      const list=Array.isArray(member)?member:member?.activities;
      check(own(agents, name) && Array.isArray(list) && integer(list.length, 1, 24) &&
        list.every(activity => catalog.has(activity)) && new Set(list).size === list.length,
        'Invalid activity list for ' + name);
      if(record(member))check(Object.keys(member).every(key=>['activities','needs'].includes(key)),
        'Invalid agent decision member '+name);
      if(needs.enabled)starting[name]=needs.values(member?.needs);
      else check(member?.needs===undefined,'Member needs must have definitions');
      return [name, needs.enabled?list.slice():list.slice().sort((a, b) => catalog.get(b).priority - catalog.get(a).priority)];
    }));
    check(policies.size > 0, 'Agent decisions need managed members');
    const initial = Object.fromEntries([...policies.keys()].map(name => [name,
      needs.enabled?{...blank(),needs:starting[name],needTick:0}:blank()]));

    function update(previous,agent,ctx,available){
      if(!needs.enabled||previous.needTick===ctx.tick)return previous;
      const activity=available&&previous.phase==='acting'&&catalog.get(previous.choice.activity);
      const elapsed=ctx.tick-previous.needTick;
      const continuous=activity&&elapsed<=(ctx.every??1)&&agent.mode!=='dormant'&&
        V.dist(agent.position,previous.choice.point)<=agent.radius*.65+1e-6;
      const values=needs.advance(previous.needs,elapsed,continuous?activity.program:null);
      const turn=policies.get(agent.id).some(name=>{
        const program=catalog.get(name).program;
        return program&&needs.gate(program,previous.needs,previous.needTick)!==needs.gate(program,values,ctx.tick);
      });
      return {...previous,needs:values,needTick:ctx.tick,nextPlan:turn?ctx.tick:previous.nextPlan};
    }
    function release(previous,agent,ctx,reason){
      if(!needs.enabled)return null;
      if(ctx&&['traveling','acting'].includes(previous.phase))
        publish(ctx,agent,'activity-interrupted',{choice:previous.choice,by:null,reason});
      return previous.choice===null&&previous.nextPlan===0?previous:
        {...blank(),needs:previous.needs,needTick:previous.needTick};
    }
    function ordering(previous,agent){
      const list=policies.get(agent.id);
      if(!needs.enabled)return {ranked:list};
      const scores=Object.fromEntries(list.map(name=>{
        const activity=catalog.get(name);
        return [name,activity.priority+needs.score(activity.program,previous.needs)];
      }));
      const scored=list.slice().sort((a,b)=>scores[b]-scores[a]);
      const current=previous.choice?.activity, program=catalog.get(current)?.program;
      if(!program?.commitment||['complete','blocked'].includes(previous.phase))return {ranked:scored,scores};
      const limit=scored.indexOf(current);
      const urgent=scored.slice(0,limit).filter(name=>catalog.get(name).program?.urgent);
      const leading=new Set([...urgent,current]);
      return {ranked:[...urgent,current,...scored.filter(name=>!leading.has(name))],scores,committed:current};
    }

    function sample(tests, fallback, ctx, samples) {
      return tests.map(spec => {
        const at = spec.at ?? fallback, result = ctx.query.probe(spec.field, at, spec.args);
        const actual = spec.path ? read(result.value, spec.path) : result.value;
        const observed = typeof actual === 'string' ? actual.slice(0, 160) :
          typeof actual === 'boolean' || Number.isFinite(actual) ? actual : null;
        const pass = result.status === 'ok' && Q.condition(spec.when, result.value);
        if (samples && samples.length < 24) samples.push({ field: spec.field, at, args: spec.args });
        return { field: spec.field, status: result.status, pass, observed,
          ...(spec.path && { path: spec.path }), ...(spec.reason && { reason: spec.reason }) };
      });
    }

    function publish(ctx, agent, kind, data, samples = []) {
      const detail = { agent: agent.id, entity: agent.entity, ...data };
      const causal = ctx.causal;
      const cause = causal?.record(kind + '-decision', detail, {
        causes: samples.map(({ field, at, args }) => causal.read(field, at, args).cause)
      });
      ctx.emit(kind, detail, cause ? [cause] : undefined);
    }

    function select(previous, agent, ctx, movement) {
      if (ctx.tick < previous.nextPlan) return { next: previous };
      const samples = ctx.causal ? [] : undefined, rejected = [], from = agent.position;
      const {ranked,scores,committed}=ordering(previous,agent);
      const evidenceFor=checks=>({checks,rejected,...(scores&&{scores}),...(committed&&{committed})});
      let routes = 0, result;
      function reject(row) {
        if (rejected.length < 24) rejected.push(row);
      }

      search: for (const name of ranked) {
        const activity = catalog.get(name), reason=needs.gate(activity.program,previous.needs,ctx.tick);
        if(reason){reject({activity:name,reason});continue;}
        const checks = sample(activity.tests, from, ctx, samples);
        if (checks.some(check => !check.pass)) {
          reject({ activity: name, reason: 'activity-condition', checks });
          continue;
        }
        const sites = [];
        for (const [destination, site] of activity.destinations) {
          const at = ctx.query.target(site.at)?.point;
          if (at) sites.push({ destination, site, at, distance: V.dist(from, at) });
          else reject({ activity: name, destination, reason: 'destination-missing' });
        }
        const current = previous.choice;
        const continuing = current?.activity === name && previous.phase !== 'blocked';
        sites.sort((a, b) => (continuing ? Number(b.destination === current.destination) -
          Number(a.destination === current.destination) : 0) || a.distance - b.distance || order(a.destination, b.destination));

        for (const { destination, site, at } of sites) {
          if (previous.phase === 'blocked' && current?.activity === name && current.destination === destination &&
              previous.blockers.some(row => row.reason === 'movement-blocked')) {
            reject({ activity: name, destination, reason: 'movement-blocked' });
            continue;
          }
          const gate = sample(site.tests, at, ctx, samples);
          if (gate.some(check => !check.pass)) {
            reject({ activity: name, destination, reason: 'destination-condition', checks: gate });
            continue;
          }
          const point = movement.fit(at);
          if (!point) {
            reject({ activity: name, destination, reason: 'destination-unfit' });
            continue;
          }
          if (continuing && current.destination === destination && V.dist(current.point, point) < 1e-6)
            return { next: { ...previous, nextPlan: ctx.tick + interval,
              ...(needs.enabled&&{decisionTick:ctx.tick,evidence:evidenceFor([...checks,...gate])}) } };
          if (routes >= routeLimit) {
            reject({ activity: name, destination, reason: 'route-budget' });
            break search;
          }
          routes++;
          const route = movement.plan(point);
          if(route.status==='pending')return {next:previous,pending:true};
          if (route.status !== 'ok' || !route.points.length) {
            reject({ activity: name, destination, reason: 'route-rejected', status: route.status,
              ...(route.blocked && { obstacle: route.blocked }) });
            continue;
          }
          result = { choice: { activity: name, destination, point }, route: route.points, checks: [...checks, ...gate] };
          break search;
        }
      }
      const choice = result?.choice ?? null, evidence = evidenceFor(result?.checks ?? []);
      const next = { ...(needs.enabled&&{needs:previous.needs,needTick:previous.needTick}),
        choice, phase: choice ? 'traveling' : 'idle', since: ctx.tick, nextPlan: ctx.tick + interval,
        decisionTick: ctx.tick, evidence, blockers: [] };
      if(needs.enabled&&previous.choice&&['traveling','acting'].includes(previous.phase)&&
        previous.choice.activity!==choice?.activity)
        publish(ctx,agent,'activity-interrupted',{choice:previous.choice,by:choice?.activity??null,
          reason:rejected.find(row=>row.activity===previous.choice.activity)?.reason??'higher-priority'},samples);
      if (choice || previous.choice || previous.decisionTick === null)
        publish(ctx, agent, choice ? 'activity-selected' : 'activity-idle',
          { choice, previous: previous.choice, ...evidence }, samples);
      return { next, route: result?.route };
    }

    function observe(current, agent, ctx, movement) {
      const choice = current.choice;
      if (!choice) return current;
      const activity = catalog.get(choice.activity), site = activity.destinations.get(choice.destination);
      const at = ctx.query.target(site.at)?.point;
      if (!at) return block('destination-missing');
      if (agent.mode === 'blocked' || agent.mode === 'waiting' || agent.mode === 'dormant')
        return block('movement-blocked');
      const reason=needs.gate(activity.program,current.needs,ctx.tick);
      if(reason)return block(reason);
      const traveling = current.phase === 'traveling';
      if (V.dist(agent.position, choice.point) > agent.radius * .65 + 1e-6)
        return traveling ? current : { ...current, phase: 'traveling', since: ctx.tick, blockers: [] };

      const fitted = movement.fit(at);
      if (!fitted) return block('destination-unfit');
      if (V.dist(fitted, choice.point) >= 1e-6)
        return { ...current, phase: 'traveling', since: ctx.tick, nextPlan: ctx.tick + 1,
          blockers: [{ reason: 'destination-moved' }] };
      if (current.phase === 'complete') return current;

      const samples = ctx.causal ? [] : undefined;
      const guards = [...sample(activity.tests, agent.position, ctx, samples), ...sample(site.tests, at, ctx, samples)];
      if (guards.some(check => !check.pass)) return block('conditions-changed', guards, samples);
      let next = current;
      if (traveling) {
        next = { ...next, phase: 'acting', since: ctx.tick, blockers: [] };
        publish(ctx, agent, 'activity-started', { choice, position: agent.position, checks: guards }, samples);
      }
      if (activity.duration === undefined || ctx.tick - next.since < activity.duration) return next;
      const checks = sample(activity.completion, agent.position, ctx, samples);
      const blockers = checks.filter(check => !check.pass);
      if (blockers.length) return { ...next, blockers };
      const values=needs.apply(next.needs,activity.program);
      publish(ctx, agent, 'activity-completed', { choice, position: agent.position, checks: [...guards, ...checks],
        ...(values!==next.needs&&{needs:values}) }, samples);
      return { ...next, phase: 'complete', since: ctx.tick, blockers: [],
        ...(values!==next.needs&&{needs:values,nextPlan:Math.min(next.nextPlan,ctx.tick+1)}) };

      function block(reason, checks = [], samples = []) {
        const blockers = [{ reason, ...(checks.length && { checks }) }];
        publish(ctx, agent, 'activity-blocked', { choice, position: agent.position, ...blockers[0] }, samples);
        return { ...current, phase: 'blocked', since: ctx.tick, nextPlan: ctx.tick + 1, blockers };
      }
    }

    return {
      initial,
      managed: name => policies.has(name),
      committed(decision){
        return Boolean(decision?.choice&&['traveling','acting'].includes(decision.phase)&&
          catalog.get(decision.choice.activity).program?.commitment);
      },
      update,
      release,
      hasNeeds:needs.hasMeters,
      checkNeed({agent,need,value}){
        check(policies.has(agent)&&needs.validValue(need,value),'Invalid need or value for managed agent '+agent);
      },
      setNeed(previous,agent,{need,value},ctx,available){
        previous=update(previous,agent,ctx,available);
        const before=previous.needs[need];
        publish(ctx,agent,'need-set',{need,before,value});
        return {...previous,needs:{...previous.needs,[need]:value},nextPlan:ctx.tick};
      },
      select,
      observe,
      checkFields(query) {
        for (const field of fields) check(query.field(field), 'Unknown activity condition field ' + field);
      },
      validate(state, live = policies) {
        check(record(state) && Object.keys(state).every(name => policies.has(name) && live.has(name)),
          'Invalid agent decisions checkpoint');
        for (const [name, allowed] of policies) {
          if (!live.has(name)) continue;
          const row = own(state, name) && state[name], choice = row?.choice;
          check(record(row) && phases.includes(row.phase) && (row.phase === 'idle' ? choice === null :
            record(choice) && allowed.includes(choice.activity) && catalog.get(choice.activity).destinations.has(choice.destination) &&
            vector(choice.point)) && integer(row.since, 0, 10000000) && (row.decisionTick === null ||
            integer(row.decisionTick, 0, 10000000)) && integer(row.nextPlan, 0, 10003600) &&
            record(row.evidence) && Array.isArray(row.evidence.checks) && Array.isArray(row.evidence.rejected) &&
            Array.isArray(row.blockers)&&(!needs.enabled||needs.validate(row.needs,row.needTick)),
          'Invalid saved activity for ' + name);
        }
      }
    };
  }
  W.agentDecisions = Object.freeze({ create });
})(KIT);
