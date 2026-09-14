const INVALID_PARAMS_CODE = -32602;

const NEVER_OMIT_ACP_PARAM_KEYS = new Set([
  "sessionId",
  "prompt",
  "cwd",
  "mcpServers",
  "protocolVersion",
  "clientCapabilities",
  "clientInfo",
  "modeId",
  "configId",
  "value",
  "modelId",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readErrorCode(error: unknown): number | null {
  if (!isRecord(error) || typeof error.code !== "number") {
    return null;
  }
  return error.code;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return "";
}

function collectUnrecognizedKeysFromValue(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectUnrecognizedKeysFromValue(entry, keys);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (value.code === "unrecognized_keys" && Array.isArray(value.keys)) {
    for (const key of value.keys) {
      if (typeof key === "string" && key.trim()) {
        keys.add(key);
      }
    }
  }
  for (const nested of Object.values(value)) {
    collectUnrecognizedKeysFromValue(nested, keys);
  }
}

function collectUnrecognizedKeysFromMessage(message: string, keys: Set<string>): void {
  for (const match of message.matchAll(/unknown field [`'"]?([A-Za-z_][\w]*)[`'"]?/gi)) {
    if (match[1]) keys.add(match[1]);
  }
  for (const match of message.matchAll(/unrecognized keys?: ([^.]+)/gi)) {
    const listed = match[1];
    if (!listed) continue;
    for (const key of listed.matchAll(/[A-Za-z_][\w]*/g)) {
      keys.add(key[0]);
    }
  }
  for (const match of message.matchAll(/'([A-Za-z_][\w]*)' was unexpected/gi)) {
    if (match[1]) keys.add(match[1]);
  }
}

export function isAcpInvalidParamsError(error: unknown): boolean {
  const code = readErrorCode(error);
  if (code === INVALID_PARAMS_CODE) {
    return true;
  }
  return /invalid params/i.test(readErrorMessage(error));
}

export function extractUnrecognizedAcpParamKeys(error: unknown): string[] {
  const keys = new Set<string>();
  collectUnrecognizedKeysFromMessage(readErrorMessage(error), keys);
  if (isRecord(error)) {
    collectUnrecognizedKeysFromValue(error.data, keys);
  }
  return [...keys].filter((key) => !NEVER_OMIT_ACP_PARAM_KEYS.has(key));
}

export function omitAcpRequestParams<T extends Record<string, unknown>>(
  params: T,
  keys: Iterable<string>,
): T {
  const omit = new Set(keys);
  if (omit.size === 0) {
    return params;
  }
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!omit.has(key)) {
      next[key] = value;
    }
  }
  return next as T;
}

function sameParamKeys(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => key in right);
}

export function nextAcpRequestParams<T extends Record<string, unknown>>(
  params: T,
  error: unknown,
): T | null {
  if (!isAcpInvalidParamsError(error)) {
    return null;
  }
  const keys = new Set(extractUnrecognizedAcpParamKeys(error));
  if (keys.size === 0 && "messageId" in params) {
    keys.add("messageId");
  }
  if (keys.size === 0) {
    return null;
  }
  const next = omitAcpRequestParams(params, keys);
  return sameParamKeys(params, next) ? null : next;
}

export async function callAcpWithParamCompat<TParams extends Record<string, unknown>, TResult>(
  send: (params: TParams) => Promise<TResult>,
  params: TParams,
  omittedKeys: Set<string>,
  onRetry?: (keys: string[]) => void,
): Promise<TResult> {
  const first = omitAcpRequestParams(params, omittedKeys);
  try {
    return await send(first);
  } catch (error) {
    const retry = nextAcpRequestParams(first, error);
    if (!retry) {
      throw error;
    }
    const dropped: string[] = [];
    for (const key of Object.keys(first)) {
      if (!(key in retry)) {
        omittedKeys.add(key);
        dropped.push(key);
      }
    }
    onRetry?.(dropped);
    return await send(retry);
  }
}
