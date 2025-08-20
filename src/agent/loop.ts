import { OpenAI } from "openai";
import { Plan, PlanSchema, RunResult, ExecContext } from "./types.js";

export async function plan(openai: OpenAI, ticket: unknown): Promise<Plan> {
  const sys = "You are a triage planner. Output ONLY valid JSON matching {goal, assumptions, steps, stopping_conditions}.";
  const user = `Ticket: ${JSON.stringify(ticket)}`;
  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    temperature: 0.2
  });
  const text = resp.choices[0]?.message?.content ?? "{}";
  return PlanSchema.parse(JSON.parse(text));
}

// naive registry to be replaced by a proper router
type ToolFn = (args: any, ctx: ExecContext) => Promise<any>;
const registry: Record<string, ToolFn> = {};

export function registerTool(name: string, fn: ToolFn) {
  registry[name] = fn;
}

export async function execute(p: Plan, ctx: ExecContext = {}): Promise<RunResult> {
  const observations = [];
  let budget = typeof ctx.budget === "number" ? ctx.budget! : 8;

  for (const step of p.steps) {
    if (budget-- <= 0) {
      return { status: "escalated", details: "budget_exhausted", observations };
    }
    // very simple tool parsing convention: "toolName argJSON"
    const [toolName, ...rest] = step.split(" ");
    const jsonArg = rest.join(" ").trim();
    const args = jsonArg.startsWith("{") ? JSON.parse(jsonArg) : {};
    const tool = registry[toolName];
    if (!tool) {
      observations.push({ tool: toolName, ok: false, error: "tool_not_found" });
      continue;
    }
    try {
      const data = await tool(args, ctx);
      observations.push({ tool: toolName, ok: true, data });
    } catch (e: any) {
      observations.push({ tool: toolName, ok: false, error: e?.message ?? String(e) });
    }
  }
  return { status: "resolved", observations };
}
