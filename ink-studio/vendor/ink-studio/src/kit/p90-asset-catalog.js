/* Searchable asset metadata independent of recipes, rendering and placement. */
(function(K) {
  const P=K.procedural||K.authoring;
  const text=value=>typeof value==='string'&&value.trim().length>0;
  const words=value=>value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').match(/[\p{L}\p{N}]+/gu)||[];
  const compare=(a,b)=>a<b?-1:a>b?1:0;

  function create(entries){
    if(!Array.isArray(entries))throw Error('Asset catalog needs entries');
    const byId=new Map(),categories=new Set();
    const index=Array.from(entries,raw=>{
      const {id,label,subtitle='',categories:groups=[],keywords=[]}=raw||{};
      if(!text(id)||byId.has(id)||!text(label)||typeof subtitle!=='string'||
         !Array.isArray(groups)||!Array.from(groups).every(text)||
         !Array.isArray(keywords)||!Array.from(keywords).every(text))
        throw Error('Asset catalog entries need unique IDs, labels and text metadata');
      const entry=P.data.freeze({id,label,subtitle,categories:[...new Set(groups)],keywords:keywords.slice()});
      byId.set(id,entry);
      for(const group of entry.categories)categories.add(group);
      const title=words(label).join(' ');
      return {entry,title,terms:words([label,id,subtitle,...groups,...keywords].join(' '))};
    }).sort((a,b)=>compare(a.title,b.title)||compare(a.entry.id,b.entry.id));
    const groups=Object.freeze([...categories].sort((a,b)=>compare(words(a).join(' '),words(b).join(' '))||compare(a,b)));
    function search({query='',category=null,offset=0,limit=24}={}){
      if(typeof query!=='string'||category!==null&&typeof category!=='string'||
         !Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>128)
        throw Error('Asset search needs text filters and a bounded page');
      const tokens=[...new Set(words(query))], phrase=tokens.join(' ');
      const found=[];
      for(const row of index){
        if(category!==null&&!row.entry.categories.includes(category))continue;
        if(!tokens.every(token=>row.terms.some(term=>term.includes(token))))continue;
        const score=!phrase?0:row.title===phrase?3:row.title.startsWith(phrase)?2:
          tokens.every(token=>row.title.includes(token))?1:0;
        found.push({entry:row.entry,score});
      }
      if(phrase)found.sort((a,b)=>b.score-a.score);
      return Object.freeze({total:found.length,items:Object.freeze(found.slice(offset,offset+limit).map(row=>row.entry))});
    }
    return Object.freeze({categories:groups,get:id=>byId.get(id)||null,search});
  }

  P.assetCatalog=Object.freeze({create});
})(KIT);
