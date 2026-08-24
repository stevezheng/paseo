import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { describe, expect, test, vi } from "vitest";

import type { SpawnedACPProcess, SessionStateResponse } from "./acp-agent.js";
import { CURSOR_FAST_FEATURE_OPTION, CursorACPAgentClient } from "./cursor-acp-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

describe("CursorACPAgentClient model discovery", () => {
  function fastConfigOption(currentValue: "false" | "true"): SessionConfigOption {
    return {
      id: "fast",
      name: "Fast",
      type: "select",
      currentValue,
      options: [
        { value: "false", name: "Off" },
        { value: "true", name: "Fast" },
      ],
    };
  }

  function effortConfigOption(currentValue: string): SessionConfigOption {
    return {
      id: "effort",
      name: "Effort",
      type: "select",
      currentValue,
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    };
  }

  function createCursorClient(
    response: SessionStateResponse,
    connection: Record<string, unknown> = {},
  ): CursorACPAgentClient {
    class TestCursorACPAgentClient extends CursorACPAgentClient {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            newSession: vi.fn().mockResolvedValue(response),
            ...connection,
          },
          initialize: { agentCapabilities: {} },
        } as SpawnedACPProcess;
      }

      protected override async closeProbe(): Promise<void> {}
    }

    return new TestCursorACPAgentClient({
      logger: createTestLogger(),
      command: ["cursor-agent", "acp"],
    });
  }

  test("returns only ACP model ids because Cursor CLI ids cannot select ACP models", async () => {
    const client = createCursorClient({
      sessionId: "session-1",
      models: {
        currentModelId: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
        availableModels: [
          {
            modelId: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
            name: "gpt-5.4",
            description: null,
          },
        ],
      },
      configOptions: [],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [
        {
          provider: "acp",
          id: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
          label: "gpt-5.4",
          description: undefined,
          isDefault: true,
          thinkingOptions: undefined,
          defaultThinkingOptionId: undefined,
        },
      ],
      modes: [],
    });
  });

  test("does not fall back to cursor-agent models when ACP reports zero models", async () => {
    const client = createCursorClient({
      sessionId: "session-1",
      models: null,
      configOptions: [],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [],
      modes: [],
    });
  });

  test("keeps modern Cursor models as plain ACP ids", async () => {
    const client = createCursorClient({
      sessionId: "session-1",
      models: {
        currentModelId: "composer-2.5",
        availableModels: [
          {
            modelId: "composer-2.5",
            name: "Composer 2.5",
            description: null,
          },
        ],
      },
      configOptions: [fastConfigOption("false")],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [
        {
          provider: "acp",
          id: "composer-2.5",
          label: "Composer 2.5",
          description: undefined,
          isDefault: true,
          thinkingOptions: undefined,
          defaultThinkingOptionId: undefined,
        },
      ],
      modes: [],
    });
  });

  test("exposes Cursor fast mode through provider features", async () => {
    const client = createCursorClient({
      sessionId: "session-1",
      models: null,
      configOptions: [fastConfigOption("false")],
    });

    await expect(
      client.listFeatures({
        provider: "acp",
        cwd: "/tmp/cursor",
      }),
    ).resolves.toEqual([
      {
        type: "toggle",
        id: "auto_accept",
        label: "Auto Accept",
        description: "Automatically approves ACP permission prompts.",
        tooltip: "Auto accept permission prompts",
        icon: "shield-check",
        value: false,
      },
      {
        type: "select",
        id: CURSOR_FAST_FEATURE_OPTION.id,
        label: "Fast",
        description: "Cursor fast mode",
        tooltip: "Select Cursor fast mode",
        icon: "zap",
        value: "false",
        options: [
          {
            id: "false",
            label: "Off",
            isDefault: true,
            description: undefined,
            metadata: undefined,
          },
          {
            id: "true",
            label: "Fast",
            isDefault: false,
            description: undefined,
            metadata: undefined,
          },
        ],
      },
    ]);
  });

  test("attaches effort thinking only to models that expose it after a per-model refresh", async () => {
    let currentModelId = "grok-4.6";
    const unstableSetSessionModel = vi.fn(async ({ modelId }: { modelId: string }) => {
      currentModelId = modelId;
    });
    const setSessionConfigOption = vi.fn(async () => ({
      configOptions:
        currentModelId === "grok-4.6"
          ? [effortConfigOption("low"), fastConfigOption("true")]
          : [fastConfigOption("true")],
    }));
    const client = createCursorClient(
      {
        sessionId: "session-1",
        models: {
          currentModelId: "grok-4.6",
          availableModels: [
            { modelId: "grok-4.6", name: "Grok 4.6", description: null },
            { modelId: "composer-2.5", name: "Composer 2.5", description: null },
          ],
        },
        configOptions: [effortConfigOption("low"), fastConfigOption("true")],
      },
      { unstable_setSessionModel: unstableSetSessionModel, setSessionConfigOption },
    );

    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/cursor-thinking",
      force: false,
    });

    expect(unstableSetSessionModel).toHaveBeenCalledWith({
      sessionId: "session-1",
      modelId: "composer-2.5",
    });
    expect(setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "session-1",
      configId: "fast",
      value: "true",
    });

    const grok = catalog.models.find((model) => model.id === "grok-4.6");
    const composer = catalog.models.find((model) => model.id === "composer-2.5");
    expect(grok?.thinkingOptions).toEqual([
      expect.objectContaining({ id: "low", isDefault: true }),
      expect.objectContaining({ id: "medium", isDefault: false }),
      expect.objectContaining({ id: "high", isDefault: false }),
    ]);
    expect(grok?.defaultThinkingOptionId).toBe("low");
    expect(composer?.thinkingOptions).toBeUndefined();
    expect(composer?.defaultThinkingOptionId).toBeUndefined();
  });

  test("discovers Grok thinking when the catalog probe starts on Composer", async () => {
    let currentModelId = "composer-2.5";
    const unstableSetSessionModel = vi.fn(async ({ modelId }: { modelId: string }) => {
      currentModelId = modelId;
    });
    const setSessionConfigOption = vi.fn(async () => ({
      configOptions:
        currentModelId === "grok-4.6"
          ? [effortConfigOption("high"), fastConfigOption("true")]
          : [fastConfigOption("true")],
    }));
    const client = createCursorClient(
      {
        sessionId: "session-1",
        models: {
          currentModelId: "composer-2.5",
          availableModels: [
            { modelId: "composer-2.5", name: "Composer 2.5", description: null },
            { modelId: "grok-4.6", name: "Grok 4.6", description: null },
          ],
        },
        configOptions: [fastConfigOption("true")],
      },
      { unstable_setSessionModel: unstableSetSessionModel, setSessionConfigOption },
    );

    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/cursor-composer-first",
      force: false,
    });

    const grok = catalog.models.find((model) => model.id === "grok-4.6");
    const composer = catalog.models.find((model) => model.id === "composer-2.5");
    expect(composer?.thinkingOptions).toBeUndefined();
    expect(grok?.thinkingOptions).toEqual([
      expect.objectContaining({ id: "low", isDefault: false }),
      expect.objectContaining({ id: "medium", isDefault: false }),
      expect.objectContaining({ id: "high", isDefault: true }),
    ]);
    expect(grok?.defaultThinkingOptionId).toBe("high");
  });

  test("does not inherit the previous model's thinking options when a probe fails", async () => {
    const unstableSetSessionModel = vi.fn(async () => {
      throw new Error("probe rejected model switch");
    });
    const client = createCursorClient(
      {
        sessionId: "session-1",
        models: {
          currentModelId: "grok-4.6",
          availableModels: [
            { modelId: "grok-4.6", name: "Grok 4.6", description: null },
            { modelId: "composer-2.5", name: "Composer 2.5", description: null },
          ],
        },
        configOptions: [effortConfigOption("low"), fastConfigOption("true")],
      },
      { unstable_setSessionModel: unstableSetSessionModel },
    );

    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/cursor-probe-error",
      force: false,
    });

    const grok = catalog.models.find((model) => model.id === "grok-4.6");
    const composer = catalog.models.find((model) => model.id === "composer-2.5");
    expect(grok?.thinkingOptions).toEqual([
      expect.objectContaining({ id: "low", isDefault: true }),
      expect.objectContaining({ id: "medium", isDefault: false }),
      expect.objectContaining({ id: "high", isDefault: false }),
    ]);
    expect(composer?.thinkingOptions).toBeUndefined();
  });
});
