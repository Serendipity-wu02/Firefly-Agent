/** What the history index reported for a query: `ok`, or a budget that cut the result short. */
export type HistoryRetrievalStatus="ok"|"index-budget-exhausted"|"excerpt-budget-exhausted";
export interface ScopedHistoryCoverage {
 /** `complete` only when every selected session was read AND the retrieval itself was not cut short. */
 readonly status:"complete"|"insufficient";
 readonly selected:number;
 readonly covered:number;
 readonly diagnostics:readonly string[];
 /** Whether the retrieval over the covered sessions finished within its budgets. */
 readonly retrieval:"complete"|"index-budget-exhausted"|"excerpt-budget-exhausted";
}
interface Options {
 actors:readonly object[];
 assertCurrent():void;
 capture(actor:object):Promise<{status:"captured"|"coverage-insufficient";diagnostics:readonly string[]}>;
 query(coveredActors:object[]):Promise<{evidence:object;status:HistoryRetrievalStatus}>;
}
const RETRIEVAL_CODES={"index-budget-exhausted":"MEMORY_HISTORY_INDEX_BUDGET_EXHAUSTED","excerpt-budget-exhausted":"MEMORY_HISTORY_EXCERPT_BUDGET_EXHAUSTED"} as const;
/** Partial availability never relaxes actor/source validation or invokes a legacy fallback. */
export async function queryScopedHistory(options:Options):Promise<{tokens:object[];coverage:ScopedHistoryCoverage;notice?:string}> {
 options.assertCurrent();
 const actors=[...options.actors],covered:object[]=[],diagnostics=new Set<string>();
 if(actors.length>31)diagnostics.add("MEMORY_HISTORY_SELECTION_BUDGET_EXHAUSTED");
 for(const actor of actors.slice(0,31)){
  options.assertCurrent();
  try{
   const result=await options.capture(actor);options.assertCurrent();
   if(result.status==="captured")covered.push(actor);
   else if(result.status==="coverage-insufficient"){
    diagnostics.add("MEMORY_HISTORY_COVERAGE_INSUFFICIENT");
    for(const code of result.diagnostics)if(/^MEMORY_[A-Z0-9_]{1,100}$/.test(code))diagnostics.add(code);
   }else throw Error("MEMORY_HISTORY_CAPTURE_INVALID");
  }catch(error){
   options.assertCurrent();
   if(!(error instanceof Error)||!["MEMORY_HISTORY_NATIVE_UNAVAILABLE","MEMORY_HISTORY_COVERAGE_INSUFFICIENT"].includes(error.message))throw error;
   diagnostics.add(error.message);
  }
 }
 options.assertCurrent();
 const tokens:object[]=[];let retrieval:ScopedHistoryCoverage["retrieval"]="complete";
 if(covered.length){
  const outcome=await options.query(covered);options.assertCurrent();
  tokens.push(outcome.evidence);
  // A budget that cut the retrieval short is a gap in the result, however many sources were read.
  if(outcome.status!=="ok"){retrieval=outcome.status;diagnostics.add(RETRIEVAL_CODES[outcome.status])}
 }
 const sourcesComplete=covered.length===actors.length;
 const coverage:ScopedHistoryCoverage=Object.freeze({status:sourcesComplete&&retrieval==="complete"?"complete":"insufficient",selected:actors.length,covered:covered.length,diagnostics:Object.freeze([...diagnostics]),retrieval});
 const parts:string[]=[];
 if(!sourcesComplete)parts.push("历史检索覆盖不足，仅检索了已授权且来源可验证的会话；不能据此断言历史不存在。未修复或改写原会话，也未回退旧检索。");
 if(retrieval!=="complete")parts.push("历史检索结果不完整："+(retrieval==="index-budget-exhausted"?"候选历史超出索引预算，未能返回任何历史证据":"部分命中因摘录预算用尽被省略，只返回了其余命中")+"；不能据此断言历史不存在或已检索完整。");
 const notice=parts.length?parts.join("")+"覆盖状态："+JSON.stringify(coverage):undefined;
 return {tokens,coverage,...(notice?{notice}:{})};
}
