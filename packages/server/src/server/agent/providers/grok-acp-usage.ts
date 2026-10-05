import { z } from "zod";
import type { AgentUsage } from "../agent-sdk-types.js";

const GrokResponseUsageSchema = z.object({
  output_tokens: z.number().nonnegative(),
  input_tokens: z.number().nonnegative().optional(),
  cache_read_input_tokens: z.number().nonnegative().optional(),
});

export function parseGrokResponseUsage(usage: unknown): AgentUsage | undefined {
  const parsed = GrokResponseUsageSchema.safeParse(usage);
  if (!parsed.success) return undefined;
  return {
    inputTokens: parsed.data.input_tokens,
    cachedInputTokens: parsed.data.cache_read_input_tokens,
    // Grok already includes reasoning_tokens in output_tokens.
    outputTokens: parsed.data.output_tokens,
  };
}
