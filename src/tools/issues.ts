// src/tools/issues.ts

let counter = 1000;

// In-memory issue store (simulates DB)
const issues: Record<string, { id: string; title: string; body: string; labels?: string[] }> = {};

export async function createIssue(args: { ticket_id: string; description: string; labels?: string[] }) {
  // Create a stable key for deduplication (ticket_id + description)
  const key = `${args.ticket_id}:${args.description}`;

  if (issues[key]) {
    // Already created → return existing issue
    return issues[key];
  }

  // Otherwise, create new issue
  const newIssue = {
    id: `ISS-${counter++}`,
    ticket_id: args.ticket_id,
    description: args.description,
    labels: args.labels ?? []
  };

  issues[key] = newIssue;
  return newIssue;
}

// Optional helper for debugging
export async function listIssues() {
  return Object.values(issues);
}
