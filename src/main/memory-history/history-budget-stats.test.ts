import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {HISTORY_BUDGET_RETAINED_DAYS,countHistoryBudgetDrop,createHistoryBudgetStatsStore,emptyHistoryBudgetStats,historyBudgetBucket,lazyHistoryBudgetStatsRecorder} from './history-budget-stats';

const dirs:string[]=[];
const tempFile=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-budget-'));dirs.push(dir);return path.join(dir,'memory-history-budget.json')};
afterEach(()=>{for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});vi.restoreAllMocks()});
const day=(iso:string)=>new Date(iso+'T12:00:00').getTime();

describe('historyBudgetBucket',()=>{
 it.each([[0,'le-6k'],[6000,'le-6k'],[6001,'6k-12k'],[12000,'6k-12k'],[12001,'12k-24k'],[24001,'24k-48k'],[48000,'24k-48k'],[48001,'gt-48k'],[65536,'gt-48k']] as const)('%i chars falls in %s',(chars,bucket)=>{
  expect(historyBudgetBucket(chars)).toBe(bucket);
 });
});

describe('countHistoryBudgetDrop',()=>{
 it('separates oversized documents, those with a single over-long message, and total-budget drops',()=>{
  const stats=emptyHistoryBudgetStats();
  countHistoryBudgetDrop(stats,7000,[7000],6000);
  countHistoryBudgetDrop(stats,8000,[4000,4000],6000);
  countHistoryBudgetDrop(stats,3000,[3000],6000);
  expect(stats).toMatchObject({droppedOversized:2,oversizedWithLongMessage:1,droppedOverTotal:1,droppedSizes:{'le-6k':1,'6k-12k':2}});
 });
});

describe('createHistoryBudgetStatsStore',()=>{
 const stats=(patch:Partial<ReturnType<typeof emptyHistoryBudgetStats>>={})=>({...emptyHistoryBudgetStats(),...patch});

 it('accumulates queries per local day and counts queries that dropped anything',()=>{
  const file=tempFile();let now=day('2026-10-14');const store=createHistoryBudgetStatsStore(file,()=>now);
  store.record(stats({ranked:3,returned:3}));
  const dropped=stats({ranked:4,returned:1,droppedOversized:2,droppedOverTotal:1,oversizedWithLongMessage:1});dropped.droppedSizes['6k-12k']=2;dropped.droppedSizes['le-6k']=1;store.record(dropped);
  now=day('2026-10-15');store.record(stats({ranked:1,returned:1}));
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  expect(saved.days['2026-10-14']).toEqual({queries:2,queriesWithDrops:1,ranked:7,returned:4,droppedOversized:2,droppedOverTotal:1,oversizedWithLongMessage:1,droppedSizes:{'le-6k':1,'6k-12k':2,'12k-24k':0,'24k-48k':0,'gt-48k':0}});
  expect(saved.days['2026-10-15']).toMatchObject({queries:1,queriesWithDrops:0});
  expect(store.read()).toEqual(saved);
 });

 it('the file holds only counters: no text, ids or other strings besides dates and fixed key names',()=>{
  const file=tempFile();createHistoryBudgetStatsStore(file,()=>day('2026-10-14')).record(stats({ranked:2,returned:2}));
  const strings=[...fs.readFileSync(file,'utf8').matchAll(/"([^"]*)"/g)].map(m=>m[1]);
  expect(new Set(strings)).toEqual(new Set(['schemaVersion','days','2026-10-14','queries','queriesWithDrops','ranked','returned','droppedOversized','droppedOverTotal','oversizedWithLongMessage','droppedSizes','le-6k','6k-12k','12k-24k','24k-48k','gt-48k']));
 });

 it(`keeps only the most recent ${HISTORY_BUDGET_RETAINED_DAYS} days`,()=>{
  const file=tempFile();let now=0;const store=createHistoryBudgetStatsStore(file,()=>now);
  const start=day('2026-01-01');for(let i=0;i<HISTORY_BUDGET_RETAINED_DAYS+5;i++){now=start+i*86400000;store.record(stats())}
  const days=Object.keys(store.read().days);expect(days).toHaveLength(HISTORY_BUDGET_RETAINED_DAYS);expect(days[0]).toBe('2026-01-06');
 });

 it('ignores malformed statistics and never overwrites an existing file it cannot validate',()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const file=tempFile(),store=createHistoryBudgetStatsStore(file,()=>day('2026-10-14'));
  store.record({...stats(),ranked:-1});store.record({...stats(),returned:1.5});expect(fs.existsSync(file)).toBe(false);
  fs.writeFileSync(file,'{"not":"ours"}');expect(()=>store.record(stats())).not.toThrow();
  expect(fs.readFileSync(file,'utf8')).toBe('{"not":"ours"}');expect(warn).toHaveBeenCalled();
 });

 it('the lazy recorder resolves the file only on first use',()=>{
  const file=tempFile(),resolve=vi.fn(()=>file),record=lazyHistoryBudgetStatsRecorder(resolve);
  expect(resolve).not.toHaveBeenCalled();record(stats());record(stats());
  expect(resolve).toHaveBeenCalledTimes(1);expect(Object.values(JSON.parse(fs.readFileSync(file,'utf8')).days)).toEqual([expect.objectContaining({queries:2})]);
 });
});
