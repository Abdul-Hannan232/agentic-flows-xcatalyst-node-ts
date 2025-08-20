# Agentic Flows Exercise — Triage Assistant

Build a **production-like agentic system** that triages incoming user requests, plans a solution, and executes through tools. The exercise is split into four milestones so you learn by layering capabilities.

---

## Learning Goals
1. Understand the **agent loop** (perception → planning → action → observation → reflection → memory).
2. Implement **tool-use** via function calling and **safe tool routing**.
3. Add **short-term and long-term memory**, including retrieval over a local knowledge base.
4. Handle **multi-turn tasks** with monitoring, retries, guardrails, and evaluation.
5. Produce **traceable runs**: logs, metrics, and replayable trajectories.

---

## Scenario: Support Inbox Triage Assistant
You’re building an agent that reads inbound “tickets” and decides: (a) category, (b) severity, (c) next action, and then executes actions through tools (reply draft, create GitHub issue, fetch status, or escalate).

### Inputs & Outputs
- **Input**: JSON ticket events, e.g.
```json
{
  "id": "t_4381",
  "from": "sara@acme.com",
  "subject": "Billing discrepancy on August invoice",
  "body": "Hi, our invoice seems 2x expected. Contract says $1,200/mo...",
  "attachments": ["/data/contracts/acme_msa.pdf"],
  "channel": "email",
  "received_at": "2025-08-18T07:12:01Z"
}
```
- **Output**: JSON decision + actions taken, e.g.
```json
{
  "ticket_id": "t_4381",
  "category": "Billing",
  "severity": "High",
  "plan": ["Check contract terms", "Compare invoice", "Draft response"],
  "actions": [
    {"tool": "kb.retrieve", "args": {"query": "Acme MSA pricing"}},
    {"tool": "billing.api.getInvoice", "args": {"customer": "Acme", "month": "2025-08"}},
    {"tool": "email.draftReply", "args": {"to": "sara@acme.com", "template": "billing_adjustment"}}
  ],
  "result": {"status": "resolved", "reply_id": "r_9923"}
}
```

---

## Environment
- **TypeScript/Node.js**: Use `langgraph` or implement a lightweight planner-executor using OpenAI function calling.

> Don’t over-index on framework; the point is to see your **reasoning loop + tooling**.

---

## Provided Artifacts (you prepare these locally)
1. **Knowledge Base** (`/data/kb/`):
   - `pricing.md` (plans, overage rules)
   - `runbook_incidents.md` (P1/P2 criteria, escalation tree)
   - `product_faq.md` (common Qs)
   - `contracts/` sample PDFs (use 2–3, e.g., “acme_msa.pdf”) 
2. **Mock APIs** (`/mocks/`): Implement simple JSON servers or functions:
   - `billing.api.getInvoice(customer, month)` → returns line items
   - `issues.api.create(title, body, labels)` → returns `{id}`
   - `status.api.get()` → returns current service/incident status
   - `auth.api.validateCustomer(email)` → returns `{customerId}` or error
3. **Ticket Stream** (`/data/tickets/*.json`) with 15–25 varied tickets (billing, outage, feature request, cancellation, sales, support).

---

## Tools to Implement (function-calling interfaces)
1. `kb.retrieve(query: string, top_k?: number)`
   - Implements embedding search over `/data/kb` (include PDF text extraction).
2. `billing.api.getInvoice(customer: string, month: string)`
3. `issues.api.create(title: string, body: string, labels: string[])`
4. `status.api.get()`
5. `email.draftReply(to: string, subject?: string, body?: string, template?: string)`
6. `escalate.toHuman(queue: "billing"|"support"|"oncall", reason: string)`

**Design requirement**: tools must be **idempotent** or support a dry-run mode. Implement `dry_run: boolean` on the executor.

---

## Agent Design
### Core Loop (single-agent, then multi-agent)
- **Perception**: parse ticket → build structured representation
- **Planning**: create a tool-augmented plan (list of steps + why)
- **Action**: call tools; capture observations
- **Reflection**: detect mistakes, re-plan if needed (max N iterations)
- **Memory**:
  - **Short-term**: scratchpad of conversation/ticket context
  - **Long-term**: memory store of past resolutions; use as RAG corpus
- **Stop** when termination criteria are met (goal reached, low uncertainty, or guardrail triggered)

### Safety & Guardrails
- **PII handling**: redact emails/IDs in logs
- **Tool budget**: max calls per ticket; fail-fast with human handoff
- **Policy prompts**: refusal rules (e.g., never issue refunds >$500 without escalation)

---

## Milestones
### M1 — Skeleton Agent (1 day)
- Load tickets, print a **classification** (category & severity) and a **static plan** (no tools yet).
- Add a JSON schema validator for outputs.
- **Deliverable**: CLI `npm run triage -- --ticket data/tickets/t_*.json`.

