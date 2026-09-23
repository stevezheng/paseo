import { describe, expect, it } from "vitest";

import { toErrorMessage } from "./error-messages";

describe("toErrorMessage", () => {
  it("shows object errors as readable text instead of [object Object]", () => {
    expect(toErrorMessage({ message: "Gemini quota exceeded" })).toBe("Gemini quota exceeded");
    expect(
      toErrorMessage({
        error: { code: -32603, message: "Authentication failed. Run /login to continue." },
      }),
    ).toBe("Authentication failed. Run /login to continue.");
    expect(toErrorMessage({ foo: "bar" })).toBe('{"foo":"bar"}');
    expect(toErrorMessage({ foo: "bar" })).not.toContain("[object Object]");
  });
});
