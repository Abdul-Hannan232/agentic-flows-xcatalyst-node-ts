import { describe, it, expect } from "vitest";
import { execute } from "../src/agent/loop.js";

describe("budget guardrail", () => {
  it("escalates when over budget", async () => {
    const plan = { goal: "test", assumptions: [], steps: Array(20).fill("unknownTool {}"), stopping_conditions: [] };
    const result = await execute(plan as any, { budget: 3 });
    expect(result.status).toBe("escalated");
  });
});
