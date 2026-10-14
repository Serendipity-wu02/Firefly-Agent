// 历史检索的预算丢弃计数：只记数字，不记正文、标识、会话或查询内容。
// 用来回答"单份文档超过 maxExcerptChars 在真实使用中有多常见"，再决定是否值得做摘录（PR B）。
import {AtomicJsonStore} from '../atomic-json-store';
import {HISTORY_BUDGET_SIZE_BUCKETS,type HistoryBudgetSizeBucket,type HistoryBudgetStats} from './history-contracts';

const BUCKET_LIMITS:ReadonlyArray<[number,HistoryBudgetSizeBucket]>=[[6000,'le-6k'],[12000,'6k-12k'],[24000,'12k-24k'],[48000,'24k-48k']];

export function historyBudgetBucket(chars:number):HistoryBudgetSizeBucket {
 for(const [limit,bucket] of BUCKET_LIMITS)if(chars<=limit)return bucket;
 return 'gt-48k';
}

export function emptyHistoryBudgetStats():HistoryBudgetStats {
 return {ranked:0,returned:0,droppedOversized:0,droppedOverTotal:0,oversizedWithLongMessage:0,droppedSizes:Object.fromEntries(HISTORY_BUDGET_SIZE_BUCKETS.map(b=>[b,0])) as Record<HistoryBudgetSizeBucket,number>};
}

/** 记一份被预算丢弃的文档：单份超限优先于总预算用完。 */
export function countHistoryBudgetDrop(stats:HistoryBudgetStats,length:number,messageSizes:ReadonlyArray<number>,maxExcerptChars:number):void {
 if(length>maxExcerptChars){stats.droppedOversized++;if(messageSizes.some(size=>size>maxExcerptChars))stats.oversizedWithLongMessage++}
 else stats.droppedOverTotal++;
 stats.droppedSizes[historyBudgetBucket(length)]++;
}

const COUNTERS=['queries','queriesWithDrops','ranked','returned','droppedOversized','droppedOverTotal','oversizedWithLongMessage'] as const;
export interface HistoryBudgetDay extends Record<typeof COUNTERS[number],number> {droppedSizes:Record<HistoryBudgetSizeBucket,number>}
export interface HistoryBudgetStatsFile {schemaVersion:1;days:Record<string,HistoryBudgetDay>}
/** 文件只保留最近这么多天，避免无限增长。 */
export const HISTORY_BUDGET_RETAINED_DAYS=90;

const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function validDay(v:unknown):boolean {
 if(!isRecord(v)||Object.keys(v).length!==COUNTERS.length+1||!COUNTERS.every(k=>count(v[k])))return false;
 const sizes=v.droppedSizes;return isRecord(sizes)&&Object.keys(sizes).length===HISTORY_BUDGET_SIZE_BUCKETS.length&&HISTORY_BUDGET_SIZE_BUCKETS.every(b=>count(sizes[b]));
}
export function validHistoryBudgetStatsFile(v:unknown):v is HistoryBudgetStatsFile {
 return isRecord(v)&&v.schemaVersion===1&&isRecord(v.days)&&Object.entries(v.days).every(([day,value])=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&validDay(value));
}
function validStats(v:HistoryBudgetStats):boolean {
 return isRecord(v)&&(['ranked','returned','droppedOversized','droppedOverTotal','oversizedWithLongMessage'] as const).every(k=>count(v[k]))&&isRecord(v.droppedSizes)&&HISTORY_BUDGET_SIZE_BUCKETS.every(b=>count(v.droppedSizes[b]));
}
const localDay=(now:Date)=>`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

/** 按本地日期累加计数并原子写回。写入失败只告警，不影响检索。 */
export function createHistoryBudgetStatsStore(file:string,clock:()=>number=Date.now){
 const store=new AtomicJsonStore<HistoryBudgetStatsFile>(file,validHistoryBudgetStatsFile);
 return Object.freeze({
  record(stats:HistoryBudgetStats):void {
   try{
    if(!validStats(stats))return;
    const current=store.read({schemaVersion:1,days:{}}),key=localDay(new Date(clock()));
    const day=current.days[key]??{...Object.fromEntries(COUNTERS.map(k=>[k,0])),droppedSizes:emptyHistoryBudgetStats().droppedSizes} as HistoryBudgetDay;
    const dropped=stats.droppedOversized+stats.droppedOverTotal;
    day.queries++;if(dropped>0)day.queriesWithDrops++;
    for(const k of ['ranked','returned','droppedOversized','droppedOverTotal','oversizedWithLongMessage'] as const)day[k]+=stats[k];
    for(const b of HISTORY_BUDGET_SIZE_BUCKETS)day.droppedSizes[b]+=stats.droppedSizes[b];
    const days=Object.fromEntries([...Object.entries({...current.days,[key]:day})].sort(([a],[b])=>a.localeCompare(b)).slice(-HISTORY_BUDGET_RETAINED_DAYS));
    store.write({schemaVersion:1,days});
   }catch(error){console.warn('[memory-history] budget stats write failed:',(error as Error).message)}
  },
  read():HistoryBudgetStatsFile {return store.read({schemaVersion:1,days:{}})},
 });
}

/** 生产接线用：第一次查询时才解析文件路径，未安装存储上下文的测试环境里不会触碰磁盘。 */
export function lazyHistoryBudgetStatsRecorder(resolveFile:()=>string):(stats:HistoryBudgetStats)=>void {
 let store:ReturnType<typeof createHistoryBudgetStatsStore>|undefined;
 return stats=>(store??=createHistoryBudgetStatsStore(resolveFile())).record(stats);
}
