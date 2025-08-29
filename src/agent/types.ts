import { z } from "zod";

export type Ticket = {
  id: string;
  from: string;
  subject: string;
  body: string;
  attachments?: string[];
  channel: string;
  received_at: string; // ISO
};

const ToolNames = z.enum([
  "kb.retrieve",
  "billing.api.getInvoice",
  "issues.api.create",
  "status.api.get",
  "email.draftReply",
  "escalate.toHuman",
  "billing.listInvoices",
  "billing.getUsage",
  "issues.listIssues",
  "issues.getIssues",
])

const StepSchema = z.object({
  tool: ToolNames,
  args: z.record(z.any())
})

export const PlanSchema = z.object({
  goal: z.string(),
  assumptions: z.array(z.string()).default([]),
  steps: z.array(StepSchema),
  stopping_conditions: z.array(z.string()).default([])
});
export type Plan = z.infer<typeof PlanSchema>;

export type Action = { tool: string; args: unknown };
export type Observation = { tool: string; ok: boolean; data?: unknown; error?: string };

export type RunResult = {
  status: "resolved" | "escalated" | "failed";
  details?: unknown;
  observations?: Observation[];
};

export type ExecContext = {
  dry_run?: boolean;
  budget?: number;
  redact?: (s: string) => string;
  // add stores (memory, kb) as needed
};
