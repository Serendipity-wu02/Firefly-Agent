import {createHash} from "node:crypto";
import type {TypedUserFact} from "../../shared/memory-contracts";
import {canonicalJson} from "../memory-core/repository-types";
import {assertContextSecretFree} from "../memory-context/source-secret-screen";
import {validateShadowResponse} from "../memory-shadow/shadow-validate";
import type {ShadowAttribute} from "../memory-shadow/shadow-contracts";
import {extractPreference,type Attribute} from "./extractor";
import {policySubjectKey} from "./fact-identity";

export const NATURAL_VERSION="user-fact-v2";
export interface NaturalProposal {attribute:TypedUserFact["attribute"];value:string;polarity:"positive"|"negative";quote:string;span:{start:number;end:number}}
export const factDigest=(value:unknown)=>createHash("sha256").update(canonicalJson(value)).digest("hex");
const attributes:Record<ShadowAttribute,TypedUserFact["attribute"]>={"form-of-address":"address",language:"language","response-style":"response-style",tool:"tool",preference:"preference"};
const normalize=(s:string)=>s.normalize("NFKC").trim().toLowerCase();
const NEGATIVE=/不|没(?:有)?|未(?:曾)?|讨厌|\b(?:not|never|dislike|hate|without|avoid)\b|\bno longer\b|\bstopp?ed (?:using|liking)\b|\b(?:don|doesn|didn|isn|wasn|aren)['’]t\b/i;
// Quotation boundaries exclude in-word apostrophes such as don't. Wishes and questions
// without a question mark still are not evidence of an existing durable preference.
const NON_FACT=/["“”‘「」『』`\n]|(?:^|\s)['’]|['’](?:$|\s)|(?:^|\s)>|如果|假如|假设|比如|例如|示例|引用|翻译|他说|她说|可能|也许|是否|这句话|这段话|想知道|想问|请问|不得不|不能不|(?:没|未|不)(?:有)?(?:说过|说|表示|确认)|[?？]|\b(?:if|suppose|hypothetical|example|quote|pretend|translate|maybe|wish|wonder)\b|\b(?:never said|did not say|didn't say|not saying|the sentence|the phrase|can I|could I|should I|do I|not only)\b/i;
const MULTI_CLAUSE=/[,，;；\n]|但是|不过|然而|\b(?:but|however|although)\b/i;
const QUALIFIED=/工作|职场|项目|个人时|在家时|\bwhen\b|\bat work\b|\bfor work\b|\bin this project\b/i;
const INSTRUCTION=/忽略.*(?:规则|指令)|覆盖.*(?:规则|指令)|系统提示|执行命令|\b(?:ignore|override)\b.*\b(?:instructions?|rules?|system)\b|\b(?:system prompt|run_command|execute command)\b/i;
const aliases:Record<string,string[]>={zh:["中文","chinese","汉语"],en:["英文","英语","english"],mixed:["中英混合","bilingual"],concise:["简洁","简短","短一点","少一点","concise","brief","short"],detailed:["详细","展开","detailed"]};

function sentence(text:string,start:number,end:number):string {
 const boundary=/[。！？!?;；\n]/;let from=start,to=end;
 while(from>0&&!boundary.test(text[from-1]))from--;
 while(to<text.length&&!boundary.test(text[to]))to++;
 return text.slice(from,to);
}
function clause(text:string,start:number,end:number):string {
 const boundary=/[。！？!?;；,，\n]/;let from=start,to=end;
 while(from>0&&!boundary.test(text[from-1]))from--;
 while(to<text.length&&!boundary.test(text[to]))to++;
 return text.slice(from,to);
}
/** Reuses every shadow schema/sensitivity check, then enforces durable self-evidence. */
export function validateNaturalResponse(raw:unknown,text:string,messageId:string):NaturalProposal[] {
 if(extractPreference(text).kind==="rejected")return [];
 try{assertContextSecretFree(text)}catch{return []}
 return validateShadowResponse(raw,{user:{id:messageId,text}}).candidates.flatMap(c=>{
  const start=text.indexOf(c.evidence.quote),end=start+c.evidence.quote.length,s=sentence(text,start,end);
  if(start!==text.lastIndexOf(c.evidence.quote)||c.status!=="asserted"||NON_FACT.test(s)||QUALIFIED.test(s)||INSTRUCTION.test(s)||INSTRUCTION.test(c.value))return [];
  // A requested one-off operation, a quote, or the assistant's guess cannot become self-evidence.
  if(!/我|以后|一直|通常|始终|\b(?:I|my|always)\b|\bcall me\b/i.test(c.evidence.quote)||(MULTI_CLAUSE.test(c.evidence.quote)&&NEGATIVE.test(c.evidence.quote)))return [];
  // A negation in a different clause cannot authorize this assertion. Conversely a
  // model may not trim an enclosing negation out of its evidence span.
  if(NEGATIVE.test(c.evidence.quote)!==(c.polarity==="negative")||NEGATIVE.test(clause(text,start,end))!==NEGATIVE.test(c.evidence.quote))return [];
  const value=normalize(c.value),support=normalize(c.evidence.quote);
  if(!support.includes(value)&&!(aliases[value]?.some(alias=>support.includes(alias))))return [];
  try{for(const part of [c.value,c.reason,c.evidence.quote])assertContextSecretFree(part)}catch{return []}
  return [{attribute:attributes[c.attribute],value:c.value.trim(),polarity:c.polarity,quote:c.evidence.quote,span:{start,end}}];
 });
}
export function typedUserFact(actor:string,proposal:Pick<NaturalProposal,"attribute"|"value"|"polarity">):TypedUserFact {
 const attribute=proposal.attribute;let value=proposal.value.trim(),legacyAttribute:Attribute=attribute,cardinality:"one"|"many"=["tool","preference"].includes(attribute)?"many":"one";
 if(attribute==="language"||attribute==="response-style"){
  const groups=attribute==="language"?["zh","en","mixed"]:["concise","detailed"];
  value=groups.find(key=>key===normalize(value)||aliases[key].some(alias=>normalize(value)===alias))??value;
 }
 if(attribute==="tool"&&["powershell","cmd","bash"].includes(normalize(value))){legacyAttribute="shell";cardinality="one";value=normalize(value)}
 // New many-valued categories use one canonical identity for equality, correction
 // and suppression. Keep display spelling and every legacy single-valued slot.
 const canonicalValue=cardinality==="many"?normalize(value).replace(/\s+/g," "):value;
 const entityKey="entity-v2-"+factDigest({actor}),slotKey=policySubjectKey(actor,legacyAttribute,"default",cardinality,canonicalValue);
 return {version:2,attribute,value,canonicalValue,polarity:proposal.polarity,cardinality,entityKey,slotKey,assertionKey:"assertion-v2-"+factDigest({slotKey,value:canonicalValue,polarity:proposal.polarity}),legacyAttribute};
}
export function assertTypedUserFact(actor:string,value:TypedUserFact):void {
 if(!value||value.version!==2||!["address","language","response-style","tool","preference"].includes(value.attribute)||typeof value.value!=="string"||!value.value.trim()||value.value.length>80||!["positive","negative"].includes(value.polarity)||canonicalJson(value)!==canonicalJson(typedUserFact(actor,value)))throw Error("MEMORY_DATA_INVALID");
}
export function naturalAssertion(fact:TypedUserFact):string {
 const label={address:"用户称呼",language:"用户回复语言","response-style":"用户回复风格",tool:"用户使用工具",preference:"用户喜好"}[fact.attribute];
 return `${label}${fact.polarity==="negative"?"（否定）":""}：${fact.value}`;
}
/** A selected manual edit is an explicit user operation, not background extraction.
 * It accepts a short replacement value or a simple self-statement for that SAME category.
 * No model/queue participates in correction or revision. */
export function parseNaturalEdit(text:string,attribute:TypedUserFact["attribute"]):NaturalProposal {
 if(typeof text!=="string"||text.length>200||extractPreference(text).kind==="rejected")throw Error("MEMORY_POLICY_UNRESOLVED");
 if(NON_FACT.test(text)||INSTRUCTION.test(text))throw Error("MEMORY_POLICY_UNRESOLVED");
 const polarity=NEGATIVE.test(text)?"negative":"positive";
 let value=text.normalize("NFKC").trim().replace(/[。.!！]$/u,"");
 const prefixes:Record<TypedUserFact["attribute"],RegExp>={
  address:/^(?:(?:以后|请|就|还是)\s*)*(?:叫我|称呼我|call me\s+)/iu,
  language:/^(?:我(?:现在|以后|更)?(?:喜欢|偏好|默认用)|以后(?:都)?(?:请)?用|I (?:prefer|use)\s+)/iu,
  "response-style":/^(?:我(?:现在|更)?(?:喜欢|希望|偏好)|以后(?:都)?(?:请)?|I (?:prefer|like|want)\s+)/iu,
  tool:/^(?:我(?:现在|平时|通常|以后)?(?:更常|不再|从不)?(?:不使用|不用|使用|改用|用)|I (?:don['’]t use|never use|use|prefer)\s+)/iu,
  preference:/^(?:我(?:现在|平时|通常)?(?:更|不再)?(?:不喜欢|不爱|喜欢|偏好|爱)|I (?:dislike|don['’]t like|like|prefer)\s+)/iu,
 };
 value=value.replace(prefixes[attribute],"").trim();
 if(attribute==="language")value=value.replace(/(?:和我交流|回答|回复)$/u,"").trim();
 if(!value||value.length>80)throw Error("MEMORY_POLICY_UNRESOLVED");
 const shadowAttribute=Object.entries(attributes).find(([,a])=>a===attribute)![0];
 const raw=JSON.stringify({facts:[{subject:"user",attribute:shadowAttribute,value,polarity,status:"asserted",quote:text,reason:"explicit selected user edit"}]});
 if(validateShadowResponse(raw,{user:{id:"edit",text}}).candidates.length!==1)throw Error("MEMORY_POLICY_UNRESOLVED");
 try{assertContextSecretFree(value)}catch{throw Error("MEMORY_POLICY_SECRET")}
 return {attribute,value,polarity,quote:text,span:{start:0,end:text.length}};
}
