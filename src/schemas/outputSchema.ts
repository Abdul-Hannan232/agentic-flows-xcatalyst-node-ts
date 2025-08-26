import { z } from "zod";

export const ClassificationSchema = z.object({
  category: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});

export const PlanStepSchema = z.object({
  tool: z.string(),
  args: z.record(z.any()),
});

export const PlanSchema = z.object({
  goal: z.string(),
  assumptions: z.array(z.string()),
  steps: z.array(PlanStepSchema),
  stopping_conditions: z.array(z.string()),
});

export const TriageOutputSchema = z.object({
  ticket_id: z.string(),
  classification: ClassificationSchema,
  plan: PlanSchema,
});
