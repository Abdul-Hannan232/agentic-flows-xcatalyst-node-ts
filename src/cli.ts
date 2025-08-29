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
// import * as path from "node:path";

// Load env
dotenv.config();

// Register mock tools
import { retrieve as kbRetrieve } from "./tools/kb";
import { getInvoice } from "./tools/billing";
import { createIssue } from "./tools/issues";
import { getStatus } from "./tools/status";
import { draftReply } from "./tools/email";
import { escalate } from "./tools/escalate";

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

const redact = (s: string) => s.replaceAll(/([\w._%+-])[^@\s]*(@)/g, "$1***$2");

program
  .command("triage:run")
  .requiredOption("--ticket <path>", "path to ticket JSON")
  .option("--dry-run", "do not perform side-effecting calls", true)
  .action(async (opts) => {
    const ticket = await loadTicket(opts.ticket);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const p = await plan(openai, ticket);
    const ctx: ExecContext = { dry_run: !!opts.dryRun, budget: 8, redact };
    const result = await execute(p, ctx);
    console.log(
      JSON.stringify({ ticket_id: ticket.id, plan: p, result }, null, 2)
    );
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
      const p = await plan(openai, ticket);
      const ctx: ExecContext = { dry_run: !!opts.dryRun, budget: 8, redact };
      const result = await execute(p, ctx);

      results.push({
        ticket_id: ticket.id,
        status: result.status,
        observations_count: result.observations.length,
      });

      console.log(`Processed ${ticket.id} → ${result.status}`);
    }

    console.log("\nBatch Summary:");
    // --- after you compute `results` (array of { ticket_id, status, observations_count, ... })
    const resolvedCount = results.filter(
      (r: any) => r.status === "resolved"
    ).length;
    const total = results.length;

    // human-friendly pass/fail
    console.log(
      `\n${
        resolvedCount === 0 ? "❌" : "✅"
      } ${resolvedCount}/${total} resolved`
    );

    // Print short list of incomplete tickets (quick diagnostics)
    const incomplete = results.filter((r: any) => r.status !== "resolved");
    if (incomplete.length > 0) {
      console.log("\nIncomplete tickets (ids):");
      for (const it of incomplete) {
        console.log(
          ` - ${it.ticket_id}  (status=${it.status}, observations=${it.observations_count})`
        );
      }
    }

    // persist results to runs/
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

program.parse();



















// Doing GPT suggested task to check everything is working fine

/*
import { Command } from "commander";
import { runHelloAgent } from "./agent/loop.js";

const program = new Command();

program
  .name("cli")
  .description("Agentic Flows CLI");

program
  .command("hello:run")
  .description("Run a hello-world agent loop")
  .action(async () => {
    await runHelloAgent();
  });

program.parse();  
*/
