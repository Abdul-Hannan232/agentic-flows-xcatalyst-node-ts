// // src/executor.ts
// import { availableTools } from "./tools";

// export interface Step {
//   tool: string;
//   args: Record<string, any>;
// }

// export interface Plan {
//   goal: string;
//   assumptions: string[];
//   steps: Step[];
//   stopping_conditions: string[];
// }

// export interface Observation {
//   tool: string;
//   ok: boolean;
//   data: any;
// }

// export interface ExecutionResult {
//   status: "resolved" | "stopped";
//   observations: Observation[];
//   reason?: string;
// }

// export async function executePlan(plan: Plan, maxSteps = 10): Promise<ExecutionResult> {
//   const observations: Observation[] = [];

//   for (let i = 0; i < plan.steps.length && i < maxSteps; i++) {
//     const step = plan.steps[i];
//     const tool = availableTools[step.tool];

//     if (!tool) {
//       observations.push({
//         tool: step.tool,
//         ok: false,
//         data: { error: "Tool not found" },
//       });
//       continue;
//     }

//     try {
//       const data = await tool.fn(step.args);
//       observations.push({ tool: step.tool, ok: true, data });

//       // 🔎 Check stopping conditions after each step
//       if (checkStoppingConditions(plan.stopping_conditions, observations)) {
//         return {
//           status: "resolved",
//           observations,
//           reason: "Stopping conditions met",
//         };
//       }
//     } catch (err: any) {
//       observations.push({
//         tool: step.tool,
//         ok: false,
//         data: { error: err.message },
//       });
//     }
//   }

//   // If budget exceeded or steps exhausted
//   return {
//     status: "stopped",
//     observations,
//     reason: "Step budget exhausted or plan incomplete",
//   };
// }

// // Naive stopping condition checker (you can make smarter later)
// function checkStoppingConditions(conditions: string[], observations: Observation[]): boolean {
//   if (observations.length === 0) return false;
//   // For now: if at least one observation succeeded, call it "done"
//   // Later you can parse conditions and match against data
//   return observations.some(obs => obs.ok);
// }
