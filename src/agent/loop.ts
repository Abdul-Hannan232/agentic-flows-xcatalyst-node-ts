import { OpenAI } from "openai";
import { Plan, PlanSchema, RunResult, ExecContext } from "./types.js";
import {
    initShortMemory,
    getShortMemory,
    pushObservation,
    pushAssumption,
    getFacts,
    resetShortMemory,
  } from "../memory/short";
  



const allowedTools = [
  "kb.retrieve",

  "billing.api.getInvoice",
  "billing.listInvoices",
  "billing.getUsage",

  "issues.api.create",
  "issues.listIssues",
  "issues.getIssues",

  "status.api.get",

  "email.draftReply",
  "escalate.toHuman",

  "cases.query",
];

const TOOL_DESCRIPTIONS: Record<string, string> = {
  "kb.retrieve":
    "Search the local knowledge base; args: { query: string, top_k?: number }",
  "billing.api.getInvoice":
    "Retrieve invoice details; args: { customer_email: string, month: string }",
  "billing.listInvoices":
    "List invoices; args: { customer?: string }",
  "billing.getUsage":
    "Return customer's usage stats; args: { customer: string }",
  "issues.api.create":
    "Create an issue/incident; args: { ticket_id: string, description: string }",
  "issues.listIssues":
    "List issues (optionally by customer); args: { customer?: string }",
  "issues.getIssues": "List issues for a customer; args: { customer: string }",
  "status.api.get": "Get system/service status; args: { ticket_id?: string }",
  "email.draftReply":
    "Draft a reply email; args: { to: string, subject?: string, body?: string }",
  "escalate.toHuman":
    "Escalate the ticket to a human queue; args: { ticket_id: string, reason: string }",
  "cases.query":
    "Query previous resolved cases; args: { query: string, top_k?: number }",

};

const aliasMap: Record<string, string> = {
  "monitoring.api.getSystemStatus": "status.api.get",
  "logs.api.getLogs": "issues.listIssues",
  "incident.api.createIncident": "issues.api.create",
  "billing.api.compareInvoiceToContract": "billing.listInvoices",
  "billing.api.correctInvoice": "billing.listInvoices",
};

function sanitizePlan(plan: any): any {
  if (!plan || !Array.isArray(plan.steps)) return plan;

  const seen = new Set<string>();
  const cleaned: any[] = [];

  for (const step of plan.steps) {
    if (!step || typeof step !== "object") {
      cleaned.push({
        tool: "escalate.toHuman",
        args: {
          ticket_id: plan.ticket_id ?? "unknown",
          reason: "malformed_step",
        },
      });
      continue;
    }

    const origTool = String(step.tool ?? "");
    let tool = origTool;

    if (aliasMap[origTool]) {
      tool = aliasMap[origTool];
    }

    if (!allowedTools.includes(tool)) {
      console.warn(
        `Planner suggested unknown tool: ${tool}. Escalating...`
      );
      cleaned.push({
        tool: "escalate.toHuman",
        args: {
          ticket_id: plan.ticket_id ?? "unknown",
          reason: `Unrecognized tool: ${origTool}`,
        },
      });
      continue;
    }

    const args = step.args ?? {};

    let key: string;
    try {
      key = `${tool}::${JSON.stringify(args)}`;
    } catch {
      key = `${tool}::[unserializable_args]`;
    }
    if (seen.has(key)) {
      // skip duplicate
      continue;
    }
    seen.add(key);

    cleaned.push({ tool, args });
  }

  plan.steps = cleaned;
  return plan;
}

