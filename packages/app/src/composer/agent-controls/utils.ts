import type { AgentFeature, AgentModelDefinition } from "@getpaseo/protocol/agent-types";
import { i18n } from "@/i18n/i18next";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import { FAST_MODE_FEATURE_ID, PLAN_MODE_FEATURE_ID } from "@/agent-controls/policy";

export type ExplainedAgentControl = "mode" | "model" | "thinking";
export type FeatureHighlightColor = "blue" | "default" | "green" | "yellow";
export type AgentControlHintKey =
  | "agentControls.hints.thinking"
  | "agentControls.hints.model"
  | "agentControls.hints.mode";

export function getAgentControlHintKey(selector: ExplainedAgentControl): AgentControlHintKey {
  switch (selector) {
    case "thinking":
      return "agentControls.hints.thinking";
    case "model":
      return "agentControls.hints.model";
    case "mode":
      return "agentControls.hints.mode";
    default:
      throw new Error("unreachable");
  }
}

export function normalizeModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  if (!normalized) {
    return null;
  }
  return normalized;
}

export function resolveRelativeAgentControlId({
  options,
  selectedId,
  delta,
}: {
  options: readonly { id: string }[];
  selectedId: string | null | undefined;
  delta: 1 | -1;
}): string | null {
  if (options.length < 2) return null;

  const selectedIndex = options.findIndex((option) => option.id === selectedId);
  if (selectedIndex < 0) {
    return options[delta > 0 ? 0 : options.length - 1]?.id ?? null;
  }

  const nextIndex = (selectedIndex + delta + options.length) % options.length;
  return options[nextIndex]?.id ?? null;
}

export interface FavoriteModelRef {
  provider: string;
  modelId: string;
  profileId?: string;
}

function favoriteModelKey(entry: FavoriteModelRef): string {
  return `${entry.provider}:${entry.modelId}`;
}

