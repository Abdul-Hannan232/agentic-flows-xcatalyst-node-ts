#!/usr/bin/env node
import { program } from "commander";
import { OpenAI } from "openai";
import dotenv from "dotenv";
import { plan, execute, registerTool } from "./agent/loop";
import fs from "node:fs/promises";
import type { ExecContext } from "./agent/types";
import { loadTicket } from "./utils/loadTicket";
import { classifyTicket, generateStaticPlan } from "./classifier/staticClassifier";
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
    console.log(JSON.stringify({ ticket_id: ticket.id, plan: p, result }, null, 2));
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
    }

    const parsed = TriageOutputSchema.parse(output)


    console.log(JSON.stringify(parsed,null,2));
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