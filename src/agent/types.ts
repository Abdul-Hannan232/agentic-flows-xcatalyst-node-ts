// src/agent/types.ts  (patch / replace relevant section)
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
  "cases.query",
]);

const StepSchema = z.object({
  tool: ToolNames,
  args: z.record(z.any())
});

export const PlanSchema = z.object({
  goal: z.string(),
  assumptions: z.array(z.string()).default([]),
  steps: z.array(StepSchema),
  stopping_conditions: z.array(z.string()).default([])
});
export type Plan = z.infer<typeof PlanSchema>;

export type Action = { tool: string; args: unknown };
export type Observation = { tool: string; ok: boolean; data?: unknown; error?: string };

// Allow the statuses that the executor/runner actually emits
export type RunResult = {
  status: "resolved" | "escalated" | "failed" | "incomplete";
  details?: {
    // optional, but used to report reflection attempts, etc
    reflectionAttempts?: number;
    [k: string]: unknown;
  };
  observations?: Observation[];
};

// metrics shape saved per run
export type RunMetrics = {
  run_id: string;
  ticket_id: string;
  steps: number; // number of observations / steps executed
  escalated: boolean;
  resolved: boolean;
  iterations: number; // reflection attempts + 1
  duration_ms: number;
  timestamp: string;
};

export type ExecContext = {
  dry_run?: boolean;
  budget?: number;
  redact?: (s: string) => string;

  // reflection tuning:
  reflection_threshold?: number;
  reflection_maxIterations?: number;
  reflection_backoffMs?: number;
  useLLMForReflection?: boolean;

  // cases & memory flags
  useCases?: boolean;
  memoryEnabled?: boolean;

  // other tuning:
  max_tool_retries?: number;
  max_iterations?: number;
  
};
