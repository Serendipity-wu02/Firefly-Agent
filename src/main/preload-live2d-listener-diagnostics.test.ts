import { describe, expect, it, vi } from "vitest";
import { getLive2DIpcListenerCounts, LIVE2D_IPC_DIAGNOSTIC_CHANNELS } from "../preload/live2d-listener-diagnostics";
import { IPC } from "../shared/ipc-channels";

describe("Live2D preload listener diagnostics", () => {
  it("reports listener counts for all Live2D renderer IPC channels", () => {
    const listenerCount = vi.fn((channel: string) => channel.endsWith("mouth-start") ? 2 : 1);

    expect(getLive2DIpcListenerCounts({ listenerCount })).toEqual(
      Object.fromEntries(LIVE2D_IPC_DIAGNOSTIC_CHANNELS.map((channel) => [
        channel,
        channel.endsWith("mouth-start") ? 2 : 1,
      ])),
    );
  });

  it("tracks the working-state channel and no longer tracks the removed action channels", () => {
    expect(LIVE2D_IPC_DIAGNOSTIC_CHANNELS).toContain(IPC.LIVE2D_WORKING_CHANGED);
    expect(LIVE2D_IPC_DIAGNOSTIC_CHANNELS).not.toContain("live2d:play-action");
    expect(LIVE2D_IPC_DIAGNOSTIC_CHANNELS).not.toContain("live2d:action-receipt");
  });
});
