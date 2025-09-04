// src/tools/cases.ts
import fs from "node:fs/promises";
import path from "node:path";
import { OpenAI } from "openai";
import type { Plan, RunResult } from "../agent/types";

const CASES_DIR = path.resolve("data/cases");
const INDEX_PATH = path.resolve("data/cases_index.json");

/** ---- Types ---- */
export interface CaseAction {
  step: number;
  tool: string;
  args?: any;
  result?: any;
}

export interface CaseSummary {
  id: string;                 // file-safe id, 1:1 with ticket_id for idempotency
  ticket_id: string;
  problem_summary: string;
  plan: string[];             // human-readable plan steps
  actions: CaseAction[];      // condensed observations
  outcome: string;            // short, human-readable result
  postmortem: string;         // 1-2 line learning
  created_at: string;         // ISO timestamp
}

/** ---- Utilities ---- */
async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function pickProblemSummary(ticket: any): string {
  return (
    ticket?.subject ||
    ticket?.title ||
    (typeof ticket?.description === "string" ? ticket.description.slice(0, 160) : "") ||
    `Ticket ${ticket?.id ?? "unknown"}`
  );
}

function summarizePlan(p: Plan): string[] {
  return (p?.steps || []).map((s, i) => {
    const argBits: string[] = [];
    if (s.args) {
      for (const k of ["customer", "customer_email", "ticket_id", "month", "query"]) {
        if (s.args[k]) argBits.push(`${k}=${JSON.stringify(s.args[k])}`);
      }
    }
    const argStr = argBits.length ? ` (${argBits.join(", ")})` : "";
    return `${i + 1}. ${s.tool}${argStr}`;
  });
}

function outcomeFromRun(result: RunResult): string {
  if (!result) return "No result.";
  if (result.status === "resolved") {
    return `Resolved in ${result.observations?.length ?? 0} observations.`;
  }
  if (result.status === "escalated") {
    return `Escalated (${result.details ?? "unknown reason"}).`;
  }
  return `Incomplete after ${result.observations?.length ?? 0} observations.`;
}

function postmortemFromRun(result: RunResult, plan: Plan): string {
  const tools = new Set<string>();
  for (const o of result?.observations || []) {
    if (o?.tool) tools.add(o.tool);
  }
  const used = Array.from(tools).join(", ") || "none";
  const planned = plan?.steps?.length ?? 0;
  const obs = result?.observations?.length ?? 0;
  return `Planned ${planned} step(s); executed ${obs} observation(s); tools used: ${used}.`;
}

function maybeRedact(value: any, redact?: (s: string) => string) {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return redact ? redact(s) : s;
  } catch {
    return value;
  }
}

function observationToAction(o: any, idx: number, redact?: (s: string) => string): CaseAction {
  return {
    step: idx + 1,
    tool: o?.tool ?? "<unknown>",
    args: o?.args ? maybeRedact(o.args, redact) : undefined,
    result: o?.ok ? o?.data : { error: o?.error ?? "unknown_error" },
  };
}

