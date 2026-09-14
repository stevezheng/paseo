import { describe, expect, it } from "vitest";

import { getErrorMessage, getErrorMessageOr } from "./error-utils.js";

describe("getErrorMessage", () => {
  it("returns Error.message for ordinary errors", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns strings and primitive values as-is", () => {
    expect(getErrorMessage("plain string")).toBe("plain string");
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("reads message from a plain error-shaped object", () => {
    expect(getErrorMessage({ message: "quota exceeded" })).toBe("quota exceeded");
  });

  it("reads nested JSON-RPC error objects instead of [object Object]", () => {
    expect(
      getErrorMessage({
        error: { code: -32000, message: "Authentication failed. Run /login to continue." },
      }),
    ).toBe("Authentication failed. Run /login to continue.");
  });

  it("serializes unstructured objects instead of [object Object]", () => {
    expect(getErrorMessage({ foo: "bar", code: 429 })).toBe('{"foo":"bar","code":429}');
  });

  it("recovers useful text from Error([object Object]) via cause", () => {
    const error = new Error("[object Object]", {
      cause: { message: "Gemini API key is invalid" },
    });
    expect(getErrorMessage(error)).toBe("Gemini API key is invalid");
    expect(getErrorMessage(error)).not.toContain("[object Object]");
  });

  it("does not return [object Object] when the original payload is gone", () => {
    expect(getErrorMessage(new Error("[object Object]"))).toBe("Unknown error");
  });
});

describe("getErrorMessageOr", () => {
  it("returns the extracted message when one exists", () => {
    expect(getErrorMessageOr({ message: "nope" }, "fallback")).toBe("nope");
  });

  it("returns the fallback when the value has no useful message", () => {
    expect(getErrorMessageOr({}, "fallback")).toBe("fallback");
    expect(getErrorMessageOr("[object Object]", "fallback")).toBe("fallback");
  });
});
