// src/metrics.ts
import fs from "node:fs";
import path from "node:path";
import type { RunMetrics, RunResult } from "./agent/types";

export function computeMetrics(
  runId: string,
  ticketId: string,
  startMs: number,
  endMs: number,
  result: RunResult
): RunMetrics {
  const steps = Array.isArray(result.observations) ? result.observations.length : 0;
  const resolved = result.status === "resolved";
  const escalated = result.status === "escalated";
  const iterations = 1 + ((result.details?.reflectionAttempts as number) ?? 0);
  const duration_ms = Math.max(0, Math.round(endMs - startMs));

  return {
    run_id: runId,
    ticket_id: ticketId,
    steps,
    escalated,
    resolved,
    iterations,
    duration_ms,
    timestamp: new Date().toISOString(),
  };
}

export async function saveMetrics(metrics: RunMetrics, outDir = "runs"): Promise<string> {
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${metrics.run_id}.json`);
  await fs.promises.writeFile(outPath, JSON.stringify(metrics, null, 2), "utf-8");
  console.log(`[metrics] saved → ${outPath}`);
  return outPath;
}
