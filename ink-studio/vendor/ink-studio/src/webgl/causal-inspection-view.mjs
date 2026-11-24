const roots=new WeakMap();
const labelsDefault={
  title:'Causal inspection',selection:'Inspect',current:'Current condition',evidence:'Recorded evidence',tick:'Tick',
  choose:'Select an object or region',disabled:'Causal recording is disabled',unrecorded:'No retained evidence for this selection',
  complete:'Recorded links available',partial:'Some ancestors are unavailable',parents:'Recorded links',
  state:'State',event:'Event',command:'Action',reading:'Reading',decision:'Decision',input:'Input',output:'Output',
  transfer:'Transfer'
};
const theme=`
  :host{display:block;background:var(--ink-cause-background,#17232b);color:var(--ink-cause-text,#eff2f4);
    font:var(--ink-cause-font,14px system-ui,sans-serif);color-scheme:var(--ink-cause-color-scheme,dark)}
  *{box-sizing:border-box}
  [hidden]{display:none!important}
  .shell{padding:var(--ink-cause-padding,14px);display:grid;gap:14px;
    grid-template-columns:minmax(0,1fr) minmax(280px,var(--ink-cause-width,390px))}
  .preview{min-width:0}.panel{min-width:0;display:grid;gap:12px;align-content:start}
  h2,h3,p,dl,ol{margin:0}h2{font-size:18px}h3{font-size:14px}
  header{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap}
  select,button{font:inherit;color:inherit;background:var(--ink-cause-background,#17232b);
    border:1px solid var(--ink-cause-border,#52646e);border-radius:4px;padding:4px 7px}
  :is(select,button,summary):focus-visible{outline:2px solid var(--ink-cause-accent,#9bd6c1);outline-offset:2px}
  label{display:flex;gap:7px;align-items:center}button,summary{cursor:pointer}summary strong{font-weight:650}
  .muted{color:var(--ink-cause-muted,#b3c2ca);font-size:12px}
  dl{display:grid;gap:6px;margin-top:6px}dl div{display:flex;gap:8px;justify-content:space-between}
  dd{margin:0;overflow-wrap:anywhere;text-align:end}
  ol{list-style:none;padding:0;display:grid;gap:6px;margin-top:7px;max-height:var(--ink-cause-height,430px);overflow:auto}
  li{border:1px solid var(--ink-cause-border,#52646e);border-radius:5px;padding:7px 9px;overflow-wrap:anywhere}
  li[data-root=true]{border-inline-start:3px solid var(--ink-cause-accent,#9bd6c1)}
  summary>span{float:inline-end;margin-inline-start:6px}
  li p{margin-top:6px}li button{font-size:12px;margin:5px 5px 0 0}
  @media(max-width:710px){.shell{grid-template-columns:minmax(0,1fr)}}
`;

const words=value=>String(value).replaceAll('-',' ');
function printable(value) {
  const text=typeof value==='string'?value:JSON.stringify(value);
  return text?.length>150?text.slice(0,147)+'…':text??'';
}
function sampleValue({kind,sample}) {
  if(sample.status!=='ok')return sample.reason??sample.status;
  const value=kind==='account'?sample.value.balance:sample.value;
  const units=kind==='account'?sample.value.units:sample.provenance?.units;
  return printable(value)+(units?' '+units:'');
}
function describe(row) {
  const {data,kind,type}=row;
  if(type==='state'&&kind==='account-balance')return data.account+' · '+printable(data.previous)+' → '+printable(data.balance)+' '+data.units;
  if(type==='state'&&kind==='balance-before-transfer')return data.account+' · '+printable(data.balance)+' '+data.units;
  if(kind==='transfer'&&typeof data.from==='string'&&typeof data.to==='string')
    return data.from+' → '+data.to+' · '+printable(data.applied)+' '+data.units+' · '+data.status;
  if(type==='command')return data.action+(data.commandId?' · '+data.commandId:'');
  if(type==='reading')return data.field+' · '+sampleValue({sample:data.result});
  if(row.port)return row.port+' · '+printable(data.value);
  return row.system+' · '+printable(data);
}

