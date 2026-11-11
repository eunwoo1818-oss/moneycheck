export const defaults = { expense: ['식비','교통','쇼핑','주거','의료','여가','기타'], income: ['급여','부수입','용돈','이자/배당','기타'] };

export function orderedCategories(rows,order={}) {
  const normalized=rows.map(c=>({...c,name:c.name==='구독'?'고정지출':c.name})).filter((c,i,a)=>a.findIndex(v=>v.type===c.type&&v.name===c.name)===i);
  return normalized.sort((a,b)=>{
    if(a.type!==b.type)return a.type.localeCompare(b.type);
    const names=Array.isArray(order[a.type])?order[a.type]:[];
    const ai=names.indexOf(a.name),bi=names.indexOf(b.name);
    return (ai<0?Infinity:ai)-(bi<0?Infinity:bi)||a.name.localeCompare(b.name,'ko');
  });
}