/** Profiles with `cycle: true` win. Then client leftovers. */
export function favoriteModelsForCycle(input: {
  stored: readonly FavoriteModelRef[] | undefined;
  profiles: readonly { id: string; provider: string; model?: string; cycle?: boolean }[] | null;
}): FavoriteModelRef[] {
  const cycled: FavoriteModelRef[] = [];
  const seen = new Set<string>();
  for (const profile of input.profiles ?? []) {
    if (profile.cycle !== true) {
      continue;
    }
    const modelId = profile.model?.trim() ?? "";
    if (!modelId) {
      continue;
    }
    const entry = { provider: profile.provider, modelId, profileId: profile.id };
    const key = favoriteModelKey(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    cycled.push(entry);
  }
  if (cycled.length > 0) {
    return cycled;
  }
  if (input.stored && input.stored.length > 0) {
    return [...input.stored];
  }
  return [];
}

function favoriteModelCycleDelta(actionId: string): 1 | -1 | null {
  if (actionId === "message-input.favorite-model-previous") {
    return -1;
  }
  if (
    actionId === "message-input.favorite-model-next" ||
    actionId === "message-input.model-cycle"
  ) {
    return 1;
  }
  return null;
}

/** Ctrl+Shift+M cycles marked profiles, falling back to legacy favorite models. */
export function resolveFavoriteModelCycle({
  actionId,
  favoriteModels,
  selectedProvider,
  selectedModelId,
  canSwitchProvider,
}: {
  actionId: string;
  favoriteModels: readonly FavoriteModelRef[];
  selectedProvider: string;
  selectedModelId: string | null | undefined;
  canSwitchProvider: boolean;
}): FavoriteModelRef | null {
  const delta = favoriteModelCycleDelta(actionId);
  if (delta === null) {
    return null;
  }
  const options = canSwitchProvider
    ? favoriteModels
    : favoriteModels.filter((entry) => entry.provider === selectedProvider);
  const nextId = resolveRelativeAgentControlId({
    options: options.map((entry) => ({ id: favoriteModelKey(entry) })),
    selectedId: favoriteModelKey({
      provider: selectedProvider,
      modelId: selectedModelId ?? "",
    }),
    delta,
  });
  if (nextId === null) {
    return null;
  }
  return options.find((entry) => favoriteModelKey(entry) === nextId) ?? null;
}

export function getFeatureTooltip(feature: Pick<AgentFeature, "label" | "tooltip">): string {
  return feature.tooltip ?? feature.label;
}

export function getFeatureHighlightColor(featureId: string): FeatureHighlightColor {
  switch (featureId) {
    case FAST_MODE_FEATURE_ID:
      return "yellow";
    case "auto_accept":
      return "green";
    case PLAN_MODE_FEATURE_ID:
      return "blue";
    default:
      return "default";
  }
}

function findModelById(
  models: AgentModelDefinition[] | null,
  modelId: string | null,
): AgentModelDefinition | null {
  if (!models || !modelId) {
    return null;
  }
  return (
    models.find((model) => model.id === modelId) ??
    models.find((model) => model.aliases?.includes(modelId)) ??
    null
  );
}

function getFallbackModel(models: AgentModelDefinition[] | null): AgentModelDefinition | null {
  return models?.find((model) => model.isDefault) ?? models?.[0] ?? null;
}

function resolvePreferredModelId(
  runtimeSelectedModel: AgentModelDefinition | null,
  normalizedConfiguredModelId: string | null,
  normalizedRuntimeModelId: string | null,
): string | null {
  return runtimeSelectedModel?.id ?? normalizedConfiguredModelId ?? normalizedRuntimeModelId;
}

function pickSelectedModel(
  models: AgentModelDefinition[] | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
): AgentModelDefinition | null {
  if (!models || !preferredModelId) {
    return fallbackModel;
  }
  return findModelById(models, preferredModelId) ?? fallbackModel;
}

function resolveThinkingId(
  explicitThinkingOptionId: string | null | undefined,
  selectedModel: AgentModelDefinition | null,
): string | null {
  if (explicitThinkingOptionId && explicitThinkingOptionId !== "default") {
    return explicitThinkingOptionId;
  }
  return selectedModel?.defaultThinkingOptionId ?? null;
}

type ThinkingOption = NonNullable<AgentModelDefinition["thinkingOptions"]>[number];

function resolveEffectiveThinking(
  thinkingOptions: ThinkingOption[] | null,
  resolvedThinkingId: string | null,
): ThinkingOption | null {
  const selectedThinking =
    thinkingOptions?.find((option) => option.id === resolvedThinkingId) ?? null;
  return selectedThinking ?? thinkingOptions?.[0] ?? null;
}

function resolveModelDisplay(
  selectedModel: AgentModelDefinition | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
  unknownModelLabel: string,
): { activeModelId: string | null; displayModel: string } {
  return {
    activeModelId: selectedModel?.id ?? preferredModelId ?? null,
    displayModel:
      selectedModel?.label ?? preferredModelId ?? fallbackModel?.label ?? unknownModelLabel,
  };
}

function resolveThinkingDisplay(
  effectiveThinking: ThinkingOption | null,
  selectedThinkingId: string | null,
  unknownThinkingLabel: string,
): string {
  if (effectiveThinking) {
    return formatThinkingOptionLabel(effectiveThinking);
  }

  if (selectedThinkingId) {
    return formatThinkingOptionLabel({ id: selectedThinkingId });
  }

  return unknownThinkingLabel;
}

export function resolveAgentModelSelection(input: {
  models: AgentModelDefinition[] | null;
  runtimeModelId: string | null | undefined;
  configuredModelId: string | null | undefined;
  explicitThinkingOptionId: string | null | undefined;
}) {
  const { models, runtimeModelId, configuredModelId, explicitThinkingOptionId } = input;
  const normalizedRuntimeModelId = normalizeModelId(runtimeModelId);
  const normalizedConfiguredModelId = normalizeModelId(configuredModelId);

  const runtimeSelectedModel = findModelById(models, normalizedRuntimeModelId);
  const preferredModelId = resolvePreferredModelId(
    runtimeSelectedModel,
    normalizedConfiguredModelId,
    normalizedRuntimeModelId,
  );
  const fallbackModel = getFallbackModel(models);
  const selectedModel = pickSelectedModel(models, preferredModelId, fallbackModel);

  const { activeModelId, displayModel } = resolveModelDisplay(
    selectedModel,
    preferredModelId,
    fallbackModel,
    i18n.t("agentControls.model.unknown"),
  );

  const thinkingOptions = selectedModel?.thinkingOptions ?? null;
  const resolvedThinkingId = resolveThinkingId(explicitThinkingOptionId, selectedModel);
  const effectiveThinking = resolveEffectiveThinking(thinkingOptions, resolvedThinkingId);
  const selectedThinkingId = effectiveThinking?.id ?? null;
  const displayThinking = resolveThinkingDisplay(
    effectiveThinking,
    selectedThinkingId,
    i18n.t("agentControls.thinking.unknown"),
  );

  return {
    selectedModel,
    activeModelId,
    displayModel,
    thinkingOptions,
    selectedThinkingId,
    displayThinking,
  };
}
