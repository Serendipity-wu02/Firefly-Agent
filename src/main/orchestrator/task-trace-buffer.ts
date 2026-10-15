import type { TaskTraceRecord } from "../../shared/task-session";
import type { TaskSessionStore } from "../tasks/task-session-store";

/** Streaming reasoning deltas are observation data: they are saved in batches instead of one task rewrite each. */
export const TASK_TRACE_BATCH_LIMIT = 64;

/**
 * Buffers consecutive reasoning deltas of a child run and appends them in one task checkpoint.
 * Every other trace record (round, tool, todo, terminal, reasoning start/end) is appended together
 * with the buffered deltas immediately, so record order and content match the unbuffered behaviour.
 * An uncontrolled process exit loses at most the deltas buffered since the last flush.
 */
export function createTaskTraceBuffer(store: Pick<TaskSessionStore, "get" | "checkpoint">, taskId: string, batchLimit = TASK_TRACE_BATCH_LIMIT) {
  const pending: TaskTraceRecord[] = [];
  function flush(): void {
    if (pending.length === 0) return;
    const records = pending.splice(0);
    const current = store.get(taskId);
    if (current) store.checkpoint(taskId, { trace: [...current.trace, ...records] });
  }
  return {
    add(record: TaskTraceRecord): void {
      pending.push(record);
      if (record.kind !== "reasoning" || record.phase !== "delta" || pending.length >= batchLimit) flush();
    },
    flush,
    /** Number of records not yet saved. */
    get size(): number { return pending.length; },
  };
}
