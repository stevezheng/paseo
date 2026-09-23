// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";
import { useChatOutline } from "./use-chat-outline";

const runtime = vi.hoisted(() => ({
  listAgentTimelinePrompts: vi.fn(),
  fetchAgentTimeline: vi.fn(),
  subscribeAgentTimeline: vi.fn(() => {
    throw new Error("The outline must reuse the viewed timeline");
  }),
}));

vi.mock("@/constants/platform", () => ({ isWeb: true }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => runtime,
    fetchAgentTimeline: runtime.fetchAgentTimeline,
  }),
}));

const transcript: StreamItem[] = [
  {
    kind: "user_message",
    id: "prompt-9",
    text: "older prompt",
    timestamp: new Date(9),
    timelineCursor: { epoch: "epoch-1", seq: 9 },
  },
  {
    kind: "assistant_message",
    id: "answer-9",
    text: "older answer",
    timestamp: new Date(14),
    timelineCursor: { epoch: "epoch-1", seq: 14 },
  },
  {
    kind: "user_message",
    id: "prompt-20",
    text: "newest prompt",
    timestamp: new Date(20),
    timelineCursor: { epoch: "epoch-1", seq: 20 },
  },
  {
    kind: "assistant_message",
    id: "answer-20",
    text: "newest answer",
    timestamp: new Date(31),
    timelineCursor: { epoch: "epoch-1", seq: 31 },
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("useChatOutline", () => {
  beforeEach(() => {
    runtime.listAgentTimelinePrompts.mockReset();
    runtime.fetchAgentTimeline.mockReset();
    runtime.subscribeAgentTimeline.mockClear();
  });

  it("drops a late prompt index after the authoritative timeline epoch changes", async () => {
    const first = deferred<{ epoch: string; prompts: [] }>();
    const second = deferred<{
      epoch: string;
      prompts: Array<{ seq: number; timestamp: string; preview: string }>;
    }>();
    runtime.listAgentTimelinePrompts
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const viewportRef = createRef<StreamViewportHandle>();
    const { result, rerender } = renderHook(
      ({ timelineEpoch }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch,
          tail: [],
          head: [],
          enabled: true,
          viewportRef,
          onJumpError: vi.fn(),
        }),
      { initialProps: { timelineEpoch: "epoch-1" } },
    );
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(1));

    rerender({ timelineEpoch: "epoch-2" });
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(2));
    await act(async () => first.resolve({ epoch: "epoch-1", prompts: [] }));
    expect(result.current.prompts).toEqual([]);

    await act(async () =>
      second.resolve({
        epoch: "epoch-2",
        prompts: [{ seq: 2, timestamp: new Date(2).toISOString(), preview: "current prompt" }],
      }),
    );
    await waitFor(() => {
      expect(result.current.prompts).toHaveLength(1);
    });
    expect(result.current.prompts[0]?.seq).toBe(2);
  });

  it("refreshes from viewed user messages without another stream and keeps the newest index", async () => {
    const older = deferred<{
      epoch: string;
      prompts: Array<{ seq: number; timestamp: string; preview: string }>;
    }>();
    const newer = deferred<{
      epoch: string;
      prompts: Array<{ seq: number; timestamp: string; preview: string }>;
    }>();
    runtime.listAgentTimelinePrompts
      .mockResolvedValueOnce({ epoch: "epoch-1", prompts: [] })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const viewportRef = createRef<StreamViewportHandle>();
    const { result, rerender } = renderHook(
      ({ tail }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch: "epoch-1",
          tail,
          head: [],
          enabled: true,
          viewportRef,
          onJumpError: vi.fn(),
        }),
      { initialProps: { tail: [] as import("@/types/stream").StreamItem[] } },
    );
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(1));
    const loadedPrompt = (seq: number): import("@/types/stream").StreamItem => ({
      id: `prompt-${seq}`,
      kind: "user_message",
      text: "live prompt",
      timestamp: new Date(seq),
      timelineCursor: { epoch: "epoch-1", seq },
    });
    rerender({ tail: [loadedPrompt(2)] });
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(2));
    rerender({ tail: [loadedPrompt(2), loadedPrompt(3)] });
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(3));
    await act(async () =>
      newer.resolve({
        epoch: "epoch-1",
        prompts: [{ seq: 3, timestamp: new Date(3).toISOString(), preview: "newer" }],
      }),
    );
    await act(async () =>
      older.resolve({
        epoch: "epoch-1",
        prompts: [{ seq: 2, timestamp: new Date(2).toISOString(), preview: "older" }],
      }),
    );

    expect(result.current.prompts.map((prompt) => prompt.seq)).toEqual([3]);
    expect(runtime.subscribeAgentTimeline).not.toHaveBeenCalled();
  });

  it("refreshes after reconnect catch-up and visibility changes without reacting to assistant chunks", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 1, timestamp: new Date(1).toISOString(), preview: "Unloaded prompt" }],
    });
    const viewportRef = createRef<StreamViewportHandle>();
    const { result, rerender } = renderHook(
      ({ enabled, head, timelineEpoch }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          tail: [],
          head,
          timelineEpoch,
          enabled,
          viewportRef,
          visibleMessageIds: new Set(),
          onJumpError: vi.fn(),
        }),
      {
        initialProps: {
          enabled: true,
          head: [] as import("@/types/stream").StreamItem[],
          timelineEpoch: "epoch-1",
        },
      },
    );
    await waitFor(() => expect(result.current.prompts[0]?.preview).toBe("Unloaded prompt"));
    rerender({
      enabled: true,
      head: [
        {
          id: "assistant",
          kind: "assistant_message",
          text: "chunk",
          timestamp: new Date(),
          timelineCursor: { epoch: "epoch-1", seq: 2 },
        },
      ],
      timelineEpoch: "epoch-1",
    });
    expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(1);
    rerender({ enabled: false, head: [], timelineEpoch: "epoch-1" });
    expect(result.current.prompts).toEqual([]);
    // The viewed model publishes the catch-up from the reconnected transport.
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-2",
      prompts: [{ seq: 1, timestamp: new Date(2).toISOString(), preview: "Replaced conversation" }],
    });
    rerender({
      enabled: true,
      head: [
        {
          id: "reconnected-user",
          kind: "user_message",
          text: "Replaced conversation",
          timestamp: new Date(2),
          timelineCursor: { epoch: "epoch-2", seq: 1 },
        },
      ],
      timelineEpoch: "epoch-2",
    });
    await waitFor(() => expect(result.current.prompts[0]?.preview).toBe("Replaced conversation"));
    expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(2);
    expect(runtime.subscribeAgentTimeline).not.toHaveBeenCalled();
  });

  it("walks back from an answer to the prompt that produced it", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [
        { seq: 9, timestamp: new Date(9).toISOString(), preview: "older prompt" },
        { seq: 20, timestamp: new Date(20).toISOString(), preview: "newest prompt" },
      ],
    });
    const scrollToMessage = vi.fn();
    const viewportRef = createRef<StreamViewportHandle>();
    viewportRef.current = {
      scrollToBottom: vi.fn(),
      prepareForViewportChange: vi.fn(),
      scrollToMessage,
    };
    const { result } = renderHook(() =>
      useChatOutline({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch: "epoch-1",
        tail: transcript,
        head: [],
        enabled: true,
        viewportRef,
        onJumpError: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.prompts).toHaveLength(2));

    // The reader is at the bottom of the newest answer, so the first press lands on the prompt
    // above it and only the second one steps back a turn.
    act(() => result.current.reportReadingPosition(31));
    expect(result.current.jumpToPreviousPrompt()).toBe(true);
    expect(scrollToMessage).toHaveBeenLastCalledWith("prompt-20");

    act(() => result.current.reportReadingPosition(20));
    expect(result.current.jumpToPreviousPrompt()).toBe(true);
    expect(scrollToMessage).toHaveBeenLastCalledWith("prompt-9");
  });

  it("reports a failed unloaded prompt jump", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 1, timestamp: new Date(1).toISOString(), preview: "prompt" }],
    });
    runtime.fetchAgentTimeline.mockRejectedValue(new Error("disconnected"));
    const onJumpError = vi.fn();
    const viewportRef = createRef<StreamViewportHandle>();
    const { result } = renderHook(() =>
      useChatOutline({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch: "epoch-1",
        tail: [],
        head: [],
        enabled: true,
        viewportRef,
        onJumpError,
      }),
    );
    await waitFor(() => expect(result.current.prompts).toHaveLength(1));
    await act(async () => result.current.jumpToPrompt(1));

    await waitFor(() => expect(onJumpError).toHaveBeenCalledOnce());
  });

  it("reveals an already-loaded older prompt before scrolling to it", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 1, timestamp: new Date(1).toISOString(), preview: "prompt" }],
    });
    const scrollToMessage = vi.fn();
    const revealLoadedMessage = vi.fn(() => true);
    const viewport: StreamViewportHandle = {
      scrollToBottom: vi.fn(),
      prepareForViewportChange: vi.fn(),
      scrollToMessage,
    };
    const viewportRef = { current: viewport };
    const tail = [
      {
        id: "older-prompt",
        kind: "user_message" as const,
        text: "prompt",
        timestamp: new Date(1),
        timelineCursor: { epoch: "epoch-1", seq: 1 },
      },
    ];
    const { result, rerender } = renderHook(
      ({ visibleMessageIds }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch: "epoch-1",
          tail,
          head: [],
          enabled: true,
          viewportRef,
          onJumpError: vi.fn(),
          visibleMessageIds,
          revealLoadedMessage,
        }),
      { initialProps: { visibleMessageIds: new Set<string>() } },
    );

    await waitFor(() => expect(result.current.prompts).toHaveLength(1));
    await act(async () => result.current.jumpToPrompt(1));
    expect(revealLoadedMessage).toHaveBeenCalledWith("older-prompt");
    expect(scrollToMessage).not.toHaveBeenCalled();

    rerender({ visibleMessageIds: new Set(["older-prompt"]) });
    await waitFor(() => expect(scrollToMessage).toHaveBeenCalledWith("older-prompt"));
  });

  it("reveals a fetched prompt that lands outside the mounted history window", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 1, timestamp: new Date(1).toISOString(), preview: "prompt" }],
    });
    const fetch = deferred<void>();
    runtime.fetchAgentTimeline.mockReturnValue(fetch.promise);
    const scrollToMessage = vi.fn();
    const revealLoadedMessage = vi.fn(() => true);
    const viewportRef = {
      current: {
        scrollToBottom: vi.fn(),
        prepareForViewportChange: vi.fn(),
        scrollToMessage,
      },
    };
    const fetchedPrompt = {
      id: "fetched-prompt",
      kind: "user_message" as const,
      text: "prompt",
      timestamp: new Date(1),
      timelineCursor: { epoch: "epoch-1", seq: 1 },
    };
    const { result, rerender } = renderHook(
      ({ tail, visibleMessageIds }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch: "epoch-1",
          tail,
          head: [],
          enabled: true,
          viewportRef,
          onJumpError: vi.fn(),
          visibleMessageIds,
          revealLoadedMessage,
        }),
      {
        initialProps: {
          tail: [] as (typeof fetchedPrompt)[],
          visibleMessageIds: new Set<string>(),
        },
      },
    );

    await waitFor(() => expect(result.current.prompts).toHaveLength(1));
    act(() => result.current.jumpToPrompt(1));
    await waitFor(() => expect(runtime.fetchAgentTimeline).toHaveBeenCalledOnce());

    rerender({ tail: [fetchedPrompt], visibleMessageIds: new Set<string>() });
    await waitFor(() => expect(revealLoadedMessage).toHaveBeenCalledWith(fetchedPrompt.id));
    expect(scrollToMessage).not.toHaveBeenCalled();

    rerender({ tail: [fetchedPrompt], visibleMessageIds: new Set([fetchedPrompt.id]) });
    await waitFor(() => expect(scrollToMessage).toHaveBeenCalledOnce());
    expect(scrollToMessage).toHaveBeenCalledWith(fetchedPrompt.id);
    await act(async () => fetch.resolve());
  });

  it("jumps directly to a loaded prompt in the live head", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 2, timestamp: new Date(2).toISOString(), preview: "prompt" }],
    });
    const scrollToMessage = vi.fn();
    const viewport: StreamViewportHandle = {
      scrollToBottom: vi.fn(),
      prepareForViewportChange: vi.fn(),
      scrollToMessage,
    };
    const livePrompt = {
      id: "live-prompt",
      kind: "user_message" as const,
      text: "prompt",
      timestamp: new Date(2),
      timelineCursor: { epoch: "epoch-1", seq: 2 },
    };
    const revealLoadedMessage = vi.fn();
    revealLoadedMessage.mockReturnValue(false);
    const { result } = renderHook(() =>
      useChatOutline({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch: "epoch-1",
        tail: [],
        head: [livePrompt],
        enabled: true,
        viewportRef: { current: viewport },
        onJumpError: vi.fn(),
        visibleMessageIds: new Set([livePrompt.id]),
        revealLoadedMessage,
      }),
    );

    await waitFor(() => expect(result.current.prompts).toHaveLength(1));
    await act(async () => result.current.jumpToPrompt(2));
    expect(scrollToMessage).toHaveBeenCalledWith("live-prompt");
  });
});
