import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import type { AgentModelDefinition } from "../agent-sdk-types.js";
import {
  type ACPCatalogModelResolverContext,
  type ACPConfigFeatureOption,
  type SelectConfigOption,
  deriveSelectorOptions,
} from "./acp-agent.js";
import { toDiagnosticErrorMessage } from "./diagnostic-utils.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface CursorACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
}

const CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS = 10_000;
const CURSOR_CLIENT_CAPABILITY_META = {
  parameterizedModelPicker: true,
};

export const CURSOR_FAST_FEATURE_OPTION: ACPConfigFeatureOption = {
  id: "fast",
  configId: "fast",
  label: "Fast",
  description: "Cursor fast mode",
  tooltip: "Select Cursor fast mode",
  icon: "zap",
};

/**
 * Cursor advertises reasoning as a per-model `effort` select, not ACP
 * `thought_level`. Composer 2.5 has Fast and no effort; Grok/Claude expose
 * effort. The catalog probe only sees the current model's options, so without
 * a remap and a per-model refresh every model inherits the probe session
 * (chip hidden when the probe lands on Composer, or a stale `low` default
 * when it lands on Grok).
 *
 * `setSessionModel` does not return `configOptions`. After switching models,
 * no-op `fast` (always present) and read the new model's options. Failures
 * must not inherit the previous model's thinking set.
 */
export function transformCursorConfigOptions(
  configOptions: SessionConfigOption[],
): SessionConfigOption[] {
  return configOptions.map((option) => {
    if (option.type !== "select" || option.id !== "effort") {
      return option;
    }
    return { ...option, category: "thought_level" };
  });
}

export async function resolveCursorCatalogModels({
  connection,
  sessionId,
  models,
  configOptions,
  runRequest,
  transformConfigOptions,
  logger,
  provider,
}: ACPCatalogModelResolverContext): Promise<AgentModelDefinition[]> {
  if (models.length <= 1) {
    return models;
  }

  const currentModelId = models.find((model) => model.isDefault)?.id;
  let latestConfigOptions = transformConfigOptions(configOptions ?? []);
  const resolved: AgentModelDefinition[] = [];

  for (const model of models) {
    if (model.id === currentModelId) {
      resolved.push(attachCursorThinking(model, latestConfigOptions));
      continue;
    }

    try {
      if (typeof connection.unstable_setSessionModel !== "function") {
        resolved.push(clearCursorThinking(model));
        continue;
      }

      await runRequest(() =>
        connection.unstable_setSessionModel({
          sessionId,
          modelId: model.id,
        }),
      );

      const refreshOption = findCursorConfigRefreshOption(latestConfigOptions);
      if (!refreshOption) {
        resolved.push(clearCursorThinking(model));
        continue;
      }

      const response = await runRequest(() =>
        connection.setSessionConfigOption({
          sessionId,
          configId: refreshOption.id,
          value: refreshOption.currentValue,
        }),
      );
      latestConfigOptions = transformConfigOptions(response.configOptions ?? []);
      resolved.push(attachCursorThinking(clearCursorThinking(model), latestConfigOptions));
    } catch (error) {
      logger.warn(
        { modelId: model.id, error: toDiagnosticErrorMessage(error) },
        `${provider} catalog probe could not resolve thinking options for model "${model.id}"; omitting thinking options`,
      );
      resolved.push(clearCursorThinking(model));
    }
  }

  return resolved;
}

function attachCursorThinking(
  model: AgentModelDefinition,
  configOptions: SessionConfigOption[],
): AgentModelDefinition {
  const thinkingOptions = deriveSelectorOptions(configOptions, "thought_level");
  return {
    ...model,
    thinkingOptions: thinkingOptions.length > 0 ? thinkingOptions : undefined,
    defaultThinkingOptionId: thinkingOptions.find((option) => option.isDefault)?.id ?? undefined,
  };
}

function clearCursorThinking(model: AgentModelDefinition): AgentModelDefinition {
  return {
    ...model,
    thinkingOptions: undefined,
    defaultThinkingOptionId: undefined,
  };
}

function findCursorConfigRefreshOption(
  configOptions: SessionConfigOption[],
): SelectConfigOption | null {
  const preferred = configOptions.find(
    (entry): entry is SelectConfigOption => entry.type === "select" && entry.id === "fast",
  );
  if (preferred) {
    return preferred;
  }
  return (
    configOptions.find(
      (entry): entry is SelectConfigOption =>
        entry.type === "select" && entry.category !== "thought_level" && entry.category !== "model",
    ) ?? null
  );
}

export class CursorACPAgentClient extends GenericACPAgentClient {
  constructor(options: CursorACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      providerParams: options.providerParams,
      // cursor-agent publishes slash commands asynchronously via available_commands_update.
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS,
      clientCapabilityMeta: CURSOR_CLIENT_CAPABILITY_META,
      configFeatureOptions: [CURSOR_FAST_FEATURE_OPTION],
      configOptionsTransformer: transformCursorConfigOptions,
      catalogModelResolver: resolveCursorCatalogModels,
    });
  }
}
