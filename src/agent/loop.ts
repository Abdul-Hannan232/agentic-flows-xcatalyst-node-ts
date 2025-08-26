import { OpenAI } from "openai";
import { Plan, PlanSchema, RunResult, ExecContext } from "./types.js";

const allowedTools = [
  "kb.retrieve",
  "billing.api.getInvoice",
  "issues.api.create",
  "status.api.get",
  "email.draftReply",
  "escalate.toHuman",
];

function sanitizePlan(plan: any): any {
  if (Array.isArray(plan.steps)) {
    plan.steps = plan.steps.map((step: any) => {
      if (!allowedTools.includes(step.tool)) {
        console.warn(
          `Planner suggested unknown tool: ${step.tool}. Escalating...`
        );
        return {
          tool: "escalate.toHuman",
          args: {
            ticket_id: plan.ticket_id ?? "unknown",
            reason: `Unrecognized tool: ${step.tool}`,
          },
        };
      }
      return step;
    });
  }
  return plan;
}

export async function plan(openai: OpenAI, ticket: unknown): Promise<Plan> {
  const sys = `
You are a triage planner.
Output ONLY valid JSON in the following shape:

{
  "goal": string,
  "assumptions": string[],
  "steps": { "tool": string, "args": object }[],
  "stopping_conditions": string[]
}

Rules:
- steps MUST be a list of { "tool": string, "args": object }.
- tool = the name of a registered tool (e.g., "kb.retrieve", "billing.api.getInvoice", "email.draftReply").
- args = a JSON object with the parameters for that tool.
- Do NOT output plain English instructions in steps. Only tool calls.
- Do not invent tools that don’t exist.
`;

  const user = `Ticket: ${JSON.stringify(ticket)}`;
  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  });

  const text = resp.choices[0]?.message?.content ?? "{}";
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Planner did not return valid JSON");
  }

  // sanitize before schema validation
  const safe = sanitizePlan(raw);
  return PlanSchema.parse(safe);
}

// naive registry to be replaced by a proper router
type ToolFn = (args: any, ctx: ExecContext) => Promise<any>;
const registry: Record<string, ToolFn> = {};

export function registerTool(name: string, fn: ToolFn) {
  registry[name] = fn;
}

export async function execute(
  p: Plan,
  ctx: ExecContext = {}
): Promise<RunResult> {
  const observations = [];
  let budget = typeof ctx.budget === "number" ? ctx.budget! : 8;

  for (const step of p.steps) {
    if (budget-- <= 0) {
      return { status: "escalated", details: "budget_exhausted", observations };
    }

    let toolName: string;
    let args: any = {};

    if (typeof step === "string") {
      console.error(
        "❌ Invalid step format (string). Expected { tool, args } object."
      );
      observations.push({
        tool: step,
        ok: false,
        error: "invalid_step_format",
      });
      continue;
    } else {
      toolName = step.tool;
      args = step.args ?? {};
    }

    const tool = registry[toolName];
    if (!tool) {
      observations.push({ tool: toolName, ok: false, error: "tool_not_found" });
      continue;
    }

    try {
      const data = await tool(args, ctx);
      observations.push({ tool: toolName, ok: true, data });
    } catch (e: any) {
      observations.push({
        tool: toolName,
        ok: false,
        error: e?.message ?? String(e),
      });
    }
  }

  return { status: "resolved", observations };
}

/*
export async function runHelloAgent() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a helpful hello-world agent." },
      { role: "user", content: "Say hello in one short sentence." },
    ],
  });

  console.log("Agent response:", response.choices[0].message.content);
}
*/
