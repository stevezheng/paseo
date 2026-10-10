import { describe, expect, it } from "vitest";
import {
  getFeatureHighlightColor,
  getFeatureTooltip,
  getAgentControlHintKey,
  isFeatureActive,
  normalizeModelId,
  resolveRelativeAgentControlId,
  resolveFavoriteModelCycle,
  favoriteModelsForCycle,
  resolveModelCycleOptions,
  resolveModelCycleBlock,
  resolveAgentModelSelection,
} from "./utils";

describe("resolveRelativeAgentControlId", () => {
  const models = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("cycles to the next option", () => {
    expect(resolveRelativeAgentControlId({ options: models, selectedId: "b", delta: 1 })).toBe("c");
  });

  it("cycles to the previous option", () => {
    expect(resolveRelativeAgentControlId({ options: models, selectedId: "b", delta: -1 })).toBe(
      "a",
    );
  });

  it("wraps in both directions", () => {
    expect(resolveRelativeAgentControlId({ options: models, selectedId: "c", delta: 1 })).toBe("a");
    expect(resolveRelativeAgentControlId({ options: models, selectedId: "a", delta: -1 })).toBe(
      "c",
    );
  });

  it("starts at the nearest end when the selection is stale", () => {
    expect(
      resolveRelativeAgentControlId({ options: models, selectedId: "missing", delta: 1 }),
    ).toBe("a");
    expect(
      resolveRelativeAgentControlId({ options: models, selectedId: "missing", delta: -1 }),
    ).toBe("c");
  });

  it("returns null when there is no second model", () => {
    expect(
      resolveRelativeAgentControlId({ options: [{ id: "a" }], selectedId: "a", delta: 1 }),
    ).toBeNull();
  });
});

describe("favoriteModelsForCycle", () => {
  const profiles = [
    { id: "sol", provider: "codex", model: "gpt-5.6-sol", cycle: true },
    { id: "grok", provider: "grok", model: "grok-4.6", cycle: true },
    { id: "cursor-grok", provider: "cursor", model: "grok-4.6", cycle: true },
    { id: "composer", provider: "cursor", model: "composer-2.5", cycle: true },
    { id: "luna", provider: "codex", model: "gpt-5.6-luna" },
  ];

  it("uses profiles marked cycle: true, ignoring unmarked profiles", () => {
    expect(favoriteModelsForCycle({ stored: [], profiles })).toEqual([
      { provider: "codex", modelId: "gpt-5.6-sol", profileId: "sol" },
      { provider: "grok", modelId: "grok-4.6", profileId: "grok" },
      { provider: "cursor", modelId: "grok-4.6", profileId: "cursor-grok" },
      { provider: "cursor", modelId: "composer-2.5", profileId: "composer" },
    ]);
  });

  it("uses stored favorites when no profile is marked cycle", () => {
    expect(
      favoriteModelsForCycle({
        stored: [{ provider: "grok", modelId: "grok-4.6" }],
        profiles: [{ id: "luna", provider: "codex", model: "gpt-5.6-luna" }],
      }),
    ).toEqual([{ provider: "grok", modelId: "grok-4.6" }]);
  });

  it("skips cycle profiles without a model", () => {
    expect(
      favoriteModelsForCycle({
        stored: undefined,
        profiles: [
          { id: "grok", provider: "grok", cycle: true },
          { id: "composer", provider: "cursor", model: "composer-2.5", cycle: true },
        ],
      }),
    ).toEqual([{ provider: "cursor", modelId: "composer-2.5", profileId: "composer" }]);
  });

  it("keeps two cycle profiles that share a provider and model", () => {
    expect(
      favoriteModelsForCycle({
        stored: undefined,
        profiles: [
          {
            id: "sol-plan",
            name: "Sol plan",
            provider: "codex",
            model: "gpt-5.6-sol",
            cycle: true,
          },
          {
            id: "sol-fast",
            name: "Sol fast",
            provider: "codex",
            model: "gpt-5.6-sol",
            cycle: true,
          },
        ],
      }),
    ).toEqual([
      {
        provider: "codex",
        modelId: "gpt-5.6-sol",
        profileId: "sol-plan",
        name: "Sol plan",
      },
      {
        provider: "codex",
        modelId: "gpt-5.6-sol",
        profileId: "sol-fast",
        name: "Sol fast",
      },
    ]);
  });
});

