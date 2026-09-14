const USELESS_MESSAGES = new Set(["", "[object Object]"]);
const MESSAGE_KEYS = [
  "message",
  "errorMessage",
  "error",
  "details",
  "detail",
  "reason",
  "description",
  "title",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUsefulText(value: string): boolean {
  return !USELESS_MESSAGES.has(value.trim());
}

function serializeUnknown(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value);
    if (serialized && serialized !== "{}" && serialized !== "[]" && serialized !== '""') {
      return serialized;
    }
  } catch {
    // circular or otherwise unserializable
  }
  return null;
}

function extractFromRecord(record: Record<string, unknown>, seen: WeakSet<object>): string | null {
  if (seen.has(record)) {
    return null;
  }
  seen.add(record);

  for (const key of MESSAGE_KEYS) {
    const nested = extractErrorMessage(record[key], seen);
    if (nested) {
      return nested;
    }
  }

  return serializeUnknown(record);
}

function extractErrorMessage(error: unknown, seen: WeakSet<object>): string | null {
  if (typeof error === "string") {
    const trimmed = error.trim();
    return isUsefulText(trimmed) ? trimmed : null;
  }

  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }

  if (error instanceof Error) {
    if (isUsefulText(error.message)) {
      return error.message;
    }
    if (error.cause !== undefined) {
      const cause = extractErrorMessage(error.cause, seen);
      if (cause) {
        return cause;
      }
    }
    return extractFromRecord(error as unknown as Record<string, unknown>, seen);
  }

  if (Array.isArray(error)) {
    return serializeUnknown(error);
  }

  if (isRecord(error)) {
    return extractFromRecord(error, seen);
  }

  return null;
}

/**
 * Extracts a human-readable error message from an unknown error value.
 * Handles Error instances, string errors, and other types safely.
 */
export function getErrorMessage(error: unknown): string {
  const extracted = extractErrorMessage(error, new WeakSet<object>());
  if (extracted) {
    return extracted;
  }
  if (error instanceof Error) {
    return isUsefulText(error.message) ? error.message : "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error === null || error === undefined) {
    return String(error);
  }
  return "Unknown error";
}

/**
 * Extracts an error message from an unknown error value, with a fallback
 * for when no message can be extracted.
 */
export function getErrorMessageOr(error: unknown, fallback: string): string {
  const extracted = extractErrorMessage(error, new WeakSet<object>());
  if (extracted) {
    return extracted;
  }
  if (error instanceof Error) {
    return isUsefulText(error.message) ? error.message : fallback;
  }
  return fallback;
}
