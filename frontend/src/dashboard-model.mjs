import {groupRecords} from './result-model.mjs';
const recordKey=r=>r.url||(r.id?`${r.author||''}:${r.id}`:null);
const uniqueRows=rows=>[...new Map(rows.filter(r=>recordKey(r)).map(r=>[recordKey(r),r])).values()];
export function repetitionMetrics(scan){
 const source=(Array.isArray(scan.analysis?.repetition?.groups)?scan.analysis.repetition.groups:[]).map(g=>({...g,records:uniqueRows(groupRecords(g))})).filter(g=>g.records.length>=2);
 const isExact=g=>g.type==='short_exact'||g.type==='common_short'||g.records.every(r=>r.text===g.records[0].text);
 // Exact content wins globally, independent of backend group order. Display only.
 const exact=new Set(source.filter(isExact).flatMap(g=>g.records.map(recordKey))),similar=new Set(),seen=new Set(),groups=[];
 for(const group of source){const same=isExact(group),records=same?group.records:group.records.filter(r=>!exact.has(recordKey(r)));if(!records.length)continue;const category=same?'exact':'similar',key=JSON.stringify([category,records.map(recordKey).sort()]);if(seen.has(key))continue;seen.add(key);if(!same)for(const r of records)similar.add(recordKey(r));groups.push({...group,records,displayCategory:category});}
 return {exact:exact.size,similar:similar.size,overlap:0,groups,exactGroups:groups.filter(g=>g.displayCategory==='exact'),similarGroups:groups.filter(g=>g.displayCategory==='similar')};
}
