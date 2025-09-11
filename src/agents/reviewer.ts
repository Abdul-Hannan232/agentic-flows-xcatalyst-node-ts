// src/agents/reviewer.ts
import { Action } from "./specialist";

export interface ReviewResult {
  approved: boolean;
  action: Action;
  reason: string;
}

export async function reviewActions(actions: Action[]): Promise<ReviewResult[]> {
  return actions.map(action => {
    if (action.type === "refund" && action.amount && action.amount > 500) {
      return {
        approved: false,
        action,
        reason: `Refund of $${action.amount} exceeds $500 limit. Escalating.`
      };
    }
    return { approved: true, action, reason: "Safe to execute." };
  });
}
