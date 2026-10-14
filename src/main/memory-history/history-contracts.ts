import type {BoundSourceRef} from '../../shared/memory-contracts';
import type {ContextMessage,SourceDependency,TranscriptDependency} from '../memory-context/context-contracts';
import type {RecallDependency} from '../memory-recall/recall-contracts';
import type {HistoryTemporalResult} from './history-temporal';
export interface HistorySession {providerId:string;sessionId:string}
export interface HistoryPartition {actorKey:string;sessions:HistorySession[]}
export interface HistoryVector {identity:string;values:number[]}
export interface HistoryMessage extends ContextMessage {id:string;occurredAt:number|null;timeZone:string|null;sourceRef?:BoundSourceRef}
export interface HistoryDocument {id:string;incarnation:string;revision:number;origin:'canonical'|'synthetic-import';sourceDeps:SourceDependency[];messages:HistoryMessage[];vector:HistoryVector|null;transcriptRef?:TranscriptDependency;classification?:ReadonlyHistoryClassification;provenance?:ReadonlyHistoryProvenance[]}
export interface StoredHistory extends HistoryDocument {actorKey:string;providerId:string;sessionId:string;generation:number;digest:string;state:'live'|'deleted'}
/** windowTurns：词法排序按几轮一个窗口计分，0 关闭；recencyAlpha：相关度接近时新内容优先的力度，0 关闭；半衰期以天计。 */
export interface HistorySettings {version:string;limit:number;candidateLimit:number;rrfK:number;mmrLambda:number;maxTotalChars:number;maxExcerptChars:number;maxIndexDocuments:number;maxIndexBytes:number;windowTurns:number;recencyAlpha:number;recencyHalfLifeDays:number}
export const DEFAULT_HISTORY_SETTINGS:Readonly<HistorySettings>=Object.freeze({version:'history-settings-v2',limit:8,candidateLimit:50,rrfK:60,mmrLambda:.7,maxTotalChars:16000,maxExcerptChars:6000,maxIndexDocuments:512,maxIndexBytes:8388608,windowTurns:2,recencyAlpha:.1,recencyHalfLifeDays:30});
export interface HistoryDependency {documentId:string;providerId:string;sessionId:string;incarnation:string;revision:number;digest:string;generation:number;partition:HistoryPartition;indexVersion:string;tokenizerVersion:string;rankingVersion:string;recallDeps:RecallDependency[]}
export interface HistoryHit {document:StoredHistory;dependency:HistoryDependency;score:number}
/** 预算丢弃的计数，只有数字，不含任何正文、标识或查询内容。用来判断"单份文档超限"在真实使用中有多常见。 */
export const HISTORY_BUDGET_SIZE_BUCKETS=['le-6k','6k-12k','12k-24k','24k-48k','gt-48k'] as const;
export type HistoryBudgetSizeBucket=typeof HISTORY_BUDGET_SIZE_BUCKETS[number];
export interface HistoryBudgetStats {
 /** 排序后进入预算环节的文档数。 */ ranked:number;returned:number;
 /** 单份字符数超过 maxExcerptChars 而被丢弃。 */ droppedOversized:number;
 /** 单份不超限、但总预算 maxTotalChars 已用完而被丢弃。 */ droppedOverTotal:number;
 /** 单份超限的文档里，排序选中的最佳窗口本身能放进 maxExcerptChars 的份数（摘录可能救得回来；上限估计）。 */ oversizedExcerptable:number;
 /** 被丢弃文档按字符数分段计数。 */ droppedSizes:Record<HistoryBudgetSizeBucket,number>;
}
export interface HistoryResult {status:'ok'|'index-budget-exhausted'|'excerpt-budget-exhausted';hits:HistoryHit[];diversity:'vector-mmr'|'lexical-dedup';settingsVersion:string;temporal?:HistoryTemporalResult;budget?:HistoryBudgetStats}
export interface HistoryTransport {historyCommand(command:unknown):Promise<unknown>}

export type ReadonlyHistoryClassification='raw-history'|'legacy-derived-unverified'|'unverified';
/** Constructed only by a Main caller after actor/scope authorization; strings do not grant authority. */
export interface ReadonlyHistoryScope {root:string;actorKey:string;scopeKey:string;sessions:HistorySession[]}
export interface ReadonlyHistoryProvenance {
 originalId:string;seq:number|null;turnId:string|null;revision:number|null;incarnation:string;digest:string;
 span:{start:number;end:number};originalRole:ContextMessage['role'];occurredAt:number|null;timeZone:string|null;active:boolean;
 format:'transcript-v1'|'chat-session-v1';providerId:string;sessionId:string;field?:'modelContext';
}
export interface ReadonlyHistoryRecord {document:HistoryDocument;classification:ReadonlyHistoryClassification;provenance:ReadonlyHistoryProvenance[]}
export interface ReadonlyHistorySelectionHead {providerId:string;sessionId:string;incarnation:string;maxSeq:number;checkpointThroughSeq:number;completeTail:boolean}
export interface ReadonlyHistoryReadResult {selectionHeads:ReadonlyHistorySelectionHead[];documents:ReadonlyHistoryRecord[];coverage:'complete'|'partial';diagnostics:string[]}

/** Explicit immutable-by-value input for the pure parser; never a filesystem or Worker capability. */
export interface ReadonlyHistoryBytes {
 providerId:string;sessionId:string;incarnation:string;
 transcript:Uint8Array|null;snapshot:Uint8Array|null;chat:Uint8Array|null;
}