describe("resolveFavoriteModelCycle", () => {
  const favorites = [
    { provider: "grok", modelId: "grok-4.6" },
    { provider: "cursor", modelId: "grok-4.6" },
    { provider: "cursor", modelId: "composer-2.5" },
    { provider: "codex", modelId: "gpt-5.6-sol" },
  ];

  it("advances across providers on Ctrl+Shift+M", () => {
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: favorites,
        selectedProvider: "grok",
        selectedModelId: "grok-4.6",
        canSwitchProvider: true,
      }),
    ).toEqual({ provider: "cursor", modelId: "grok-4.6" });
  });

  it("keeps the profile identity when cycling to Luna", () => {
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: [
          { provider: "codex", modelId: "gpt-5.6-sol", profileId: "sol" },
          { provider: "codex", modelId: "gpt-5.6-luna", profileId: "luna" },
        ],
        selectedProvider: "codex",
        selectedModelId: "gpt-5.6-sol",
        canSwitchProvider: false,
      }),
    ).toEqual({ provider: "codex", modelId: "gpt-5.6-luna", profileId: "luna" });
  });

  it("advances between same-model profiles from the last cycled profile", () => {
    const sameModel = [
      { provider: "codex", modelId: "gpt-5.6-sol", profileId: "sol-plan", name: "Sol plan" },
      { provider: "codex", modelId: "gpt-5.6-sol", profileId: "sol-fast", name: "Sol fast" },
    ];
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: sameModel,
        selectedProvider: "codex",
        selectedModelId: "gpt-5.6-sol",
        canSwitchProvider: true,
      }),
    ).toEqual(sameModel[1]);
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: sameModel,
        selectedProvider: "codex",
        selectedModelId: "gpt-5.6-sol",
        canSwitchProvider: true,
        selectedProfileId: "sol-fast",
      }),
    ).toEqual(sameModel[0]);
  });

  it("shares the next-favorite path with Ctrl+Shift+.", () => {
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.favorite-model-next",
        favoriteModels: favorites,
        selectedProvider: "cursor",
        selectedModelId: "grok-4.6",
        canSwitchProvider: true,
      }),
    ).toEqual({ provider: "cursor", modelId: "composer-2.5" });
  });

  it("wraps to the first favorite", () => {
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: favorites,
        selectedProvider: "codex",
        selectedModelId: "gpt-5.6-sol",
        canSwitchProvider: true,
      }),
    ).toEqual({ provider: "grok", modelId: "grok-4.6" });
  });

  it("moves backward on Ctrl+Shift+,", () => {
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.favorite-model-previous",
        favoriteModels: favorites,
        selectedProvider: "cursor",
        selectedModelId: "composer-2.5",
        canSwitchProvider: true,
      }),
    ).toEqual({ provider: "cursor", modelId: "grok-4.6" });
  });

  it("stays on the current provider when the session cannot switch", () => {
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: favorites,
        selectedProvider: "cursor",
        selectedModelId: "grok-4.6",
        canSwitchProvider: false,
      }),
    ).toEqual({ provider: "cursor", modelId: "composer-2.5" });
  });

  it("no-ops on a live session with only one favorite for that provider", () => {
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: favorites,
        selectedProvider: "grok",
        selectedModelId: "grok-4.6",
        canSwitchProvider: false,
      }),
    ).toBeNull();
  });

  it("does not substitute the catalog for a provider-locked cycle set", () => {
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: [
          { provider: "grok", modelId: "grok-4.6", profileId: "grok" },
          { provider: "cursor", modelId: "grok-4.6", profileId: "cursor-grok" },
        ],
        selectedProvider: "cursor",
        selectedModelId: "grok-4.6",
        canSwitchProvider: false,
        providerModels: [{ id: "grok-4.6" }, { id: "composer-2.5" }],
      }),
    ).toBeNull();
  });

  it("cycles the provider catalog only when nothing is marked", () => {
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: [],
        selectedProvider: "cursor",
        selectedModelId: "grok-4.6",
        canSwitchProvider: false,
        providerModels: [{ id: "grok-4.6" }, { id: "composer-2.5" }],
      }),
    ).toEqual({ provider: "cursor", modelId: "composer-2.5" });
  });

  it("keeps cross-provider profile cycling when the draft can switch", () => {
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: [
          { provider: "grok", modelId: "grok-4.6", profileId: "grok" },
          { provider: "cursor", modelId: "grok-4.6", profileId: "cursor-grok" },
        ],
        selectedProvider: "grok",
        selectedModelId: "grok-4.6",
        canSwitchProvider: true,
        providerModels: [{ id: "grok-4.6" }, { id: "grok-4" }],
      }),
    ).toEqual({ provider: "cursor", modelId: "grok-4.6", profileId: "cursor-grok" });
  });

  it("no-ops when there are fewer than two favorites", () => {
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: [{ provider: "grok", modelId: "grok-4.6" }],
        selectedProvider: "grok",
        selectedModelId: "grok-4.6",
        canSwitchProvider: true,
      }),
    ).toBeNull();
    expect(
      resolveFavoriteModelCycle({
        actionId: "message-input.model-cycle",
        favoriteModels: [],
        selectedProvider: "grok",
        selectedModelId: "grok-4.6",
        canSwitchProvider: true,
      }),
    ).toBeNull();
  });
});

