export const categoryGroups={
  expense:{'식비':['외식','장보기','배달','카페·간식'],'교통':['대중교통','택시','주유·주차'],'쇼핑':['의류·잡화','미용·뷰티','생활용품'],'주거':['월세·관리비','공과금','통신비'],'의료':['병원·약국','보험료'],'여가':['문화·취미','운동','여행'],'교육':['학원·강의','도서'],'생활':['경조사·선물','반려동물','세금·수수료']},
  income:{'급여':['월급','상여금'],'부수입':['프리랜서','사업','중고판매'],'금융수입':['이자','배당금'],'기타수입':['환급금','지원금']}
};
export const defaults = { expense: ['식비','교통','쇼핑','주거','의료','여가','기타'], income: ['급여','부수입','용돈','이자/배당','기타'] };
for(const kind of ['expense','income'])for(const [group,names] of Object.entries(categoryGroups[kind]))defaults[kind].push(...names.map(name=>group+' · '+name));

export function orderedCategories(rows,order={}) {
  const presets=Object.entries(defaults).flatMap(([type,names])=>names.map(name=>({type,name})));
  const normalized=[...rows,...presets].map(c=>({...c,name:c.name==='구독'?'고정지출':c.name})).filter((c,i,a)=>a.findIndex(v=>v.type===c.type&&v.name===c.name)===i);
  return normalized.sort((a,b)=>{
    if(a.type!==b.type)return a.type.localeCompare(b.type);
    const names=Array.isArray(order[a.type])?order[a.type]:[];
    const ai=names.indexOf(a.name),bi=names.indexOf(b.name);
    return (ai<0?Infinity:ai)-(bi<0?Infinity:bi)||a.name.localeCompare(b.name,'ko');
  });
}
