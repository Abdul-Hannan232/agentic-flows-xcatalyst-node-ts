#!/usr/bin/env node
import { program } from "commander";
import { OpenAI } from "openai";
import dotenv from "dotenv";
import { plan, execute, registerTool } from "./agent/loop";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExecContext } from "./agent/types";
import { loadTicket } from "./utils/loadTicket";
import {
  classifyTicket,
  generateStaticPlan,
} from "./classifier/staticClassifier";
import { TriageOutputSchema } from "./schemas/outputSchema";
import { initShortMemory, resetShortMemory } from "./memory/short";
import { runWithReflection } from "./agent/loop";
import { runEvaluation } from "./evaluation";


dotenv.config();

import { retrieve as kbRetrieve } from "./tools/kb";
import { getInvoice } from "./tools/billing";
import { createIssue } from "./tools/issues";
import { getStatus } from "./tools/status";
import { draftReply } from "./tools/email";
import { escalate } from "./tools/escalate";
import { casesQueryTool, storeFromRun, rebuildIndex } from "./tools/cases";


import {
  listInvoicesTool,
  getUsageTool,
  listIssuesTool,
  getIssuesTool,
} from "./tools/mockTools";

registerTool("billing.listInvoices", listInvoicesTool as any);
registerTool("billing.getUsage", getUsageTool as any);
registerTool("issues.listIssues", listIssuesTool as any);
registerTool("issues.getIssues", getIssuesTool as any);

registerTool("kb.retrieve", kbRetrieve as any);
registerTool("billing.api.getInvoice", getInvoice as any);
registerTool("issues.api.create", createIssue as any);
registerTool("status.api.get", getStatus as any);
registerTool("email.draftReply", draftReply as any);
registerTool("escalate.toHuman", escalate as any);

registerTool("cases.query", casesQueryTool as any);


const redact = (s: string) => s.replaceAll(/([\w._%+-])[^@\s]*(@)/g, "$1***$2");

program
  .command("triage:run")
  .requiredOption("--ticket <path>", "path to ticket JSON")
  .option("--dry-run", "do not perform side-effecting calls", true)
  .action(async (opts) => {
    const ticket = await loadTicket(opts.ticket);

    // init short-term memory for this run
    initShortMemory(ticket.id);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const p = await plan(openai, ticket);
    const ctx: ExecContext = { dry_run: !!opts.dryRun, budget: 8, redact, reflection_threshold: 0.5, reflection_maxIterations: 1 };
    const result = await runWithReflection(openai, ticket, p, ctx);

    console.log(JSON.stringify({ ticket_id: ticket.id, plan: p, result }, null, 2));

    // ==== NEW: persist successful dry-run as a case ====
    if (opts.dryRun && result.status === "resolved") {
      try {
        const saved = await storeFromRun(ticket, p, result, { redact, openaiApiKey: process.env.OPENAI_API_KEY });
        if (saved.saved) {
          console.log(`[cases] saved → ${saved.path}`);
        } else {
          console.log(`[cases] not saved (${saved.reason})`);
        }
      } catch (e: any) {
        console.warn(`[cases] save failed: ${e?.message || e}`);
      }
    }

    // reset after run to avoid leaking memory between runs
    resetShortMemory();
  });



program
  .command("triage:classify")
  .requiredOption("--ticket <path>", "path to ticket JSON")
  .action(async (opts) => {
    const ticket = await loadTicket(opts.ticket);
    const classification = classifyTicket(ticket);
    const plan = generateStaticPlan(ticket, classification);

    const output = {
      ticket_id: ticket.id,
      classification,
      plan,
    };

    const parsed = TriageOutputSchema.parse(output);

    console.log(JSON.stringify(parsed, null, 2));
  });

program
  .command("triage:batch")
  .option("--dry-run", "do not perform side-effecting calls", true)
  .action(async (opts) => {
    const ticketsDir = path.resolve("data/tickets");
    const files = await fs.readdir(ticketsDir);
    const ticketFiles = files.filter((f) => f.endsWith(".json"));

    const results: any[] = [];

    for (const file of ticketFiles) {
      const ticketPath = path.join(ticketsDir, file);
      const raw = await fs.readFile(ticketPath, "utf-8");
      const ticket = JSON.parse(raw);

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      initShortMemory(ticket.id);
      try {
        const p = await plan(openai, ticket);
        const ctx: ExecContext = { dry_run: !!opts.dryRun, budget: 8, redact, reflection_threshold: 0.5, reflection_maxIterations: 1 };
        const result = await runWithReflection(openai, ticket, p, ctx);
      } finally {
        resetShortMemory();
      }


      results.push({
        ticket_id: ticket.id,
        status: result.status,
        observations_count: result.observations.length,
      });

      console.log(`Processed ${ticket.id} → ${result.status}`);
    }

    console.log("\nBatch Summary:");

    const resolvedCount = results.filter(
      (r: any) => r.status === "resolved"
    ).length;
    const total = results.length;

    console.log(
      `\n${resolvedCount === 0 ? "❌" : "✅"
      } ${resolvedCount}/${total} resolved`
    );

    const incomplete = results.filter((r: any) => r.status !== "resolved");
    if (incomplete.length > 0) {
      console.log("\nIncomplete tickets (ids):");
      for (const it of incomplete) {
        console.log(
          ` - ${it.ticket_id}  (status=${it.status}, observations=${it.observations_count})`
        );
      }
    }

    const outDir = path.resolve(process.cwd(), "runs");
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(
      outDir,
      `batch-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    const payload = {
      timestamp: new Date().toISOString(),
      resolvedCount,
      total,
      results,
    };
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`\nSaved batch results to ${outPath}`);
  });




program
  .command("cases:query")
  .requiredOption("--q <query>", "query string")
  .option("--k <num>", "top_k", "3")
  .action(async (opts) => {
    const res = await casesQueryTool({ query: opts.q, top_k: Number(opts.k) }, {} as any);
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command("cases:reindex")
  .action(async () => {
    const openai = process.env.CASES_USE_EMBEDDINGS === "1" && process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : undefined;
    await rebuildIndex(true, openai);
    console.log("Cases index rebuilt.");
  });


program
  .command("eval:cases")
  .option("--tickets <dir>", "tickets directory", "data/tickets")
  .option("--sample <n>", "max tickets to sample (for speed)", "10")
  .action(async (opts) => {
    const sampleCount = Number(opts.sample || 10);
    const summary = await runEvaluation(opts.tickets, { sampleCount });
    console.log("Evaluation summary (top-level):");
    console.log(JSON.stringify(summary, null, 2));
  });


program.parse();




// Conserve tokens, we can harden/debug what’s already built (e.g., avoid duplicate tool calls on replans, make reflection cheaper).