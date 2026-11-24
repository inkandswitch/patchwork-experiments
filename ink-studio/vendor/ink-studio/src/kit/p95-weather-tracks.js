/* Resolve weather triggers into ordinary interruptible sky transitions. */
(function (K) {
  const limit = SkyEnvironment.transitionLimit;
  const name = value => typeof value === 'string' && value.trim() && value.length <= 96;
  const seconds = value => Number.isFinite(value) && value >= 0 && value <= 1e9;

  function compile(sky, authored) {
    if (authored === undefined || authored === false || sky === false) return null;
    const W = K.world, { check, record, copy, own, id } = W.data, { freeze } = K.procedural.data;
    const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
    check(sky && fields(authored,['rules','cues']) && Array.isArray(authored.rules) && authored.rules.length <= 128,
      'Conditional weather needs a sky environment and up to 128 rules');
    const { rules: definitions, cues: authoredCues = [] } = freeze(copy(authored));
    const clock = SkyEnvironment.compile(sky);
    const ids = new Map();

    function readCue(value) {
      const cue = Array.isArray(value) ? { time:value[0], id:value[1] } : value;
      check(record(cue) && name(cue.id) && seconds(cue.time),'Weather cue needs an ID and scene time');
      return cue;
    }
    function markers(source) {
      check(Array.isArray(source) && source.length <= limit,'Expected a bounded weather cue list');
      return Array.from(source,readCue).filter(cue => cue.enabled !== false);
    }
    const scheduled = markers(authoredCues).sort((a,b) => a.time-b.time);
    const rules = definitions.map((rule, order) => {
      check(fields(rule,['id','trigger','transition','repeat']) && id(rule.id) && !ids.has(rule.id) &&
        (rule.repeat === undefined || typeof rule.repeat === 'boolean'),'Weather rules need unique IDs and optional repeat');
      const { trigger, transition } = rule;
      check(record(trigger) && fields(transition,['profile','duration','ease']),'Weather rule needs a trigger and transition');
      const types = ['cue','enter','condition'].filter(key => own(trigger,key));
      check(types.length === 1,'Choose exactly one weather trigger');
      const type = types[0], spec = trigger[type];
      let matches;
      if (type === 'cue') {
        check(fields(trigger,['cue','where']) && name(spec),'Weather cue trigger needs a cue name');
        W.query.condition(trigger.where,{});
        matches = cue => cue.id === spec && W.query.condition(trigger.where,cue);
      } else if (type === 'enter') {
        check(fields(trigger,['enter']) && fields(spec,['entity','socket','bounds']) && id(spec.entity) &&
          (spec.socket === undefined || id(spec.socket)),'Weather region trigger needs an entity and bounds');
        const { min, max } = W.fields.bounds(spec.bounds);
        matches = ({query}) => {
          const point = query?.frame({entity:spec.entity,socket:spec.socket})?.point;
          return Boolean(point && point.every((n,i) => n >= min[i] && n <= max[i]));
        };
      } else {
        check(fields(trigger,['condition']) && fields(spec,['field','at','args','when']) && record(spec.when) &&
          (spec.field === undefined || name(spec.field)) &&
          (spec.args === undefined || record(spec.args)),'Weather condition needs a predicate and optional field query');
        W.query.condition(spec.when,{});
        matches = ({query, view}) => {
          if (spec.field === undefined) return W.query.condition(spec.when,view);
          const observed = query?.probe(spec.field,spec.at,spec.args);
          return observed?.status === 'ok' && W.query.condition(spec.when,observed.value);
        };
      }
      const result = { id:rule.id, order, type, matches, repeat:rule.repeat === true, transition };
      ids.set(rule.id,result);
      return result;
    });
    clock.withTransitions(rules.map(rule=>({...rule.transition,at:0})));

    function transitions(state) {
      return state.firings.map(({ id, at }) => ({ ...ids.get(id).transition, at }));
    }
    function validate(state, time) {
      check(fields(state,['time','active','firings']) && state.time === time && seconds(time) &&
        Array.isArray(state.active) && state.active.length === rules.length && Array.from(state.active).every(value=>typeof value==='boolean') &&
        Array.isArray(state.firings) && state.firings.length + clock.transitions.length <= limit,'Invalid saved weather tracks');
      const seen = new Map();
      let previous = -1;
      for (const firing of state.firings) {
        check(fields(firing,['id','at']) && ids.has(firing.id) && seconds(firing.at) && firing.at >= previous && firing.at <= time &&
          (!seen.has(firing.id) || ids.get(firing.id).repeat && seen.get(firing.id)<firing.at),'Invalid saved weather trigger');
        seen.set(firing.id,firing.at);
        previous = firing.at;
      }
      return state;
    }
    function step(state, { time, cues = [], query, view, events = [], timeline = [] }) {
      check(seconds(time) && (!state || time >= state.time),'Weather tracks need nondecreasing scene time');
      const before = state?.time ?? -1;
      const candidates = [], active = state?.active.slice() ?? rules.map(()=>false);
      const fired = new Map(state?.firings.map(({id,at})=>[id,at]));
      const available = scheduled.filter(cue=>cue.time>before && cue.time<=time);
      for (const cue of markers(timeline)) if (cue.time>before && cue.time<=time) available.push(cue);
      check(Array.isArray(cues) && Array.isArray(events),'Expected scene cue and simulation event arrays');
      for (const cue of cues) {
        const event = readCue(typeof cue === 'string' ? {id:cue,time} : {...cue,time});
        if (event.enabled !== false) available.push(event);
      }
      for (const event of events) if (event.kind === 'cue') {
        if (name(event.cue)) available.push({...event,id:event.cue,time});
      }
      const observation = { ...view, time, events };
      for (const rule of rules) {
        if (!rule.repeat && fired.has(rule.id)) continue;
        if (rule.type === 'cue') {
          for (const cue of available) if (rule.matches(cue)) candidates.push({rule,at:cue.time});
          continue;
        }
        if (!view && !query) continue;
        const truth = rule.matches({query,view:observation});
        if (truth && !active[rule.order] && (state || rule.type === 'condition')) candidates.push({rule,at:time});
        active[rule.order] = truth;
      }
      const firings = state?.firings ?? [];
      const added = [];
      for (const { rule, at } of candidates.sort((a,b)=>a.at-b.at || a.rule.order-b.rule.order)) {
        if (fired.has(rule.id) && (!rule.repeat || fired.get(rule.id) === at)) continue;
        check(at+rule.transition.duration>at,'Weather transition duration is too small at its trigger time');
        added.push({id:rule.id,at});
        fired.set(rule.id,at);
      }
      check(firings.length + added.length + clock.transitions.length <= limit,'Conditional weather exceeds the sky transition budget');
      return freeze({time,active,firings:added.length ? firings.concat(added) : firings});
    }
    function sceneState(timeline = []) {
      return step(undefined,{time:1e9,timeline});
    }
    function sceneTransitions(timeline) { return transitions(sceneState(timeline)); }
    return Object.freeze({ step,validate,transitions,sceneState,sceneTransitions });
  }

  K.weather.tracks = Object.freeze({ compile });
})(KIT);
