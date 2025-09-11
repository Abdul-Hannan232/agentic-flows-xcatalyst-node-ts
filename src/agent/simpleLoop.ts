import { generatePlan } from "../agents/planner";
import { executePlan } from "../agents/specialist";
import { reviewActions } from "../agents/reviewer";


export async function triageTicket(ticket: any) {
  console.log("Planner → generating plan...");
  const plan = await generatePlan(ticket);
  console.log("Plan:", plan);

  console.log("Specialist → executing plan...");
  const actions = await executePlan(plan);
  console.log("Actions:", actions);

  console.log("Reviewer → checking actions...");
  const reviews = await reviewActions(actions);
  console.log("Review Results:", reviews);

  for (const r of reviews) {
    if (!r.approved) {
      console.log("Escalated:", r.reason);
      return { status: "escalated", details: r };
    }
  }

  console.log("All actions approved & executed.");
  return { status: "done", actions };
}
