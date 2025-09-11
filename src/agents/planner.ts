// src/agents/planner.ts
import OpenAI from "openai";
import { PlanSchema, Plan } from "../agent/types.js";

import "dotenv/config";


const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generatePlan(ticket: any): Promise<Plan> {
  const prompt = `
You are a Planner agent.
Analyze the customer support ticket and produce a structured plan.

Ticket:
${JSON.stringify(ticket, null, 2)}

Rules:
- If the ticket requests a refund, always include a step:
  { "tool": "billing.api.getInvoice", "args": { "refundAmount": <amount> } }
- Use only the following tools:
  kb.retrieve, billing.api.getInvoice, issues.api.create, status.api.get,
  email.draftReply, escalate.toHuman, billing.listInvoices, billing.getUsage,
  issues.listIssues, issues.getIssues, cases.query.

Return ONLY strict JSON in this format:
{
  "goal": "...",
  "assumptions": ["..."],
  "steps": [
    { "tool": "one of the allowed tools", "args": { "key": "value" } }
  ],
  "stopping_conditions": ["..."]
}`;


  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  });

  const raw = response.choices[0].message?.content ?? "{}";
  
  try {
    return PlanSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.error("Planner produced invalid plan:", raw);
    throw err;
  }
}