function caseFilename(ticketId: string) {
  // idempotent: filename per ticket id
  const fn = `case_${String(ticketId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
  return path.join(CASES_DIR, fn);
}

/** ---- Public: store a case from a successful run ---- */
export async function storeFromRun(
  ticket: any,
  plan: Plan,
  result: RunResult,
  opts?: { redact?: (s: string) => string; openaiApiKey?: string }
): Promise<{ saved: boolean; path?: string; reason?: string }> {
  if (result?.status !== "resolved") {
    return { saved: false, reason: "not_resolved" };
  }

  await ensureDir(CASES_DIR);

  const filePath = caseFilename(ticket?.id ?? "unknown");
  // idempotency — if case for this ticket already exists, skip
  try {
    await fs.access(filePath);
    return { saved: false, reason: "exists" };
  } catch { /* ok, not exists */ }

  const actions: CaseAction[] = (result.observations || []).map((o: any, i: number) =>
    observationToAction(o, i, opts?.redact)
  );

  const caseObj: CaseSummary = {
    id: path.basename(filePath, ".json"),
    ticket_id: String(ticket?.id ?? "unknown"),
    problem_summary: maybeRedact(pickProblemSummary(ticket), opts?.redact),
    plan: summarizePlan(plan),
    actions,
    outcome: outcomeFromRun(result),
    postmortem: postmortemFromRun(result, plan),
    created_at: new Date().toISOString(),
  };

  await fs.writeFile(filePath, JSON.stringify(caseObj, null, 2), "utf-8");

  // Best-effort: update index (TF-IDF). Non-fatal if it fails.
  try {
    await rebuildIndex();
  } catch { /* ignore */ }

  return { saved: true, path: filePath };
}

/** ---- Query API (tool) ----
 * Uses TF-IDF over all case files. If no cases, returns [].
 * Optionally, you can experiment with embeddings by setting CASES_USE_EMBEDDINGS=1
 * (we still fall back to TF-IDF on any error).
 */
const STOP = new Set(
  "a an and are as at be but by for from has have i in is it its of on or our that the their there this to was were will with you your".split(" ")
);

function tokenize(text: string): string[] {
  return (text?.toLowerCase() || "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(t => t && !STOP.has(t));
}

async function loadAllCases(): Promise<CaseSummary[]> {
  try {
    await ensureDir(CASES_DIR);
    const files = await fs.readdir(CASES_DIR);
    const out: CaseSummary[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(CASES_DIR, f), "utf-8");
        out.push(JSON.parse(raw));
      } catch { /* skip bad file */ }
    }
    return out;
  } catch {
    return [];
  }
}

function buildTfIdf(cases: CaseSummary[]) {
  const docs = cases.map(c => ({
    id: c.id,
    text: [
      c.problem_summary,
      c.outcome,
      c.postmortem,
      ...(c.plan || []),
      ...(c.actions || []).map(a => `${a.tool} ${JSON.stringify(a.result ?? "")}`)
    ].join(" \n ")
  }));

  const tokenized = docs.map(d => ({ id: d.id, tokens: tokenize(d.text) }));
  const df = new Map<string, number>();
  for (const d of tokenized) {
    const uniq = new Set(d.tokens);
    for (const t of uniq) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = tokenized.length;
  const idf = new Map<string, number>();
  for (const [t, n] of df.entries()) idf.set(t, Math.log((N + 1) / (n + 1)) + 1);

  const vectors = new Map<string, Map<string, number>>();
  for (const d of tokenized) {
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = new Map<string, number>();
    for (const [t, f] of tf.entries()) {
      vec.set(t, f * (idf.get(t) || 0));
    }
    vectors.set(d.id, vec);
  }

  return { idf, vectors };
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  const norm = Math.sqrt(na) * Math.sqrt(nb) || 1;
  const keys = a.size < b.size ? a.keys() : b.keys();
  for (const k of keys) {
    const av = a.get(k) || 0;
    const bv = b.get(k) || 0;
    dot += av * bv;
  }
  return dot / norm;
}

export async function queryCases(query: string, top_k = 3): Promise<Array<{ score: number; case: CaseSummary }>> {
  const cases = await loadAllCases();
  if (cases.length === 0) return [];

  // (Optional) Embeddings — gated by env
  if (process.env.CASES_USE_EMBEDDINGS === "1" && process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      return await queryByEmbeddings(openai, cases, query, top_k);
    } catch {
      // fall through to TF-IDF
    }
  }

  // TF-IDF fallback
  const { idf, vectors } = buildTfIdf(cases);
  const qTokens = tokenize(query);
  const qtf = new Map<string, number>();
  for (const t of qTokens) qtf.set(t, (qtf.get(t) || 0) + 1);
  const qVec = new Map<string, number>();
  for (const [t, f] of qtf.entries()) qVec.set(t, f * (idf.get(t) || 0));

  const scored = cases.map(c => {
    const v = vectors.get(c.id) || new Map<string, number>();
    return { score: cosine(qVec, v), case: c };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, top_k);
}

/** ---- Simple embeddings path (optional) ---- */
async function queryByEmbeddings(
  openai: OpenAI,
  cases: CaseSummary[],
  query: string,
  top_k: number
) {
  const model = "text-embedding-3-small";
  // read or build & persist a tiny index
  const index = await rebuildIndex(true, openai, model).catch(() => null);
  if (!index?.embeddings) throw new Error("no embeddings");

  const q = await openai.embeddings.create({ model, input: query });
  const qv = q.data[0].embedding;

  function dot(a: number[], b: number[]) {
    let s = 0;
    for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
    return s;
  }

  const scored = cases.map(c => {
    const v = index.embeddings![c.id];
    return { score: v ? dot(qv, v) : -Infinity, case: c };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, top_k);
}

/** ---- Index maintenance (optional persistence) ---- */
export async function rebuildIndex(
  persist = true,
  openai?: OpenAI,
  embedModel = "text-embedding-3-small"
) {
  const cases = await loadAllCases();
  const { idf, vectors } = buildTfIdf(cases);

  const index: any = {
    built_at: new Date().toISOString(),
    tfidf: {
      idf: Object.fromEntries(idf.entries()),
      vectors: Object.fromEntries(
        Array.from(vectors.entries()).map(([id, m]) => [id, Object.fromEntries(m.entries())])
      ),
    },
  };

  if (openai) {
    // best-effort embeddings
    try {
      const texts = cases.map(c => ({
        id: c.id,
        text: [
          c.problem_summary,
          c.outcome,
          c.postmortem,
          ...(c.plan || []),
          ...(c.actions || []).map(a => `${a.tool} ${JSON.stringify(a.result ?? "")}`)
        ].join("\n")
      }));
      const chunks: typeof texts[] = [];
      const B = 96; // batch
      for (let i = 0; i < texts.length; i += B) chunks.push(texts.slice(i, i + B));
      const embeddings: Record<string, number[]> = {};
      for (const chunk of chunks) {
        const resp = await openai.embeddings.create({
          model: embedModel,
          input: chunk.map(c => c.text),
        });
        resp.data.forEach((d, i) => {
          embeddings[chunk[i].id] = d.embedding;
        });
      }
      index.embeddings = embeddings;
    } catch {
      // ignore embeddings errors
    }
  }

  if (persist) {
    await ensureDir(path.dirname(INDEX_PATH));
    await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
  }
  return index;
}

/** ---- Tool wrapper: cases.query ---- */
import type { ExecContext } from "../agent/types";
export async function casesQueryTool(
  args: { query: string; top_k?: number },
  _ctx: ExecContext
) {
  if (!args?.query) throw new Error("query is required");
  const topK = typeof args.top_k === "number" ? args.top_k : 3;
  const matches = await queryCases(args.query, topK);
  return matches.map(m => ({
    score: Number(m.score.toFixed(4)),
    id: m.case.id,
    ticket_id: m.case.ticket_id,
    problem_summary: m.case.problem_summary,
    outcome: m.case.outcome,
    postmortem: m.case.postmortem,
    plan: m.case.plan,
  }));
}
