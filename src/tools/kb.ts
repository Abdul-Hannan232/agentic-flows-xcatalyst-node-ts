// src/tools/kb.ts

// Fake DOMMatrix for Node
(global as any).DOMMatrix = class {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor() {}
};

import fs from "node:fs/promises";
import path from "node:path";
// import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";


// --- Tokenizer + similarity helpers ---
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function termFreq(tokens: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  tokens.forEach((t) => (counts[t] = (counts[t] || 0) + 1));
  return counts;
}

function cosineSim(a: Record<string, number>, b: Record<string, number>): number {
  const allTerms = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const term of allTerms) {
    const x = a[term] || 0;
    const y = b[term] || 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-8);
}

// --- Recursively collect files ---
async function collectFiles(base: string): Promise<string[]> {
  const entries = await fs.readdir(base, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const p = path.join(base, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(p)));
    } else {
      results.push(p);
    }
  }
  return results;
}

// --- Extract text from supported files (safe: skip PDFs) ---
async function extractText(filePath: string): Promise<string> {
  try {
    if (filePath.endsWith(".md") || filePath.endsWith(".txt")) {
      return fs.readFile(filePath, "utf-8");
    }

    // TEMPORARY: skip PDFs to avoid brittle pdf parsing packages during M2.
    // If you need PDF support later, replace this block with a real parser.
    if (filePath.endsWith(".pdf")) {
      console.warn(`kb.retrieve: skipping PDF parsing for now: ${filePath}`);
      return ""; // treat as no text available for this PDF
    }
  } catch (err: any) {
    console.warn(`Failed to read file ${filePath}:`, err?.message ?? String(err));
    return "";
  }
  return "";
}


// --- Main retrieve ---
export async function retrieve(args: { query: string; top_k?: number }) {
  const base = path.resolve(process.cwd(), "data/kb");
  // console.log("kb base path:", base);

  const allFiles = await collectFiles(base);

  const results: { id: string; text: string; score: number; sourcePath: string }[] = [];
  const qVec = termFreq(tokenize(args.query));

  for (const f of allFiles) {
    if (!f.endsWith(".md") && !f.endsWith(".txt") && !f.endsWith(".pdf")) continue;

    const raw = await extractText(f);
    const chunks = raw.split(/\n\n+/); // naive: split by paragraphs
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk.trim()) continue;
      const cVec = termFreq(tokenize(chunk));
      const score = cosineSim(qVec, cVec);
      results.push({
        id: `${path.basename(f)}#${i}`,
        text: chunk.slice(0, 300), // preview
        score,
        sourcePath: path.relative(process.cwd(), f),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return { query: args.query, hits: results.slice(0, args.top_k ?? 5) };
}
