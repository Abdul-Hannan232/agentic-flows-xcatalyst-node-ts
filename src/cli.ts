#!/usr/bin/env node
import { program } from "commander";
import fs from "node:fs/promises";
import * as path from "node:path";
import { OpenAI } from "openai";
import dotenv from "dotenv";
import { plan, execute, registerTool } from "./agent/loop.js";
import type { ExecContext } from "./agent/types.js";

// Load env
dotenv.config();

// Register mock tools
import { retrieve as kbRetrieve } from "./tools/kb.js";
import { getInvoice } from "./tools/billing.js";
import { createIssue } from "./tools/issues.js";
import { getStatus } from "./tools/status.js";
import { draftReply } from "./tools/email.js";
import { escalate } from "./tools/escalate.js";

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
    const ticketPath = path.resolve(process.cwd(), opts.ticket);
    const ticket = JSON.parse(await fs.readFile(ticketPath, "utf8"));
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const p = await plan(openai, ticket);
    const ctx: ExecContext = { dry_run: !!opts.dryRun, budget: 8, redact };
    const result = await execute(p, ctx);
    console.log(JSON.stringify({ ticket_id: ticket.id, plan: p, result }, null, 2));
  });

program.parse();
