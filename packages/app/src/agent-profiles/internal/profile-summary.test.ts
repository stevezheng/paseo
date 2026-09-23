import { describe, expect, it } from "vitest";
import { buildAgentProfileTags } from "./profile-summary";

describe("buildAgentProfileTags", () => {
  it("appends the cycle tag only when the profile is in the shortcut set", () => {
    const withoutCycle = buildAgentProfileTags({
      profile: { id: "sol", name: "Sol", provider: "codex", model: "gpt-5.6-sol" },
      entries: undefined,
      formatFeatureCount: (count) => `${count} features`,
      cycleLabel: "Ctrl+Shift+M",
    });
    expect(withoutCycle.map((tag) => tag.id)).toEqual(["provider", "model"]);

    const withCycle = buildAgentProfileTags({
      profile: {
        id: "sol",
        name: "Sol",
        provider: "codex",
        model: "gpt-5.6-sol",
        cycle: true,
      },
      entries: undefined,
      formatFeatureCount: (count) => `${count} features`,
      cycleLabel: "Ctrl+Shift+M",
    });
    expect(withCycle.map((tag) => tag.id)).toEqual(["provider", "model", "cycle"]);
    expect(withCycle.at(-1)?.label).toBe("Ctrl+Shift+M");
  });
});