export async function plan(openai: OpenAI, ticket: unknown): Promise<Plan> {
    const toolList = Object.entries(TOOL_DESCRIPTIONS)
      .map(([name, desc]) => `- ${name}: ${desc}`)
      .join("\n");
  
    // include short-term memory facts if present
    const facts = (getFacts() || []).slice(0, 20).join("\n");
  
    const sys = `
  You are a triage planner.
  You MUST return ONLY valid JSON that matches this shape:
  
  {
    "goal": string,
    "assumptions": string[],
    "steps": [ { "tool": string, "args": object } ],
    "stopping_conditions": string[]
  }
  
  IMPORTANT:
  - You may ONLY use exactly the tool names listed below. Do NOT invent new tool names.
  - If you are unsure, use "escalate.toHuman".
  - Output valid JSON only (no extra text).
  
  Available tools:
  ${toolList}
  `;
  
    const user = `Ticket: ${JSON.stringify(ticket)}
  Short-term-memory-facts (may help planning):
  ${facts || "<none>"}
  `;
  
    const resp = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0,
    });
  
    const text = resp.choices?.[0]?.message?.content ?? "{}";
    let raw: any;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error("Planner did not return valid JSON");
    }
  
    const safe = sanitizePlan(raw);
  
    // push assumptions into short-term memory if any
    if (Array.isArray(safe.assumptions)) {
      for (const a of safe.assumptions) {
        try {
          pushAssumption(String(a));
        } catch {
          /* no-op */
        }
      }
    }
  
    return PlanSchema.parse(safe);
  }
  

type ToolFn = (args: any, ctx: ExecContext) => Promise<any>;
const registry: Record<string, ToolFn> = {};

export function registerTool(name: string, fn: ToolFn) {
  registry[name] = fn;
}

