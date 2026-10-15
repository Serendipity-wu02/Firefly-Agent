// M2b：影子抽取的一次非流式模型调用。
// 请求体由适配器生成，发送前检查它确实带着输出上限；错误按"额度/限流/超时/网络/其他"分类，不暴露服务商返回的文本。
import type {ChatRequest,ChatVendorAdapter,VendorConfig} from '../orchestrator/vendors/types';

export const SHADOW_MAX_OUTPUT_TOKENS=800;
export const SHADOW_CALL_TIMEOUT_MS=60000;
/** 输出上限的合理范围：没有、为 0 或大得离谱都不算"限制住了"。 */
const MAX_ACCEPTED_LIMIT=4096;
const LIMIT_KEYS=['max_tokens','max_output_tokens','max_completion_tokens'] as const;

export type ShadowSendResult=
 |{ok:true;text:string;usage?:{input:number;output:number;cachedInput?:number;cacheCreation?:number}}
 |{ok:false;kind:'quota'|'rate-limit'|'timeout'|'network'|'http'|'cancelled'};

export type ShadowPrepared=
 |{ok:true;send(signal:AbortSignal):Promise<ShadowSendResult>}
 |{ok:false;reason:'no-output-limit'};

/** 影子抽取使用的模型：固定的配置快照，发送前由调用方再次核对是否仍然有效。 */
export interface ShadowModel {
 readonly profile:{readonly id:string;readonly revision:number};
 /** 配置已变化时抛错。 */
 assertCurrent():void;
 prepare(system:string,user:string):ShadowPrepared;
}

/** 服务商用 400/403/429 等状态码返回"额度用完"时的常见措辞。 */
const QUOTA_TEXT=/insufficient[_\s-]?(quota|balance|funds|credit)|quota[_\s-]?(exceeded|exhausted)|exceeded your current quota|billing|out of credit|余额不足|额度(不足|已用|用尽)|欠费/i;

export function classifyShadowHttpFailure(status:number,bodyText:string):'quota'|'rate-limit'|'http' {
 if(status===402)return 'quota';
 if([400,403,429].includes(status)&&QUOTA_TEXT.test(bodyText))return 'quota';
 if(status===429)return 'rate-limit';
 return 'http';
}

/** 最终请求体里必须带着正的、不过大的输出上限，且不是流式请求。 */
export function hasOutputLimit(body:string):boolean {
 try{
  const parsed=JSON.parse(body) as Record<string,unknown>;
  if(!parsed||typeof parsed!=='object'||parsed.stream===true)return false;
  return LIMIT_KEYS.some(key=>{const v=parsed[key];return typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=MAX_ACCEPTED_LIMIT});
 }catch{return false}
}

export interface ShadowModelOptions {
 profile:{id:string;revision:number};
 config:VendorConfig;
 adapter:ChatVendorAdapter;
 assertCurrent():void;
 fetchImpl?:typeof fetch;
 timeoutMs?:number;
 /** 记入 Token 用量统计；失败不影响抽取。 */
 /** 请求即将发出时调用一次（与厂商是否返回用量无关），用于请求计数。 */
 onDispatch?(model:string):void;
 onUsage?(model:string,usage:NonNullable<Extract<ShadowSendResult,{ok:true}>['usage']>):void;
}

export function createShadowModel(options:ShadowModelOptions):ShadowModel {
 const {profile,config,adapter,assertCurrent}=options,doFetch=options.fetchImpl??fetch,timeoutMs=options.timeoutMs??SHADOW_CALL_TIMEOUT_MS;
 return Object.freeze({
  profile:Object.freeze({id:profile.id,revision:profile.revision}),
  assertCurrent,
  prepare(system:string,user:string):ShadowPrepared {
   // 不传 extraBody、不传 temperature：不同型号对取值有各自的限制。
   const request:ChatRequest={model:config.model,stream:false,maxTokens:SHADOW_MAX_OUTPUT_TOKENS,messages:[{role:'system',content:system},{role:'user',content:user}]} as ChatRequest;
   const http=adapter.buildRequest(request,config);
   if(!hasOutputLimit(http.body))return {ok:false,reason:'no-output-limit'};
   return {ok:true,async send(signal){
    if(signal.aborted)return {ok:false,kind:'cancelled'};
    const timeout=AbortSignal.timeout(timeoutMs);
    try{
     try{options.onDispatch?.(config.model)}catch{/* 计数失败不影响抽取 */}
     // 不跟随重定向：与正常模型调用一致，避免请求头和消息被带到别处。
     const response=await doFetch(http.url,{method:'POST',headers:http.headers,body:http.body,redirect:'error',signal:AbortSignal.any([signal,timeout])});
     if(!response.ok){
      const body=await response.text().catch(()=>'');
      return {ok:false,kind:classifyShadowHttpFailure(response.status,body.slice(0,1000))};
     }
     let parsed:ReturnType<ChatVendorAdapter['parseResponse']>;
     try{parsed=adapter.parseResponse(await response.json())}
     catch{return signal.aborted?{ok:false,kind:'cancelled'}:{ok:false,kind:'http'}}
     if(parsed.usage){try{options.onUsage?.(config.model,parsed.usage)}catch{/* 用量统计失败不影响抽取 */}}
     return {ok:true,text:parsed.text,...(parsed.usage?{usage:parsed.usage}:{})};
    }catch(error){
     if(signal.aborted)return {ok:false,kind:'cancelled'};
     if(timeout.aborted)return {ok:false,kind:'timeout'};
     void error;return {ok:false,kind:'network'};
    }
   }};
  },
 });
}
