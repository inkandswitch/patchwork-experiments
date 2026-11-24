/* One record identity, filter and clock for independently rendered views. */
(function (K) {
  const { clone, freeze } = K.procedural.data, finite = Number.isFinite;
  const record = value => K.world.data.record(value);
  const own = (object,key) => object != null && Object.hasOwn(object,key);
  const color = 0xffc477;
  const check = (ok,message) => { if (!ok) throw new TypeError('Linked views: '+message); };
  const keys = (value,allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const axes = { xy:[0,1], xz:[0,2], yz:[1,2] };
  const patterns = Object.freeze(['diagonal','dots','crosshatch','horizontal','vertical','checker','solid']);
  const symbols = Object.freeze(['circle','square','diamond','triangle','hexagon','ring']);
  const scalar = value => value===null || typeof value==='string' || typeof value==='boolean' || finite(value);

  function filters(rule) {
    if (rule === null || rule === undefined) return null;
    let total = 0;
    function validate(node, depth) {
      check(record(node) && ++total <= 2048 && depth <= 24,'invalid or excessive filter');
      const modes = ['all','any','not'].filter(key => own(node,key));
      check(modes.length <= 1,'a filter needs one logical operator');
      if (!modes.length) return;
      const [op] = modes;
      check(Object.keys(node).length === 1,'unexpected logical filter property');
      if (op === 'not') validate(node.not,depth+1);
      else {
        check(Array.isArray(node[op]) && node[op].length <= 128,'invalid filter list');
        for (const child of node[op]) validate(child,depth+1);
      }
    }
    validate(rule,0);
    K.world.query.condition(rule,{});
    return freeze(clone(rule));
  }

  function create(dataset,{ time, timeColumn, timeOrigin = 0, window = null, filter = null } = {}) {
    const { description, rows, features } = dataset ?? {};
    check(record(description) && K.world.data.id(description.id) && Array.isArray(rows) && typeof dataset.sample === 'function',
      'expected a prepared typed dataset');
    const name = description.id, byKey = new Map(), bindings = new WeakMap();
    const sourceTime = description.time;
    check(timeColumn === undefined || typeof timeColumn === 'string' && !sourceTime &&
      ['number','integer'].includes(description.columns[timeColumn]?.type),'expected a numeric time column on a table or spatial dataset');
    check(finite(timeOrigin) && (!sourceTime || timeOrigin === 0),'invalid input time origin');
    let earliest=Infinity, latest=-Infinity;
    const records = rows.map((record,row) => {
      const key = description.key === undefined ? features?.[row]?.id : record[description.key];
      const ref = freeze({ dataset:name,row,...(key !== undefined && { key }) });
      if (key !== undefined) byKey.set(key,row);
      const value = timeColumn && record[timeColumn];
      const seconds = sourceTime ? dataset.timeAt(row) : finite(value) ?
        K.dataInputs.convert(value-timeOrigin,description.columns[timeColumn].units,'s') : undefined;
      if (seconds !== undefined) {
        earliest=Math.min(earliest,seconds);
        latest=Math.max(latest,seconds);
      }
      return freeze({ ref,record,...(seconds !== undefined && { time:seconds }),
        ...(features && { geometry:features[row].geometry }) });
    });
    const timeRange = earliest !== Infinity ? freeze([earliest,latest]) : null;
    const stateIds = new WeakMap(), subscribers = new Set(), notifications = [];
    let selection = [], state, notifying = false;
    function rowOf(ref) {
      if (!record(ref) || ref.dataset !== name) return undefined;
      if (ref.key !== undefined) return byKey.get(ref.key);
      return Number.isSafeInteger(ref.row) && ref.row >= 0 && ref.row < records.length ? ref.row : undefined;
    }
    function eligible(row,filter,time,window) {
      return (window === null || row.time !== undefined && row.time >= time-window.past && row.time <= time+window.future) &&
        (filter === null || K.world.query.condition(filter,row.record));
    }
    function validateWindow(input) {
      if (input === null) return null;
      check(timeRange && keys(input,['past','future']) &&
        [input.past ?? 0,input.future ?? 0].every(n=>finite(n)&&n>=0),'invalid time window or dataset clock');
      return freeze({ past:input.past ?? 0,future:input.future ?? 0 });
    }
    function snap(time,filter,window) {
      const reuse = state && filter === state.filter && window === state.window && (window === null || time === state.time);
      const visible = reuse ? state.visible : freeze(records.filter(row=>eligible(row,filter,time,window)));
      const revision = state ? state.revision+1 : 0;
      const active = sourceTime && dataset.interval(time);
      const snapshot = freeze({ revision,time,filter,window,visible,selection:selection.map(i=>records[i].ref),
        ...(active && { active:records[active.index].ref }) });
      stateIds.set(snapshot,{ selected:new Set(selection),visible:reuse ? stateIds.get(state).visible :
        new Set(visible.map(row=>row.ref.row)) });
      return snapshot;
    }
    function notify(next) {
      notifications.push(next);
      if(notifying)return;
      notifying=true;
      let error;
      try {
        while(notifications.length) {
          const value=notifications.shift();
          for(const subscriber of [...subscribers]) try { subscriber(value); } catch(fault) { error ??= fault; }
        }
      } finally { notifying=false; }
      if(error)throw error;
    }
    function update(change) {
      check(keys(change,['time','filter','window','selection','mode']),'invalid state change');
      const {time=state.time,mode='replace'}=change;
      check(finite(time) && ['replace','add','toggle','remove'].includes(mode),'invalid time or selection mode');
      const equal=K.world.data.equal;
      const rules = own(change,'filter') ? filters(change.filter) : state.filter;
      const window = own(change,'window') ? validateWindow(change.window) : state.window;
      const nextFilter = equal(rules,state.filter) ? state.filter : rules;
      const nextWindow = equal(window,state.window) ? state.window : window;
      let nextSelection=selection;
      if(own(change,'selection')){
        check(Array.isArray(change.selection) && change.selection.length<=records.length,'invalid selection list');
        const indices=new Set(Array.from(change.selection,ref=>{
          const index=rowOf(ref);
          check(index!==undefined,'unknown record in selection');
          return index;
        }));
        const current=new Set(mode==='replace'?[]:selection);
        for(const index of indices) {
          if(mode==='remove'||mode==='toggle'&&current.has(index))current.delete(index);
          else current.add(index);
        }
        nextSelection=[...current].sort((a,b)=>a-b);
      }
      if(time===state.time && nextFilter===state.filter && nextWindow===state.window && equal(nextSelection,selection))return state;
      selection=nextSelection;
      const next=state=snap(time,nextFilter,nextWindow);
      notify(next);
      return next;
    }
    const at=time ?? (timeRange?.[0] ?? 0);
    check(finite(at),'time must be finite');
    state=snap(at,filters(filter),validateWindow(window));

    function selectionState(snapshot) {
      const ids=stateIds.get(snapshot);
      check(ids,'expected a snapshot from this linked session');
      return ids;
    }
    function chart({ x, y },snapshot=state) {
      const numeric=column=>['number','integer'].includes(description.columns[column]?.type);
      check((x==='$time'?!!timeRange:numeric(x)) && numeric(y),'chart needs numeric axes');
      const {selected}=selectionState(snapshot);
      return snapshot.visible.flatMap(row=>{
        const horizontal=x==='$time'?row.time:row.record[x], vertical=row.record[y];
        return finite(horizontal)&&finite(vertical)?[{ref:row.ref,x:horizontal,y:vertical,selected:selected.has(row.ref.row)}]:[];
      });
    }
    function table({ columns=Object.keys(description.columns),offset=0,limit=100 }={},snapshot=state) {
      check(Array.isArray(columns)&&columns.length<=128&&columns.every(column=>own(description.columns,column)) &&
        Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=10000,'invalid table projection');
      const {selected}=selectionState(snapshot);
      return { columns:columns.slice(),total:snapshot.visible.length,rows:snapshot.visible.slice(offset,offset+limit)
        .map(row=>({ref:row.ref,values:columns.map(column=>row.record[column]),selected:selected.has(row.ref.row)})) };
    }
    function map({ coordinates,plane='xz' }={},snapshot=state) {
      check(own(axes,plane),'invalid map plane');
      check(coordinates===undefined || Array.isArray(coordinates)&&coordinates.length===2&&coordinates.every(column=>
        ['number','integer'].includes(description.columns[column]?.type)), 'map needs two numeric columns');
      function geometry(source) {
        if(source.type==='GeometryCollection')return {type:source.type,geometries:source.geometries.map(geometry)};
        function project(values) {
          return typeof values[0]==='number'?axes[plane].map(i=>values[i]):values.map(project);
        }
        return {type:source.type,coordinates:project(source.coordinates)};
      }
      const {selected}=selectionState(snapshot);
      return snapshot.visible.flatMap(row=>{
        const xy=coordinates?.map(column=>row.record[column]);
        const shape=xy ? xy.every(finite)&&{type:'Point',coordinates:xy} : row.geometry&&geometry(row.geometry);
        return shape?[{ref:row.ref,geometry:shape,selected:selected.has(row.ref.row)}]:[];
      });
    }
    function encoding({ category, label, categories=[], monochrome=false }={}) {
      const columns=description.columns;
      check((category===undefined || own(columns,category) &&
        ['string','boolean','integer','number','timestamp'].includes(columns[category].type)) &&
        (label===undefined || own(columns,label)) && Array.isArray(categories) && typeof monochrome==='boolean',
        'invalid category or record label encoding');
      const custom=new Map(), groups=new Map(), used=new Map();
      for(const row of categories) {
        check(keys(row,['value','label','pattern','symbol']) && scalar(row.value) && !custom.has(row.value) &&
          (row.label===undefined || typeof row.label==='string' && row.label.trim()) &&
          (row.pattern===undefined || patterns.includes(row.pattern)) &&
          (row.symbol===undefined || symbols.includes(row.symbol)),'invalid or duplicate category encoding');
        custom.set(row.value,row);
      }
      if(category!==undefined)for(const row of records) {
        const value=row.record[category]??null;
        if(groups.has(value))continue;
        const i=groups.size, a=i%patterns.length, style=custom.get(value);
        const pattern=style?.pattern??patterns[a], symbol=style?.symbol??symbols[(a+Math.floor(i/patterns.length))%symbols.length];
        const key=pattern+'/'+symbol;
        const entry={value,label:style?.label??(value===null?'Missing':String(value)),pattern,symbol};
        groups.set(value,entry);
        const matching=used.get(key)??[];
        matching.push(entry);
        used.set(key,matching);
      }
      // Add a textual code when a pair of visual encodings is shared.
      let code=0;
      for(const matching of used.values())if(matching.length>1)
        for(const entry of matching)entry.code=String(++code);
      const entries=freeze([...groups.values()]);
      return Object.freeze({ category,label,monochrome,entries,
        mark(ref) {
          const row=records[rowOf(ref)];
          return row&&category!==undefined ? groups.get(row.record[category]??null) : undefined;
        },
        name(ref) {
          const row=records[rowOf(ref)];
          if(!row)return '';
          return String((label===undefined?undefined:row.record[label])??row.ref.key??('Record '+(row.ref.row+1)));
        }
      });
    }

    function pick(hit,{mode='replace'}={}) {
      const row=rowOf(hit?.dataMark?.source ?? hit?.target?.source);
      if(row===undefined||!selectionState(state).visible.has(row))return false;
      update({ selection:[records[row].ref],mode });
      return true;
    }

    function scene(world,snapshot=state,{ highlight = color }={}) {
      check(world?.data instanceof Float32Array && Number.isSafeInteger(world.count) &&
        Number.isSafeInteger(highlight)&&highlight>=0&&highlight<=0xffffff,'invalid linked scene or selection color');
      const ids=selectionState(snapshot);
      if(!world.dataMarks || ids.visible.size===records.length&&!ids.selected.size)return world;
      const markSnapshot=world.dataMarks.snapshot(), metadata=world.renderMetadata;
      let cached=bindings.get(world);
      if(!cached||cached.metadata!==metadata||cached.count!==world.count){
        const targets=metadata?.targets??[], marks=new Map();
        for(let i=1;i<targets.length;i++)if(targets[i]?.mark) marks.set(i,targets[i].mark);
        const rows=[];
        if(marks.size)for(let i=0;i<world.count;i++){
          const mark=marks.get(metadata.targetIds?.[i]);
          if(mark!==undefined)rows.push([i,mark]);
        }
        cached={metadata,count:world.count,rows};
        bindings.set(world,cached);
      }
      const packed=(highlight>>>16)+256*(highlight>>>8&255)+65536*(highlight&255);
      function transform(original) {
        const result=original.slice();
        for(const [i,mark] of cached.rows) {
          const row=rowOf(markSnapshot.get(mark)?.source);
          if(row===undefined)continue;
          if(!ids.visible.has(row))result[i*16+3]=0;
          else if(ids.selected.has(row))result[i*16+7]=packed;
        }
        return result;
      }
      function filtered(mark) {
        const row=rowOf(mark?.source);
        return row!==undefined&&!ids.visible.has(row)?{...mark,status:'hidden'}:mark;
      }
      const get=id=>filtered(markSnapshot.get(id));
      const snapshotView=Object.freeze({...markSnapshot,get});
      const sourceList=world.dataMarks.list;
      const dataMarks=Object.freeze({ get,snapshot:()=>snapshotView,list(options) {
        const result=sourceList(options);
        return {...result,marks:result.marks.map(mark=>get(mark.id))};
      } });
      return { ...world,data:transform(world.data),...(world.rest&&{rest:transform(world.rest)}),dataMarks };
    }

    return Object.freeze({ description,records:freeze(records),timeRange,snapshot:()=>state,update,chart,table,map,scene,pick,encoding,
      subscribe(listener,{ immediate=true }={}) {
        check(typeof listener==='function','expected a listener');
        subscribers.add(listener);
        try {
          if(immediate)listener(state);
        } catch(error) {
          subscribers.delete(listener);
          throw error;
        }
        return ()=>subscribers.delete(listener);
      }
    });
  }

  function diorama(spec,env={}) {
    let world, at=0;
    function start() {
      world=K.diorama.build(spec,env);
      at=0;
      world.anim?.update(0,0);
    }
    return ({time})=>{
      check(finite(time)&&time>=0,'diorama time must be nonnegative');
      if(!world||world.anim?.stateful&&time<at)start();
      if(world.anim?.stateful) {
        while(at<time-1e-9) {
          const dt=Math.min(1/60,time-at);
          at+=dt;
          world.anim.update(dt,at);
        }
      } else if(time!==at)world.anim?.update(1/60,time);
      at=time;
      return world;
    };
  }
  K.linkedViews=Object.freeze({create,diorama,patterns,symbols});
})(KIT);
