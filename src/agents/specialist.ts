// src/agents/specialist.ts
import { Plan } from "../agent/types.js";

export interface Action {
  type: string;      
  amount?: number;
  reason?: string;
}

export async function executePlan(plan: Plan): Promise<Action[]> {
  const actions: Action[] = [];

  for (const step of plan.steps) {
    if (step.tool === "billing.api.getInvoice" && step.args?.refundAmount) {
      actions.push({ type: "refund", amount: step.args.refundAmount, reason: "Requested in ticket" });
    } else if (step.tool === "escalate.toHuman") {
      actions.push({ type: "escalate", reason: step.args?.reason ?? "High risk case" });
    } else {
      actions.push({ type: "respond", reason: `Executed ${step.tool}` });
    }
  }

  return actions;
}
