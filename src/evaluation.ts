// src/evaluation.ts
import fs from "node:fs/promises";
import path from "node:path";
import { OpenAI } from "openai";
import { loadTicket } from "./utils/loadTicket";
import { initShortMemory, resetShortMemory } from "./memory/short";
import { plan, runWithReflection } from "./agent/loop";
import { computeMetrics, saveMetrics } from "./metrics";
import type { RunResult } from "./agent/types";
import { classifyTicket, generateStaticPlan } from "./classifier/staticClassifier";

export async function runTriageOnce(ticketPath: string, opts: { dryRun?: boolean; useCases?: boolean; budget?: number }) {
  const raw = await fs.readFile(ticketPath, "utf-8");
  const ticket = JSON.parse(raw);
  initShortMemory(ticket.id);

  const runId = `run-${Date.now()}-${ticket.id}`;

  const startMs = Date.now();
  try {


    
    // decide whether to use the LLM for this run
  const envHasKey = Boolean(process.env.OPENAI_API_KEY);
  const useLLM = !opts.dryRun && envHasKey;

  // create client only if we'll actually use it
  const openai = useLLM ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : undefined;

  // prepare plan (static if dryRun / no key, LLM otherwise)
  let p: any;
  if (!useLLM) {
    // cheap / deterministic fallback — NO LLM calls, no tokens consumed
    const classification = classifyTicket(ticket);
    p = generateStaticPlan(ticket, classification);
  } else {
    // use LLM planner (consumes tokens)
    p = await plan(openai as any, ticket);
  }

  const ctx: any = {
    dry_run: !!opts.dryRun,
    budget: typeof opts.budget === "number" ? opts.budget : 8,
    reflection_threshold: 0.7,
    reflection_maxIterations: 1,
    useCases: !!opts.useCases,
    // important: prevent computeUncertainty from calling the LLM when dryRun
    useLLMForReflection: !!useLLM,
  };

  // runWithReflection accepts openai param — pass it only if useLLM is true
  const result: RunResult = await runWithReflection(openai as any, ticket, p, ctx);
  console.log(`runTriageOnce: useLLM=${useLLM} dryRun=${!!opts.dryRun}`);

    const endMs = Date.now();

    // compute & save metrics
    const metrics = computeMetrics(runId, ticket.id, startMs, endMs, result);
    await saveMetrics(metrics, "runs");

    // Also save a run-level summary (plan + result + metrics) for traceability
    const runSummary = { run_id: runId, ticket_id: ticket.id, plan: p, result, metrics };
    const runPath = path.join("runs", `${runId}.summary.json`);
    await fs.writeFile(runPath, JSON.stringify(runSummary, null, 2), "utf-8");

    return { ticket, result, runId, metrics, runPath };
  } finally {
    resetShortMemory();
  }
}

export async function runEvaluation(ticketsDir = "data/tickets", opts: { sampleCount?: number; outPath?: string } = {}) {
  const files = (await fs.readdir(ticketsDir)).filter((f) => f.endsWith(".json"));
  const sample = typeof opts.sampleCount === "number" ? files.slice(0, opts.sampleCount) : files;

  const baselineResults: any[] = [];
  const withCasesResults: any[] = [];

  console.log(`Running baseline (${sample.length} tickets) ...`);
  for (const f of sample) {
    const ticketPath = path.join(ticketsDir, f);
    const r = await runTriageOnce(ticketPath, { dryRun: true, useCases: false });
    baselineResults.push(r.metrics);
  }

  console.log(`Running after-ingest (with cases) (${sample.length} tickets) ...`);
  for (const f of sample) {
    const ticketPath = path.join(ticketsDir, f);
    const r = await runTriageOnce(ticketPath, { dryRun: true, useCases: true });
    withCasesResults.push(r.metrics);
  }

  // aggregate summary
  const summary = {
    timestamp: new Date().toISOString(),
    baseline: aggregateMetrics(baselineResults),
    with_cases: aggregateMetrics(withCasesResults),
    raw: { baselineResults, withCasesResults },
  };

  const outFile = opts.outPath ?? path.join("data", "eval_summary.json");
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`[eval] summary saved → ${outFile}`);

  return summary;
}

function mean(arr: number[]) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function aggregateMetrics(list: any[]) {
  const total = list.length;
  const resolvedCount = list.filter((m) => m.resolved).length;
  const escalatedCount = list.filter((m) => m.escalated).length;
  const avgSteps = mean(list.map((m) => m.steps));
  const avgIterations = mean(list.map((m) => m.iterations));
  const avgDuration = mean(list.map((m) => m.duration_ms));

  return {
    total,
    resolvedCount,
    escalatedCount,
    resolvedRate: total ? resolvedCount / total : 0,
    escalatedRate: total ? escalatedCount / total : 0,
    avgSteps,
    avgIterations,
    avgDuration,
  };
}