describe("resolveModelCycleOptions", () => {
  const userCycle = [
    { provider: "grok", modelId: "grok-4.6", profileId: "grok" },
    { provider: "cursor", modelId: "grok-4.6", profileId: "cursor-grok" },
  ];

  it("keeps a provider-locked cycle set instead of substituting the catalog", () => {
    expect(
      resolveModelCycleOptions({
        favoriteModels: userCycle,
        selectedProvider: "cursor",
        canSwitchProvider: false,
        providerModels: [{ id: "grok-4.6" }, { id: "composer-2.5" }],
      }),
    ).toEqual([{ provider: "cursor", modelId: "grok-4.6", profileId: "cursor-grok" }]);
  });

  it("uses the provider catalog only when no cycle or favorite set exists", () => {
    expect(
      resolveModelCycleOptions({
        favoriteModels: [],
        selectedProvider: "cursor",
        canSwitchProvider: false,
        providerModels: [{ id: "grok-4.6" }, { id: "composer-2.5" }],
      }),
    ).toEqual([
      { provider: "cursor", modelId: "grok-4.6" },
      { provider: "cursor", modelId: "composer-2.5" },
    ]);
  });
});

describe("resolveModelCycleBlock", () => {
  it("flags a live session whose cycle set lives on other providers", () => {
    expect(
      resolveModelCycleBlock({
        favoriteModels: [
          { provider: "grok", modelId: "grok-4.6", profileId: "grok" },
          { provider: "cursor", modelId: "grok-4.6", profileId: "cursor-grok" },
        ],
        selectedProvider: "cursor",
        canSwitchProvider: false,
      }),
    ).toBe("provider-locked");
  });

  it("stays quiet when the draft can apply the cycle set", () => {
    expect(
      resolveModelCycleBlock({
        favoriteModels: [
          { provider: "grok", modelId: "grok-4.6", profileId: "grok" },
          { provider: "cursor", modelId: "grok-4.6", profileId: "cursor-grok" },
        ],
        selectedProvider: "cursor",
        canSwitchProvider: true,
      }),
    ).toBeNull();
  });
});

describe("getAgentControlHintKey", () => {
  it("returns translation keys for each editable agent control hint", () => {
    expect(getAgentControlHintKey("thinking")).toBe("agentControls.hints.thinking");
    expect(getAgentControlHintKey("model")).toBe("agentControls.hints.model");
    expect(getAgentControlHintKey("mode")).toBe("agentControls.hints.mode");
  });
});

describe("feature metadata helpers", () => {
  it("prefers explicit feature tooltip copy", () => {
    expect(
      getFeatureTooltip({
        label: "Plan",
        tooltip: "Toggle plan mode",
      }),
    ).toBe("Toggle plan mode");
  });

  it("falls back to the feature label when no tooltip is provided", () => {
    expect(
      getFeatureTooltip({
        label: "Custom",
      }),
    ).toBe("Custom");
  });

  it("maps feature highlight colors by feature id", () => {
    expect(getFeatureHighlightColor("fast_mode")).toBe("yellow");
    expect(getFeatureHighlightColor("service_tier")).toBe("yellow");
    expect(getFeatureHighlightColor("plan_mode")).toBe("blue");
    expect(getFeatureHighlightColor("other")).toBe("default");
  });

  it("treats a select feature as active when a non-default option is selected", () => {
    const speed = {
      type: "select" as const,
      id: "service_tier",
      label: "Speed",
      options: [
        { id: "default", label: "Normal", isDefault: true },
        { id: "fast", label: "Fast" },
      ],
    };
    expect(isFeatureActive({ ...speed, value: "default" })).toBe(false);
    expect(isFeatureActive({ ...speed, value: "fast" })).toBe(true);
    expect(
      isFeatureActive({
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        value: true,
      }),
    ).toBe(true);
  });
});