### M2 — Tool Use & RAG (2 days)
- Implement `kb.retrieve` + at least two APIs.
- Plan → act → observe loop with **retry** policy and simple backoff.
- Log **every step**: thought, tool, args, observation.
- **Deliverable**: agent resolves 10/20 tickets end-to-end in **dry-run**.

### M3 — Memory & Reflection (2 days)
- Store successful resolutions as **cases** (problem → plan → actions → outcome → postmortem).
- On similar tickets, agent should **generalize** from cases (few-shot via RAG).
- Add **reflection** step that checks: “Did the observation reduce uncertainty?” If not, re-plan.
- **Deliverable**: measurable improvement on repeated patterns.

### M4 — Multi-Agent Orchestration (2 days)
- Split into **Planner**, **Specialist**, **Reviewer** agents:
  - Planner: builds plan, assigns tools.
  - Specialist: executes tools, streams observations.
  - Reviewer: policy checks, quality gate, escalation.
- Use a **graph** (nodes + edges; conditions on edges) to control flow.
- **Deliverable**: visualize the graph and one full run trajectory.

---

## Evaluation & Rubric
Scored 0–4 each (max 28):
1. **Correctness** (decisions match ground-truth labels in 20 tickets)
2. **Tooling** (clean interfaces, idempotency, dry-run)
3. **Planning Quality** (clear, minimal steps, explicit assumptions)
4. **RAG Quality** (citations from KB, chunking, PDF extraction)
5. **Memory Use** (case retrieval improves outcomes)
6. **Safety/Guardrails** (PII redaction, limits, escalations)
7. **Observability** (structured logs, trace viewer, run IDs)

Target: ≥20 total to pass; 24+ is excellent.

---

## Ground Truth & Test Suite
Create `tests/expected/*.json` with gold labels for 20 tickets (category, severity, required actions). Provide a script:
- `npm run test` to:
  - replay agent runs in **deterministic mode** (seeded)
  - compare **final decisions** and **actions** to gold
  - assert **budget** limits and **policy** compliance

---

## Data & Prompts
- **System Prompt**:
  - You are a triage assistant. Always produce a plan before acting. Keep steps minimal. Cite KB sections when making claims. Obey policy rules. Hand off to human when uncertain >30% or on restricted actions.
- **Planning Prompt** should output JSON with fields: `goal, assumptions, steps[], stopping_conditions[]`.
- **Reviewer Prompt** focuses on policy and safety.

---

## Telemetry & Traceability
- Each run gets a `run_id`.
- Capture: prompts, tool calls (args, duration), tokens, retries, policy flags.
- Export to `/runs/{run_id}.jsonl` and a human-readable HTML trace.

---

## Stretch Goals (choose 2+)
1. **Calendar-aware SLAs**: severity influenced by business hours.
2. **Learning to route**: small classifier to route tickets before LLM.
3. **Active Retrieval**: plan queries, refine with observations.
4. **Counterfactual evaluation**: simulate alternative plans and compare cost.
5. **Interactive mode**: clarify with the user when info is missing (ask questions, wait for answers, continue).
6. **Mini-finetune** or **prompt-tuning** of classification head.
7. **Web UI**: run viewer + live console.

---

## Folder Structure (suggested)
```
agent/
  core/          # loop, state, memory, policies
  tools/         # kb, billing, issues, status, email, escalate
  prompts/       # system, planner, reviewer
  data/
    kb/
    tickets/
  mocks/
  runs/
  tests/
  cli.ts
```

---

## Guardrails & Policies (examples)
- Never promise refunds > $500; escalate to billing.
- If invoice mismatch > 20% → severity High.
- If `status.api.get()` shows outage → auto-reply with status page link.
- Redact emails/IDs in logs: `sara@acme.com` → `s***@acme.com`.
- Max tool calls per ticket: 8 (hard stop + escalate).

---

## Review Checklist for PR
- [ ] Readme explains the loop and graph
- [ ] Repro steps (env vars, commands, seeds)
- [ ] Tests pass locally
- [ ] Example run trace attached (HTML + JSONL)
- [ ] Design notes: trade-offs, failures, next steps

---

## What to Submit
1. Git repo link.
2. Short loom (≤7 min) demo: one full run, logs, tests, and a bug you fixed via traces.
3. Design doc (2–3 pages): architecture, prompts, policies, and learnings.

---

## Hints & Pitfalls
- Keep tools **pure** and **fast**; cache KB search results.
- Prefer **plan-then-act** over streaming calls.
- Make observations short and structured for better reflection.
- Start with **deterministic seeds**; randomness hides bugs.
- RAG: use small chunks with overlap; store source paths for citations.

---

## Timebox (suggested)
- Total: 5–7 days full-time (≈40–50 hrs)
- Daily goal: complete one milestone per day after M1.

---

**End of Spec** — Build iteratively, commit at each milestone, and ship traces we can review.