export async function execute(
    p: Plan,
    ctx: ExecContext = {}
  ): Promise<RunResult> {
    const observations: any[] = [];
    let budget = typeof ctx.budget === "number" ? ctx.budget! : 8;
    const maxIterations =
      typeof ctx.max_iterations === "number" ? ctx.max_iterations! : 3;
  
    const succeededSteps = new Set<string>();
  
    function stepKey(toolName: string, args: any) {
      try {
        return `${toolName}::${JSON.stringify(args ?? {})}`;
      } catch {
        return `${toolName}::[unserializable_args]`;
      }
    }
  
    function checkStopping(
      conditions: string[] | undefined,
      observationsList: any[]
    ): boolean {
      if (!conditions || conditions.length === 0) return false;
      const blob = JSON.stringify(observationsList).toLowerCase();
      for (const cond of conditions) {
        if (!cond) continue;
        const small = cond.toLowerCase();
        if (blob.includes(small)) return true;
        if (/(issue|created|logged|assigned)/.test(small)) {
          const anyIssueCreated = observationsList.some(
            (o: any) => o.ok && o.data && (o.data.id || o.data.issue_id)
          );
          if (anyIssueCreated) return true;
        }
        if (/(escalat)/.test(small)) {
          const anyEsc = observationsList.some(
            (o: any) => o.tool === "escalate.toHuman" && o.ok && o.data?.escalated
          );
          if (anyEsc) return true;
        }
        if (/(confirmed|correct|corrected|matching|matches)/.test(small)) {
          const anyBilling = observationsList.some(
            (o: any) =>
              o.tool?.startsWith("billing") && o.ok && o.data && "total" in o.data
          );
          if (anyBilling) return true;
        }
      }
      return false;
    }
  
    for (let iter = 0; iter < maxIterations; iter++) {
      if (budget <= 0) {
        return { status: "escalated", details: "budget_exhausted", observations };
      }
  
      for (const step of p.steps) {
        if (budget-- <= 0) {
          return {
            status: "escalated",
            details: "budget_exhausted",
            observations,
          };
        }
  
        if (!step || typeof step !== "object") {
          const obs = {
            tool: String(step),
            ok: false,
            error: "invalid_step_format",
          };
          observations.push(obs);
          try { pushObservation(-1, obs.tool, {}, obs); } catch {}
          console.log(
            JSON.stringify(
              { thought: step, tool: obs.tool, args: {}, observation: obs, retries: 0 },
              null,
              2
            )
          );
          continue;
        }
  
        const toolName: string = step.tool;
        const args = step.args ?? {};
        const key = stepKey(toolName, args);
  
        if (succeededSteps.has(key)) {
          const obs = {
            tool: toolName,
            ok: true,
            data: { note: "skipped-duplicate-success" },
          };
          observations.push(obs);
          try { pushObservation(iter, toolName, args, obs); } catch {}
          console.log(
            JSON.stringify({ thought: step, tool: toolName, args, observation: obs, retries: 0 }, null, 2)
          );
          continue;
        }
  
        const fn = registry[toolName];
        if (!fn) {
          const obs = { tool: toolName, ok: false, error: "tool_not_found" };
          observations.push(obs);
          try { pushObservation(iter, toolName, args, obs); } catch {}
          console.log(
            JSON.stringify({ thought: step, tool: toolName, args, observation: obs, retries: 0 }, null, 2)
          );
          continue;
        }
  
        // retries + exponential backoff
        const maxRetries = 2;
        let retries = 0;
        let succeeded = false;
  
        while (retries <= maxRetries) {
          try {
            const data = await fn(args, ctx);
            const obs = { tool: toolName, ok: true, data };
            observations.push(obs);
            succeededSteps.add(key);
            try { pushObservation(iter, toolName, args, obs); } catch {}
  
            console.log(
              JSON.stringify({ thought: step, tool: toolName, args, observation: obs, retries }, null, 2)
            );
  
            succeeded = true;
            break;
          } catch (err: any) {
            const obs = { tool: toolName, ok: false, error: err?.message ?? String(err) };
            observations.push(obs);
            try { pushObservation(iter, toolName, args, obs); } catch {}
  
            console.log(
              JSON.stringify({ thought: step, tool: toolName, args, observation: obs, retries }, null, 2)
            );
  
            retries++;
            if (retries > maxRetries) break;
            await new Promise((r) => setTimeout(r, 1000 * retries));
          }
        }
  
        if (checkStopping(p.stopping_conditions, observations)) {
          return { status: "resolved", observations };
        }
      }
  
      if (checkStopping(p.stopping_conditions, observations)) {
        return { status: "resolved", observations };
      }
    }
  
    return { status: "incomplete", observations };
  }
  


  async function computeUncertainty(
  openai: OpenAI | undefined,
  plan: Plan,
  observations: any[],
  ctx: ExecContext = {}
): Promise<{ score: number; reason: string }> {
  const fallbackHeuristic = () => {
    // consider "useful" observations as ones with ok=true
    const useful = observations.filter((o) => o.ok).length;
    const expected = Math.max(1, plan.steps?.length ?? 1);
    const ratio = Math.min(1, useful / expected);
    const score = Math.max(0, Math.min(1, 1 - ratio)); // higher score = more uncertain
    return { score, reason: `heuristic (useful=${useful}, expected=${expected})` };
  };

  if (!openai || ctx.useLLMForReflection === false) {
    return fallbackHeuristic();
  }

  // Build a compact observations string
  const obsText = observations
    .map((o, i) => `${i + 1}. tool=${o.tool} ok=${o.ok} data=${JSON.stringify(o.data ?? o.error ?? {})}`)
    .join("\n");

  const promptSys = `You are a short evaluation assistant. You are given a plan and the observations produced after executing it.
Return ONLY valid JSON: { "confidence": <0-1 numeric>, "reason": "<short explanation>" }.
Confidence 1.0 means fully confident the goal is met; 0.0 means completely uncertain.`;

  const promptUser = `Plan goal: ${String(plan.goal ?? "<no goal>")}
Stopping conditions: ${JSON.stringify(plan.stopping_conditions ?? [])}

Observations:
${obsText}

Question: On a numeric scale 0-1 (inclusive), how confident are you that the plan's goal is satisfied, based on the observations above? Respond as JSON exactly as described.`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: promptSys },
        { role: "user", content: promptUser },
      ],
      temperature: 0,
      max_tokens: 200,
    });

    const text = resp.choices?.[0]?.message?.content ?? "";
    // try to parse JSON
    try {
      const parsed = JSON.parse(text);
      let score = Number(parsed.confidence ?? parsed.conf ?? parsed.score);
      if (Number.isFinite(score)) {
        score = Math.max(0, Math.min(1, score));
        return { score, reason: String(parsed.reason ?? parsed.explanation ?? "").slice(0, 512) };
      }
    } catch {
      // not JSON → try to extract number with regex
      const m = text.match(/([0](?:\.\d+)?|1(?:\.0+)?)/);
      if (m) {
        const score = Math.max(0, Math.min(1, Number(m[1])));
        return { score, reason: `parsed numeric from model: ${m[1]}` };
      }
    }

    // fallback if model answer not parseable
    return fallbackHeuristic();
  } catch (err) {
    // network / rate-limit → fall back to heuristic
    return fallbackHeuristic();
  }
}

