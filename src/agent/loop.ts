

import { OpenAI } from "openai";
import { Plan, RunResult, ExecContext } from "./types.js";
import { registry, invokeTool } from "./toolRegistry.js"; // extracted helper for registry (optional)
import { sanitizePlan } from "./planUtils.js"; // simple in-file fallback sanitizer

export async function runOrchestration(
  openai: OpenAI | undefined,
  ticket: any,
  ctx: ExecContext = {}
): Promise<RunResult> {
  const maxIterations = ctx.reflection_maxIterations ?? 2;
  const aggregateObservations: any[] = [];
  let iteration = 0;
  let currentTicket = ticket;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`Orchestrator iteration ${iteration}/${maxIterations}`);

    // 1️⃣ Planner
    let planObj: Plan;
    try {
      const plannerModule = await import("../agents/planner.js").catch(() => undefined);
      if (plannerModule?.generatePlan) {
        planObj = await (plannerModule.generatePlan(openai, currentTicket) ?? plannerModule.generatePlan(currentTicket));
      } else {
        if (!openai) throw new Error("No planner agent and no OpenAI client provided");
        const { plan } = await import("./legacyPlan.js"); // optional in-file fallback
        planObj = await plan(openai, currentTicket);
      }
      planObj = sanitizePlan(planObj);
      console.log(`Planner produced plan with ${planObj.steps.length} steps`);
    } catch (err: any) {
      console.error("Planner failed:", err?.message ?? err);
      if (registry["escalate.toHuman"]) {
        const escData = await invokeTool("escalate.toHuman", { ticket_id: ticket?.id ?? "unknown", reason: `planner_error: ${err?.message}` }, ctx);
        aggregateObservations.push({ tool: "escalate.toHuman", ok: true, data: escData });
      }
      return { status: "escalated", observations: aggregateObservations, details: { plannerError: String(err?.message ?? err) } };
    }

    // 2️⃣ Specialist
    let specialistOutcome;
    try {
      const specialistModule = await import("../agents/specialist.js").catch(() => undefined);
      if (specialistModule?.executePlan) {
        specialistOutcome = await specialistModule.executePlan(planObj, { invokeTool });
      } else {
        const { execute } = await import("./legacyExecute.js"); // fallback in-file executor
        specialistOutcome = { type: "observations", value: (await execute(planObj, ctx)).observations };
      }
    } catch (err: any) {
      console.error("Specialist failed:", err?.message ?? err);
      aggregateObservations.push({ tool: "specialist", ok: false, error: String(err?.message ?? err) });
      continue; // attempt re-plan
    }

    if (specialistOutcome.type === "observations") {
      aggregateObservations.push(...specialistOutcome.value);
    }

    // 3️⃣ Reviewer
    try {
      const reviewerModule = await import("../agents/reviewer.js").catch(() => undefined);
      let reviewResults: any[] = [];

      if (reviewerModule?.reviewActions) {
        const actions = specialistOutcome.value ?? [];
        reviewResults = await reviewerModule.reviewActions(actions);
      } else {
        // simple fallback: approve everything
        reviewResults = (specialistOutcome.value ?? []).map((a: any) => ({ approved: true, action: a }));
      }

      // handle escalation requests from reviewer
      const esc = reviewResults.find(r => r.escalate || (r.approved === false && /escalat/i.test(String(r.reason))));
      if (esc && registry["escalate.toHuman"]) {
        const escData = await invokeTool("escalate.toHuman", { ticket_id: ticket?.id ?? "unknown", reason: esc.reason, original_action: esc.action }, ctx);
        aggregateObservations.push({ tool: "escalate.toHuman", ok: true, data: escData });
        return { status: "escalated", observations: aggregateObservations, details: { reviewer: esc } };
      }

      // if all actions approved -> check stopping conditions
      const blob = JSON.stringify(aggregateObservations).toLowerCase();
      const stops = planObj.stopping_conditions || [];
      const allSatisfied = stops.length === 0 ? false : stops.every(c => blob.includes(String(c).toLowerCase()));
      if (allSatisfied) return { status: "resolved", observations: aggregateObservations };

      // prepare ticket with feedback for next iteration
      const rejected = reviewResults.find(r => r.approved === false);
      if (rejected) {
        currentTicket = { ...ticket, __reviewerFeedback: rejected.reason, __lastPlan: planObj, __observations: aggregateObservations };
        continue; // re-plan
      }

    } catch (err: any) {
      console.error("Reviewer failed:", err?.message ?? err);
      continue; // re-plan
    }
  }

  return { status: "incomplete", observations: aggregateObservations, details: { reason: "max_iterations_reached" } };
}
