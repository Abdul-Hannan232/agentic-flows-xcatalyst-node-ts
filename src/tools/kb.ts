import fs from "node:fs/promises";
import path from "node:path";

export async function retrieve(args: { query: string, top_k?: number }) {
  const base = path.resolve(process.cwd(), "data/kb");
  const files = await fs.readdir(base);
  // Super naive: return filenames that include query terms
  const hits = [];
  for (const f of files) {
    const p = path.join(base, f);
    const stat = await fs.stat(p);
    if (stat.isFile() && f.toLowerCase().includes((args.query||'').toLowerCase())) {
      hits.push({ file: `data/kb/${f}`, score: 0.5 });
    }
  }
  return { query: args.query, hits: hits.slice(0, args.top_k ?? 5) };
}