/**
 * Orchestrator: run a plan, reflect, and re-plan if needed.
 * - openai: OpenAI client (required for re-planning via plan()).
 * - ticket: original ticket object (passed to plan()).
 * - initialPlan: starting plan.
 * - ctx: ExecContext with optional reflection config:
 *    ctx.reflection_threshold (0-1, default 0.5),
 *    ctx.reflection_maxIterations (default 2),
 *    ctx.reflection_backoffMs (default 500),
 *    ctx.useLLMForReflection (default true)
 */
export async function runWithReflection(
  openai: OpenAI,
  ticket: any,
  initialPlan: Plan,
  ctx: ExecContext = {}
): Promise<RunResult> {
  const threshold = typeof ctx.reflection_threshold === "number" ? ctx.reflection_threshold : 0.5;
  const maxAttempts = typeof ctx.reflection_maxIterations === "number" ? ctx.reflection_maxIterations : 2;
  const backoffMs = typeof ctx.reflection_backoffMs === "number" ? ctx.reflection_backoffMs : 500;

  let currentPlan = initialPlan;
  const aggregateObservations: any[] = [];

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    // run executor on currentPlan
    const runResult = await execute(currentPlan, ctx);
    // append observations
    aggregateObservations.push(...(runResult.observations ?? []));

    // compute uncertainty
    const { score, reason } = await computeUncertainty(openai, currentPlan, aggregateObservations, ctx);

    // structured reflection log
    console.log(
      JSON.stringify(
        {
          reflection: {
            attempt,
            plan_goal: currentPlan.goal,
            uncertainty_score: score,
            reason,
            last_run_status: runResult.status,
            observations_count: aggregateObservations.length,
          },
        },
        null,
        2
      )
    );

    // if resolved and score low enough, we're done
    if (runResult.status === "resolved" && score <= threshold) {
      return { status: "resolved", observations: aggregateObservations };
    }

    // if below threshold but run not resolved, we might still accept it? We'll re-plan only if score > threshold
    if (score > threshold && attempt < maxAttempts) {
      // re-plan
      try {
        // wait a little before asking planner to avoid immediate loop
        await new Promise((r) => setTimeout(r, backoffMs));

        const newPlan = await plan(openai, ticket);
        // log re-plan event
        console.log(
          JSON.stringify(
            {
              reflection_event: {
                type: "replan",
                attempt: attempt + 1,
                reason: `uncertainty ${score} > threshold ${threshold}`,
                new_plan_summary: {
                  goal: newPlan.goal,
                  steps_count: Array.isArray(newPlan.steps) ? newPlan.steps.length : 0,
                },
              },
            },
            null,
            2
          )
        );

        currentPlan = newPlan;
        // continue loop and re-run execute()
        continue;
      } catch (err: any) {
        console.log(JSON.stringify({ reflection_error: String(err?.message ?? err) }));
        // if planner failed, escalate
        break;
      }
    }

    // If we reach here: either score <= threshold but not resolved OR max attempts hit OR planner failed.
    // If not resolved and we exhausted re-plan attempts -> escalate
    if (runResult.status !== "resolved") {
      // escalate (call tool if available)
      const escalator = registry["escalate.toHuman"];
      if (escalator) {
        try {
          const esArgs = { ticket_id: ticket?.id ?? currentPlan?.ticket_id ?? "unknown", reason: "reflection_max_exceeded_or_unresolved" };
          const escData = await escalator(esArgs, ctx);
          const escObs = { tool: "escalate.toHuman", ok: true, data: escData };
          aggregateObservations.push(escObs);
          console.log(JSON.stringify({ reflection: { action: "escalated", args: esArgs, observation: escObs } }, null, 2));
          return { status: "escalated", observations: aggregateObservations };
        } catch (err: any) {
          const escObs = { tool: "escalate.toHuman", ok: false, error: String(err?.message ?? err) };
          aggregateObservations.push(escObs);
          console.log(JSON.stringify({ reflection: { action: "escalation_failed", observation: escObs } }, null, 2));
          return { status: "escalated", observations: aggregateObservations };
        }
      } else {
        // no escalator tool registered
        return { status: "escalated", observations: aggregateObservations };
      }
    }

    // if runResult.status === "resolved" and score > threshold (rare), treat as resolved but log
    return { status: runResult.status, observations: aggregateObservations };
  }

  // safety fallback
  return { status: "incomplete", observations: [] };
}

// export execute and other functions below as before (execute already exported above).
// Ensure module exports include runWithReflection and existing functions (registerTool, plan, execute).
