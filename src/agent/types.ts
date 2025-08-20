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

export const PlanSchema = z.object({
  goal: z.string(),
  assumptions: z.array(z.string()).default([]),
  steps: z.array(z.string()),
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