describe("normalizeModelId", () => {
  it("treats empty values as unset", () => {
    expect(normalizeModelId("")).toBeNull();
    expect(normalizeModelId(undefined)).toBeNull();
  });

  it("returns trimmed model ids", () => {
    expect(normalizeModelId(" gpt-5.1-codex ")).toBe("gpt-5.1-codex");
    expect(normalizeModelId(" default ")).toBe("default");
  });
});

describe("resolveAgentModelSelection", () => {
  it("resolves a configured model alias to its canonical catalog model", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          provider: "claude",
          id: "claude-fable-5",
          aliases: ["claude-fable-5[1m]"],
          label: "Fable 5",
          thinkingOptions: [{ id: "high", label: "High" }],
          defaultThinkingOptionId: "high",
        },
      ],
      runtimeModelId: null,
      configuredModelId: "claude-fable-5[1m]",
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("claude-fable-5");
    expect(selection.displayModel).toBe("Fable 5");
    expect(selection.selectedThinkingId).toBe("high");
  });

  it("prefers runtime model over configured model", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: "b",
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("a");
    expect(selection.displayModel).toBe("Model A");
    expect(selection.selectedThinkingId).toBe("low");
  });

  it("remaps a stale thinking id to the model default instead of the first option", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "grok-4.6",
          provider: "cursor",
          label: "Cursor Grok 4.6",
          thinkingOptions: [
            { id: "false", label: "Off" },
            { id: "true", label: "On", isDefault: true },
          ],
          defaultThinkingOptionId: "true",
        },
      ],
      runtimeModelId: "grok-4.6",
      configuredModelId: "grok-4.6",
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: "high",
    });

    expect(selection.selectedThinkingId).toBe("true");
    expect(selection.displayThinking).toBe("On");
  });

  it("uses explicit thinking option when provided", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: "high",
    });

    expect(selection.selectedThinkingId).toBe("high");
    expect(selection.displayThinking).toBe("High");
  });

  it("shows the thinking level the agent runs on when none was chosen", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "openrouter/google/gemini-3.6-flash",
          provider: "pi",
          label: "Gemini 3.6 Flash",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium", isDefault: true },
            { id: "high", label: "High" },
          ],
          defaultThinkingOptionId: "medium",
        },
      ],
      runtimeModelId: "openrouter/google/gemini-3.6-flash",
      configuredModelId: null,
      runtimeThinkingOptionId: "high",
      explicitThinkingOptionId: null,
    });

    expect(selection.selectedThinkingId).toBe("high");
    expect(selection.displayThinking).toBe("High");
  });

  it("falls back to the chosen thinking level when the runtime level is not a model option", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      runtimeThinkingOptionId: "xhigh",
      explicitThinkingOptionId: "high",
    });

    expect(selection.selectedThinkingId).toBe("high");
  });

  it("formats raw thinking labels in the selected model display", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "claude",
          label: "Model A",
          thinkingOptions: [
            { id: "none", label: "none" },
            { id: "xhigh", label: "xhigh" },
          ],
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: "xhigh",
    });

    expect(selection.selectedThinkingId).toBe("xhigh");
    expect(selection.displayThinking).toBe("Extra high");
  });

  it("falls back to the provider default model label instead of Auto", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          isDefault: true,
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: null,
      configuredModelId: null,
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.displayModel).toBe("Model A");
    expect(selection.displayThinking).toBe("Low");
  });

  it("prefers the configured model when runtime model is not in the model list", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "default",
          provider: "claude",
          label: "Default (Sonnet 4.6)",
          isDefault: true,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
          ],
        },
      ],
      runtimeModelId: "claude-sonnet-4-6-20260101",
      configuredModelId: "default",
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("default");
    expect(selection.displayModel).toBe("Default (Sonnet 4.6)");
    expect(selection.selectedThinkingId).toBe("low");
    expect(selection.displayThinking).toBe("Low");
  });

  it("shows the agent's own model when the catalog does not list it", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "gpt-6-sol",
          provider: "codex",
          label: "GPT-6-Sol",
          isDefault: true,
          thinkingOptions: [
            { id: "medium", label: "medium" },
            { id: "max", label: "max" },
          ],
          defaultThinkingOptionId: "medium",
        },
      ],
      runtimeModelId: "gpt-6.1-sol",
      configuredModelId: "gpt-6.1-sol",
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: "max",
    });

    expect(selection.selectedModel).toBeNull();
    expect(selection.activeModelId).toBe("gpt-6.1-sol");
    expect(selection.displayModel).toBe("gpt-6.1-sol");
    expect(selection.displayThinking).toBe("Max");
  });
});
