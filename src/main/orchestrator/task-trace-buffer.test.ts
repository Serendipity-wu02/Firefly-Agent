import { describe, expect, it } from "vitest";
import type { TaskTraceRecord } from "../../shared/task-session";
import { createTaskTraceBuffer } from "./task-trace-buffer";

const delta = (n: number): TaskTraceRecord => ({ id: `d${n}`, at: n, kind: "reasoning", phase: "delta", label: "m", content: `t${n}` });
const marker = (id: string, phase: "start" | "end"): TaskTraceRecord => ({ id, at: 0, kind: "reasoning", phase, label: "m" });

function store(initial: TaskTraceRecord[] = []) {
  let trace = initial;
  const writes: TaskTraceRecord[][] = [];
  return {
    writes, trace: () => trace,
    api: {
      get: (() => ({ trace })) as never,
      checkpoint: ((_id: string, patch: { trace?: TaskTraceRecord[] }) => { trace = patch.trace!; writes.push(patch.trace!); return {} as never; }) as never,
    },
  };
}

describe("task trace buffer", () => {
  it("saves consecutive reasoning deltas in one write and keeps their order", () => {
    const s = store(), buffer = createTaskTraceBuffer(s.api, "task");
    buffer.add(marker("start", "start"));
    for (let n = 0; n < 10; n++) buffer.add(delta(n));
    expect(s.writes).toHaveLength(1); // the start marker only
    buffer.add(marker("end", "end"));
    expect(s.writes).toHaveLength(2);
    expect(s.trace().map(record => record.id)).toEqual(["start", ...Array.from({ length: 10 }, (_, n) => `d${n}`), "end"]);
  });

  it("flushes every batch limit so a long thought does not stay in memory", () => {
    const s = store(), buffer = createTaskTraceBuffer(s.api, "task", 4);
    for (let n = 0; n < 9; n++) buffer.add(delta(n));
    expect(s.writes.map(write => write.length)).toEqual([4, 8]);
    expect(buffer.size).toBe(1);
    buffer.flush();
    expect(s.trace()).toHaveLength(9);
    expect(buffer.size).toBe(0);
  });

  it("writes immediately for any other trace record, together with earlier deltas", () => {
    const s = store(), buffer = createTaskTraceBuffer(s.api, "task");
    buffer.add(delta(1)); buffer.add(delta(2));
    buffer.add({ id: "tool", at: 3, kind: "tool", phase: "start", label: "read" });
    expect(s.writes).toHaveLength(1);
    expect(s.trace().map(record => record.id)).toEqual(["d1", "d2", "tool"]);
  });

  it("appends to the trace the store already holds", () => {
    const s = store([marker("old", "start")]), buffer = createTaskTraceBuffer(s.api, "task");
    buffer.add(delta(1)); buffer.flush();
    expect(s.trace().map(record => record.id)).toEqual(["old", "d1"]);
  });

  it("does not write when nothing is pending", () => {
    const s = store(), buffer = createTaskTraceBuffer(s.api, "task");
    buffer.flush();
    expect(s.writes).toEqual([]);
  });

  it("drops the records when the task no longer exists instead of failing", () => {
    const writes: unknown[] = [];
    const buffer = createTaskTraceBuffer({ get: () => undefined, checkpoint: ((...args: unknown[]) => { writes.push(args); }) as never }, "gone");
    buffer.add(marker("x", "start"));
    expect(writes).toEqual([]); expect(buffer.size).toBe(0);
  });
});
