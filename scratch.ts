// scratch.ts
import { executePlan } from "./src/agents/specialist";
import { reviewActions } from "./src/agents/reviewer";

const mockPlan = {
  goal: "Refund customer $600",
  assumptions: [],
  steps: [
    { tool: "billing.api.getInvoice", args: { refundAmount: 600 } }
  ],
  stopping_conditions: []
};

const run = async () => {
  const actions = await executePlan(mockPlan);
  console.log("Specialist produced actions:", actions);

  const reviews = await reviewActions(actions);
  console.log("Reviewer results:", reviews);
};

run();
