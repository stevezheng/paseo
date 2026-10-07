import { describe, expect, it } from "vitest";

import { toWorktreeWireError } from "./worktree-errors.js";

describe("toWorktreeWireError", () => {
  it("preserves the message from a structured provider error", () => {
    const result = toWorktreeWireError({
      error: {
        code: -32603,
        message: "Authentication failed. Run /login to continue.",
      },
    });

    expect(result).toEqual({
      code: "unknown",
      message: "Authentication failed. Run /login to continue.",
    });
    expect(result.message).not.toContain("[object Object]");
  });
});