/** The host owns selection and rendering. This optional panel reads only committed query snapshots. */
export function mountCausalInspection(host,{
  query, targets=[], selection, options={}, labels={}, controls={}, stylesheet='', defaultStyles=true,
  formatCondition=sampleValue, formatEvidence=describe
}={}) {
  if((typeof query!=='function'&&typeof query?.trace!=='function')||!Array.isArray(targets)||
    typeof stylesheet!=='string'||typeof defaultStyles!=='boolean'||
    typeof formatCondition!=='function'||typeof formatEvidence!=='function')
    throw new TypeError('Invalid causal inspection view settings');
  const byName=new Map();
  for(const entry of targets){
    if(!entry||typeof entry.id!=='string'||!entry.id||!entry.at||byName.has(entry.id))
      throw new TypeError('Causal inspection targets need distinct IDs and selectors');
    byName.set(entry.id,entry);
  }
  const doc=host.ownerDocument, text={...labelsDefault,...labels}, root=roots.get(host)??host.attachShadow({mode:'open'});
  if(root.childElementCount)throw new Error('This host already has a causal inspection');
  roots.set(host,root);
  root.innerHTML=`<div class="shell" part="shell">
    <div class="preview" part="preview"><slot></slot></div>
    <aside class="panel" part="panel">
      <header><h2 part="title"></h2><label part="selection-control"><span></span><select part="selection"></select></label></header>
      <div class="muted" part="coverage" role="status"></div>
      <section part="current"><h3></h3><dl part="conditions"></dl></section>
      <section part="evidence"><h3></h3><ol part="nodes"></ol></section>
    </aside></div>`;
  if(defaultStyles||stylesheet){
    const style=doc.createElement('style');
    style.textContent=(defaultStyles?theme:'')+stylesheet;
    root.prepend(style);
  }
  const part=name=>root.querySelector('[part="'+name+'"]'), selectBox=part('selection');
  part('title').textContent=text.title;
  part('title').hidden=!text.title;
  part('selection-control').hidden=controls.selection===false||!targets.length;
  part('selection-control').querySelector('span').textContent=text.selection;
  part('current').querySelector('h3').textContent=text.current;
  part('evidence').querySelector('h3').textContent=text.evidence;
  for(const [value,label] of [['',text.choose],...targets.map(row=>[row.id,row.label??row.id])]){
    const option=doc.createElement('option');
    option.value=value;
    option.textContent=label;
    selectBox.append(option);
  }
  let selected=selection??targets[0]?.id, last, destroyed=false;
  function draw(report) {
    const list=part('nodes'), conditions=part('conditions'), coverage=part('coverage');
    list.replaceChildren();
    conditions.replaceChildren();
    part('current').hidden=controls.current===false||!report?.conditions.length;
    part('evidence').hidden=controls.evidence===false||!report?.nodes.length;
    coverage.textContent=report?text.tick+' '+report.tick+' · '+(text[report.status]??report.status)+
      (report.gaps.length?' ('+report.gaps.length+')':''):text.choose;
    if(!report)return;
    for(const item of report.conditions){
      const wrap=doc.createElement('div'), term=doc.createElement('dt'), value=doc.createElement('dd');
      term.textContent=item.name;
      value.textContent=formatCondition(item);
      wrap.append(term,value);conditions.append(wrap);
    }
    const rows=new Map(), related=new Map(), direct=new Map(report.roots.map(row=>[row.id,row.match]));
    const nodeById=new Map(report.nodes.map(row=>[row.id,row])), gaps=new Map(report.gaps.map(row=>[row.id,row.reason]));
    for(const {effect,cause} of report.edges){
      if(!related.has(effect))related.set(effect,[]);
      related.get(effect).push(cause);
    }
    for(const row of report.nodes){
      const item=doc.createElement('li'), detail=doc.createElement('details'), summary=doc.createElement('summary'),
        kind=doc.createElement('strong'), tick=doc.createElement('span'), content=doc.createElement('p');
      item.setAttribute('part','node');
      item.dataset.root=String(direct.has(row.id));
      item.dataset.type=row.kind==='transfer'?'transfer':row.type;
      kind.textContent=words(row.kind);
      tick.className='muted';
      tick.textContent=(text[item.dataset.type]??item.dataset.type)+' · '+text.tick+' '+row.tick;
      summary.append(kind,tick);
      content.textContent=formatEvidence(row);
      detail.append(summary,content);
      if(row.basis){
        const basis=doc.createElement('p');
        basis.className='muted';
        basis.setAttribute('part','basis');
        basis.textContent=text[row.basis]??words(row.basis);
        detail.append(basis);
      }
      detail.open=direct.has(row.id);
      const parents=related.get(row.id)??[];
      if(parents.length){
        const heading=doc.createElement('p');
        heading.className='muted';
        heading.textContent=text.parents;
        detail.append(heading);
        for(const ref of parents){
          const button=doc.createElement('button');
          button.type='button';
          const parent=nodeById.get(ref);
          button.textContent=parent?words(parent.kind)+' · '+text.tick+' '+parent.tick:ref;
          button.title=parent?ref:gaps.get(ref)??ref;
          button.onclick=()=>{
            const target=rows.get(ref);
            target.open=true;
            target.querySelector('summary').focus();
          };
          button.disabled=!parent;
          detail.append(button);
        }
      }
      rows.set(row.id,detail);
      item.append(detail);list.append(item);
    }
  }
  function refresh(){
    if(destroyed)return last;
    const entry=typeof selected==='string'?byName.get(selected):null, at=entry?.at??selected;
    selectBox.value=entry?.id??'';
    last=at?(typeof query==='function'?query():query).trace('world/causal-inspection',at,{...options,...entry?.options}).value:null;
    draw(last);
    return last;
  }
  function select(at) {
    if(typeof at==='string'&&!byName.has(at))throw new Error('Unknown causal inspection target '+at);
    selected=at;
    return refresh();
  }
  selectBox.onchange=()=>select(selectBox.value||null);
  try{refresh();}catch(error){root.replaceChildren();throw error;}
  return Object.freeze({select,refresh,report:()=>last,destroy(){destroyed=true;root.replaceChildren();}});
}
