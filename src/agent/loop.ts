// src/agent/loop.ts
import { OpenAI } from "openai";
import { Plan, PlanSchema, RunResult, ExecContext } from "./types.js";


/**
 * Canonical allowed tools (keep this list in sync with tools you register in cli.ts)
 */
const allowedTools = [
  "kb.retrieve",

  // billing tools
  "billing.api.getInvoice",
  "billing.listInvoices",
  "billing.getUsage",

  // issue/tracker tools
  "issues.api.create",
  "issues.listIssues",
  "issues.getIssues",

  // infra / status
  "status.api.get",

  // communication & escalation
  "email.draftReply",
  "escalate.toHuman",
];

/**
 * Descriptions to include in the planner prompt
 * (this helps the model choose only the allowed tool names).
 */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  "kb.retrieve":
    "Search the local knowledge base; args: { query: string, top_k?: number }",
  "billing.api.getInvoice":
    "Retrieve invoice details; args: { customer_email: string, month: string }",
  "billing.listInvoices": "List invoices; args: { customer?: string }",
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
};

/**
 * Small alias map to translate a few common model-invented names into canonical names.
 * Keeps things robust without editing the model.
 */
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

    // map aliases
    if (aliasMap[origTool]) {
      tool = aliasMap[origTool];
    }

    // canonical check
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

    // ensure args exists
    const args = step.args ?? {};

    // dedupe key (tool + args)
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


/**
 * Ask the model to produce a plan JSON. We inject the canonical tool list to reduce hallucinations.
 */
export async function plan(openai: OpenAI, ticket: unknown): Promise<Plan> {
  const toolList = Object.entries(TOOL_DESCRIPTIONS)
    .map(([name, desc]) => `- ${name}: ${desc}`)
    .join("\n");

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

  const user = `Ticket: ${JSON.stringify(ticket)}`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0, // deterministic
  });

  const text = resp.choices?.[0]?.message?.content ?? "{}";
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error("Planner did not return valid JSON");
  }

  // sanitize (alias + allowed tool check)
  const safe = sanitizePlan(raw);
  return PlanSchema.parse(safe);
}

/* ----- tool registry ----- */
/* naive registry used by execute; cli registers functions via registerTool */
type ToolFn = (args: any, ctx: ExecContext) => Promise<any>;
const registry: Record<string, ToolFn> = {};

export function registerTool(name: string, fn: ToolFn) {
  registry[name] = fn;
}

/**
 * Execute a plan until stopping conditions are satisfied or budget exhausted.
 * - Iterates the plan steps in order, collecting observations.
 * - After each step checks stopping_conditions (simple substring match across observations).
 * - Stops early if any stopping condition looks satisfied.
 * - Respects ctx.budget (max number of tool calls).
 */

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

      // single retries variable for this step
      let retries = 0;
      const maxRetries = 2; // can also make configurable via ctx

      if (succeededSteps.has(key)) {
        const obs = {
          tool: toolName,
          ok: true,
          data: { note: "skipped-duplicate-success" },
        };
        observations.push(obs);
        console.log(
          JSON.stringify({ thought: step, tool: toolName, args, observation: obs, retries }, null, 2)
        );
        continue;
      }

      const fn = registry[toolName];
      if (!fn) {
        const obs = { tool: toolName, ok: false, error: "tool_not_found" };
        observations.push(obs);
        console.log(
          JSON.stringify({ thought: step, tool: toolName, args, observation: obs, retries }, null, 2)
        );
        continue;
      }

      // Retry loop with structured logging
      while (retries <= maxRetries) {
        try {
          const data = await fn(args, ctx);

          const obs = { tool: toolName, ok: true, data };
          observations.push(obs);
          succeededSteps.add(key);

          console.log(
            JSON.stringify({ thought: step, tool: toolName, args, observation: obs, retries }, null, 2)
          );

          break; // success
        } catch (err: any) {
          retries++;
          const obs = { tool: toolName, ok: false, error: err?.message ?? String(err) };
          observations.push(obs);

          console.log(
            JSON.stringify({ thought: step, tool: toolName, args, observation: obs, retries }, null, 2)
          );

          if (retries > maxRetries) break;

          // exponential backoff
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
