import fs from "node:fs/promises";
import path from "node:path";
import type { Ticket } from "../agent/types.js";

export async function loadTicket(ticketPath: string): Promise<Ticket> {
  const absPath = path.resolve(process.cwd(), ticketPath);

  let raw: string;
  try {
    raw = await fs.readFile(absPath, "utf8");
  } catch {
    throw new Error(`Ticket file not found at ${absPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ticket file: ${(err as Error).message}`);
  }

  // Basic sanity check
  const t = parsed as Ticket;
  if (!t.id || !t.from || !t.subject || !t.body) {
    throw new Error(`Missing required ticket fields in ${absPath}`);
  }

  return t;
}
